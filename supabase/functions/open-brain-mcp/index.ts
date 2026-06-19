// Open Brain — MCP server (Supabase Edge Function)
//
// Implements the Model Context Protocol (MCP) over HTTP using JSON-RPC 2.0,
// so any MCP-compatible AI (Claude Desktop, etc.) can read/search your brain.
//
// It sits between the AI and your database: the AI only ever calls the three
// tools below. Your database credentials never leave this server.
//
// Tools exposed:
//   - search_thoughts(query)        -> keyword search across your thoughts
//   - list_recent(limit=10)         -> your most recent thoughts
//   - add_thought(content)          -> save a new thought
//
// Security: every request must carry  Authorization: Bearer <MCP_ACCESS_KEY>.
// Secrets read from the environment:
//   MCP_ACCESS_KEY              (you set this)
//   SUPABASE_URL               (auto-provided to edge functions)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-provided to edge functions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-protocol-version, x-mcp-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The three tools this server advertises to the AI.
const TOOLS = [
  {
    name: "search_thoughts",
    description:
      "Search the user's personal knowledge base ('brain') for thoughts matching a keyword or phrase. Returns the most relevant saved thoughts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase to search for" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description: "List the user's most recently saved thoughts from their brain.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many recent thoughts to return (default 10).",
        },
      },
    },
  },
  {
    name: "add_thought",
    description: "Save a new thought to the user's brain.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The text of the thought to save." },
      },
      required: ["content"],
    },
  },
];

// JSON-RPC success/error helpers
function ok(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// Wrap any text as an MCP tool result
function toolText(text: string) {
  return { content: [{ type: "text", text }] };
}

// Run one of the three tools
async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "search_thoughts") {
    const query = String(args.query ?? "").trim();
    if (!query) return toolText("No query provided.");
    const { data, error } = await supabase
      .from("thoughts")
      .select("id, content, created_at")
      .ilike("content", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return toolText("Search error: " + error.message);
    if (!data || data.length === 0) return toolText(`No thoughts found for "${query}".`);
    const body = data
      .map((r) => `• (${new Date(r.created_at).toLocaleString()}) ${r.content}`)
      .join("\n");
    return toolText(`Found ${data.length} thought(s) for "${query}":\n${body}`);
  }

  if (name === "list_recent") {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
    const { data, error } = await supabase
      .from("thoughts")
      .select("id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return toolText("List error: " + error.message);
    if (!data || data.length === 0) return toolText("The brain is empty.");
    const body = data
      .map((r) => `• (${new Date(r.created_at).toLocaleString()}) ${r.content}`)
      .join("\n");
    return toolText(`${data.length} most recent thought(s):\n${body}`);
  }

  if (name === "add_thought") {
    const content = String(args.content ?? "").trim();
    if (!content) return toolText("No content provided.");
    const { error } = await supabase.from("thoughts").insert({ content });
    if (error) return toolText("Save error: " + error.message);
    return toolText("Saved to the brain: " + content);
  }

  return toolText("Unknown tool: " + name);
}

Deno.serve(async (req) => {
  // Browser preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: require the shared access key.
  // Accept it either as "Authorization: Bearer <key>" or as a space-free
  // "x-mcp-key: <key>" header (the latter avoids Windows arg-splitting issues).
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const xkey = (req.headers.get("x-mcp-key") ?? "").trim();
  if (bearer !== MCP_ACCESS_KEY && xkey !== MCP_ACCESS_KEY) {
    return err(null, -32001, "Unauthorized");
  }

  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return err(null, -32700, "Parse error");
  }

  const { id, method, params } = msg ?? {};

  // Notifications (no id, method like "notifications/initialized") need no response body
  if (id === undefined || id === null) {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  // MCP handshake
  if (method === "initialize") {
    const clientProto = params?.protocolVersion ?? "2024-11-05";
    return ok(id, {
      protocolVersion: clientProto,
      capabilities: { tools: {} },
      serverInfo: { name: "open-brain", version: "1.0.0" },
    });
  }

  if (method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      const result = await callTool(name, args);
      return ok(id, result);
    } catch (e) {
      return err(id, -32603, "Tool error: " + (e as Error).message);
    }
  }

  if (method === "ping") {
    return ok(id, {});
  }

  return err(id, -32601, "Method not found: " + method);
});
