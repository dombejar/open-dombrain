// Open Brain — Telegram bot Edge Function
// Runs on Supabase's servers. Telegram calls this code (via a webhook)
// every time someone messages your bot.
//
// Behavior:
//   /start            -> greeting + help
//   /search <words>   -> search your thoughts (also works as: ? <words>)
//   /recent           -> your 5 most recent thoughts
//   anything else      -> saved as a new thought
//
// Secrets read from the environment (never hard-coded):
//   TELEGRAM_BOT_TOKEN          (you set this)
//   SUPABASE_URL                (auto-provided to edge functions)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-provided to edge functions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Accept either secret name (the course default, or the one set for this project)
const TELEGRAM_BOT_TOKEN =
  Deno.env.get("TELEGRAM_BOT_TOKEN") ??
  Deno.env.get("TELEGRAM_OPEN_DOMBRAIN_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Send a text reply back to the user on Telegram
async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
}

// Format a list of thought rows into a readable message
function formatRows(rows: { content: string }[]): string {
  return rows
    .map((r, i) => `${i + 1}. ${r.content.slice(0, 300)}`)
    .join("\n\n");
}

Deno.serve(async (req) => {
  // Browser preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const update = await req.json();
    const message = update.message ?? update.edited_message;
    const chatId = message?.chat?.id;
    const text = (message?.text ?? "").trim();

    // No chat to reply to — nothing to do
    if (!chatId) return new Response("ok", { headers: corsHeaders });

    // Non-text content (photos, stickers, etc.)
    if (!text) {
      await sendMessage(
        chatId,
        "I can only save text right now. Send me a thought, or use /search <words> or /recent.",
      );
      return new Response("ok", { headers: corsHeaders });
    }

    // /start — greeting
    if (text === "/start") {
      await sendMessage(
        chatId,
        "🧠 Connected to your Open Brain.\n\n" +
          "• Send me any message and I'll save it.\n" +
          "• /search <words>  (or  ? words) to search your brain.\n" +
          "• /recent to see your last 5 thoughts.",
      );
      return new Response("ok", { headers: corsHeaders });
    }

    const lower = text.toLowerCase();

    // Search: "/search ..." or "? ..."
    if (lower.startsWith("/search") || text.startsWith("?")) {
      const query = text.replace(/^\/search/i, "").replace(/^\?/, "").trim();
      if (!query) {
        await sendMessage(
          chatId,
          "Add some words to search, e.g.  /search ideas about learning",
        );
        return new Response("ok", { headers: corsHeaders });
      }
      const { data, error } = await supabase
        .from("thoughts")
        .select("content, created_at")
        .ilike("content", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;

      if (!data || data.length === 0) {
        await sendMessage(chatId, `No matches for "${query}".`);
      } else {
        await sendMessage(
          chatId,
          `🔍 Top results for "${query}":\n\n${formatRows(data)}`,
        );
      }
      return new Response("ok", { headers: corsHeaders });
    }

    // Recent
    if (lower.startsWith("/recent")) {
      const { data, error } = await supabase
        .from("thoughts")
        .select("content, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;

      if (!data || data.length === 0) {
        await sendMessage(chatId, "Your brain is empty so far.");
      } else {
        await sendMessage(
          chatId,
          `📥 Your 5 most recent thoughts:\n\n${formatRows(data)}`,
        );
      }
      return new Response("ok", { headers: corsHeaders });
    }

    // Default: save the message as a new thought
    const content = `💬 Telegram: ${text}`;
    const { error } = await supabase.from("thoughts").insert({ content });
    if (error) throw error;

    await sendMessage(chatId, "✅ Saved to your brain.");
    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("telegram-bot error:", e);
    // Always return 200 so Telegram does not keep retrying
    return new Response("ok", { headers: corsHeaders });
  }
});
