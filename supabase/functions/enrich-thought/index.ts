// Open Brain — Enrichment agent (Supabase Edge Function)
//
// Runs when a new thought is inserted (via a database trigger / webhook).
// It asks the LLM gateway for tags, a category, and a one-line summary,
// then writes them back onto the thought row.
//
// Always returns 200 so a failure never blocks an insert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_KEY = Deno.env.get("INTERNAL_KEY")!;
const CALL_LLM_URL = `${SUPABASE_URL}/functions/v1/call-llm`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CATEGORIES = ["idea", "learning", "question", "reference", "plan", "reflection"];

// Ask the gateway to classify the thought, returning strict JSON.
async function enrich(content: string) {
  const prompt =
    `Analyze this note and respond with ONLY a JSON object (no markdown, no prose) of the form:\n` +
    `{"tags": ["3 to 5 short lowercase tags"], "category": "one of ${CATEGORIES.join("|")}", "summary": "one sentence, no em dashes"}\n\n` +
    `Note:\n"""${content.slice(0, 4000)}"""`;

  const res = await fetch(CALL_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ prompt, maxTokens: 300 }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
  const { text } = await res.json();

  // The model may wrap JSON in ```json fences; strip them.
  const clean = String(text).replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((t: unknown) => String(t).toLowerCase()).slice(0, 5)
    : [];
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : null;
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : null;
  return { tags, category, summary };
}

Deno.serve(async (req) => {
  // Only this project's own database trigger may call this agent.
  const internalKey = Deno.env.get("INTERNAL_KEY") ?? "";
  if ((req.headers.get("x-internal-key") ?? "") !== internalKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    // Database webhooks/triggers send the new row under "record".
    const record = payload.record ?? payload.new ?? payload;
    const id = record?.id;
    const content = String(record?.content ?? "");

    // Skip if we can't identify the row, content is trivially short,
    // or it is already enriched (avoids reprocessing).
    if (!id || content.trim().length < 20 || record?.enriched_at) {
      return new Response("skipped", { status: 200 });
    }

    const { tags, category, summary } = await enrich(content);

    const { error } = await supabase
      .from("thoughts")
      .update({ tags, category, summary, enriched_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

    return new Response("enriched", { status: 200 });
  } catch (e) {
    console.error("enrich-thought error:", e);
    // Still return 200 — never block an insert.
    return new Response("error-handled", { status: 200 });
  }
});
