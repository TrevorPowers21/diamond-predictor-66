// Edge Function: parse-contract
//
// Reads an uploaded contract PDF with Claude and returns structured terms for
// the GM "Add Contract" form to pre-fill (the coach reviews/corrects before
// saving). Nothing is written here — this is pure extraction.
//
// Request (POST, JSON):
//   { fileBase64: string, mimeType?: string, fileName?: string }
//
// Response:
//   { title, bucket, vendor_name, total_value, start_date, end_date,
//     summary, obligations: [{ description, due_date }] }
//
// Required secret (set on the Supabase project):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional:
//   CONTRACT_PARSE_MODEL (defaults to claude-sonnet-5)
//
// Deploy:
//   supabase functions deploy parse-contract
//
// JWT is verified by the platform (default verify_jwt = true), so only signed-in
// users can call it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MODEL = Deno.env.get("CONTRACT_PARSE_MODEL") || "claude-sonnet-5";

const CONTRACT_TOOL = {
  name: "record_contract",
  description:
    "Record the structured terms extracted from a signed athlete compensation contract.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "A short human title, e.g. 'Opendorse NIL Agreement — 2026'.",
      },
      bucket: {
        type: "string",
        enum: ["rev", "nil", "other"],
        description:
          "Which compensation bucket this contract falls under: 'rev' = revenue share / direct school pay, 'nil' = an NIL deal with a brand/collective/vendor, 'other' = anything else (camps, appearances, misc).",
      },
      vendor_name: {
        type: "string",
        description:
          "The paying party / vendor / brand / collective for an NIL or Other deal. Empty for revenue share.",
      },
      total_value: {
        type: "number",
        description: "Total dollar value of the contract, as a plain number (no $ or commas).",
      },
      start_date: { type: "string", description: "Effective/start date as YYYY-MM-DD, or empty if absent." },
      end_date: { type: "string", description: "End/expiration date as YYYY-MM-DD, or empty if absent." },
      summary: { type: "string", description: "One sentence describing the deal." },
      obligations: {
        type: "array",
        description:
          "Every obligation/deliverable the athlete must perform (social posts, appearances, exclusivity, autographs, etc.).",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            due_date: { type: "string", description: "YYYY-MM-DD if the obligation has a deadline, else empty." },
          },
          required: ["description"],
        },
      },
    },
    required: ["bucket", "obligations"],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set on this project" }, 500);

  let body: { fileBase64?: string; mimeType?: string; fileName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.fileBase64) return json({ error: "fileBase64 is required" }, 400);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        tools: [CONTRACT_TOOL],
        tool_choice: { type: "tool", name: "record_contract" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: body.mimeType || "application/pdf",
                  data: body.fileBase64,
                },
              },
              {
                type: "text",
                text:
                  "This is a signed athlete compensation contract. Extract its terms using the record_contract tool. " +
                  "Read carefully for the paying party, total value, dates, and every obligation the athlete owes. " +
                  "If a field truly isn't present, leave it empty rather than guessing.",
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: `Claude API error (${resp.status})`, detail }, 502);
    }
    const data = await resp.json();
    const toolUse = (data.content || []).find((c: { type: string }) => c.type === "tool_use");
    if (!toolUse) return json({ error: "No structured output returned", raw: data }, 502);
    return json({ ok: true, contract: toolUse.input });
  } catch (e) {
    return json({ error: `Parse failed: ${(e as Error).message}` }, 500);
  }
});
