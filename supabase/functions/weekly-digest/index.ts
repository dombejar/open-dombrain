// Open Brain — Weekly digest agent (Supabase Edge Function)
//
// Reads the last 7 days of thoughts, asks the LLM gateway for a summary of
// what you have been learning, and saves it back as a thought (category
// "digest"). Optionally emails it if RESEND_API_KEY + DIGEST_EMAIL are set.
//
// Triggered by pg_cron on a schedule (see supabase/migrations/0002_cron.sql).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_KEY = Deno.env.get("INTERNAL_KEY")!;
const CALL_LLM_URL = `${SUPABASE_URL}/functions/v1/call-llm`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function askLLM(prompt: string): Promise<string> {
  const res = await fetch(CALL_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ prompt, maxTokens: 1200 }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  const { text } = await res.json();
  return String(text);
}

// Optional email delivery via Resend (only if configured).
async function maybeEmail(subject: string, body: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("DIGEST_EMAIL");
  if (!apiKey || !to) return "email skipped (RESEND_API_KEY/DIGEST_EMAIL not set)";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("DIGEST_FROM") ?? "Open Brain <onboarding@resend.dev>",
      to: [to],
      subject,
      text: body,
    }),
  });
  return res.ok ? "email sent" : `email failed: ${res.status} ${await res.text()}`;
}

Deno.serve(async () => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Pull the week's thoughts, excluding previous digests.
    const { data, error } = await supabase
      .from("thoughts")
      .select("content, category, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const items = (data ?? []).filter((t) => t.category !== "digest");
    if (items.length < 5) {
      const msg = `Not enough content this week (${items.length} thoughts). Skipping digest.`;
      console.log(msg);
      return new Response(JSON.stringify({ ok: true, skipped: true, message: msg }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Group by category for the prompt.
    const byCategory: Record<string, string[]> = {};
    for (const t of items) {
      const c = t.category ?? "uncategorized";
      (byCategory[c] ??= []).push(t.content);
    }
    const grouped = Object.entries(byCategory)
      .map(([cat, notes]) => `## ${cat} (${notes.length})\n` + notes.map((n) => `- ${n.slice(0, 400)}`).join("\n"))
      .join("\n\n");

    const prompt =
      `You are writing a warm, direct weekly review of someone's captured thoughts. ` +
      `Do not use em dashes. Based on the notes below (grouped by category), write:\n` +
      `1. A short summary of what they were learning and working on this week.\n` +
      `2. The key themes that connect their notes.\n` +
      `3. One open question they seem to be exploring.\n\n` +
      `Notes from the last 7 days:\n\n${grouped}`;

    const digestBody = await askLLM(prompt);

    const range = `${since.slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`;
    const content = `🗓️ Weekly Digest (${range})\n\n${digestBody}`;

    // Save as a thought already marked enriched, so the insert trigger skips it.
    const { error: insErr } = await supabase.from("thoughts").insert({
      content,
      category: "digest",
      summary: "Automated weekly summary of the last 7 days.",
      tags: ["digest", "weekly"],
      enriched_at: new Date().toISOString(),
    });
    if (insErr) throw insErr;

    const emailStatus = await maybeEmail(`Your Open Brain weekly digest (${range})`, content);

    return new Response(
      JSON.stringify({ ok: true, thoughts_summarized: items.length, email: emailStatus }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("weekly-digest error:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
