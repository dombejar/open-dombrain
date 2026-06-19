// Open Brain — LLM Gateway (Supabase Edge Function)
//
// Every agent calls THIS function instead of calling an AI provider directly.
// The provider, model, and API key live here in environment settings.
//
// To switch providers (e.g. Claude -> GPT -> Gemini -> a local model):
//   1. Set LLM_PROVIDER in Supabase secrets (e.g. "openai").
//   2. Add that provider's API key as a secret.
//   3. Add a branch in callProvider() below.
//   No agent code changes. One place, one change.
//
// Request:  POST { prompt, systemPrompt?, model?, maxTokens? }
// Response: { text: string }
//
// Secrets:
//   ANTHROPIC_API_KEY   (the AI key you created)
//   LLM_PROVIDER        (default "anthropic")
//   LLM_MODEL           (default "claude-haiku-4-5-20251001" — fast + cheap)

const LLM_PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "anthropic";
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
}

// --- Provider implementations -------------------------------------------------

async function callAnthropic(req: LLMRequest): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: req.model ?? LLM_MODEL,
      max_tokens: req.maxTokens ?? 1024,
      system: req.systemPrompt ?? undefined,
      messages: [{ role: "user", content: req.prompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${detail}`);
  }
  const data = await res.json();
  // Anthropic returns content as an array of blocks; join the text blocks.
  return (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
}

// To add OpenAI later, implement callOpenAI() the same shape and add a branch below.
// async function callOpenAI(req: LLMRequest): Promise<string> { ... }

async function callProvider(req: LLMRequest): Promise<string> {
  switch (LLM_PROVIDER) {
    case "anthropic":
      return await callAnthropic(req);
    // case "openai": return await callOpenAI(req);
    default:
      throw new Error(`Unknown LLM_PROVIDER "${LLM_PROVIDER}"`);
  }
}

// --- HTTP handler -------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only this project's own agents may call the gateway (protects your AI key).
  const internalKey = Deno.env.get("INTERNAL_KEY") ?? "";
  if ((req.headers.get("x-internal-key") ?? "") !== internalKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as LLMRequest;
    if (!body?.prompt || typeof body.prompt !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'prompt'." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = await callProvider(body);
    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("call-llm error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
