// POST JSON { transcript, customers: [{id,name,name_ta?,aliases?}], context?: {awaiting?, pending?} }
// -> validated parse { intent, customer_name, customer_id, amount, items, yes_no, language, confidence }
//
// Turns a Tamil / English / Hindi / Telugu (or code-mixed) counter utterance into a structured ledger command
// with an open-weight LLM (Qwen, Llama, Gemma, gpt-oss...) behind any OpenAI-compatible
// /chat/completions server: Ollama, vLLM, llama.cpp server, LocalAI, Groq, OpenRouter.
// Output is constrained with a JSON schema where the server supports it, and always
// validated with zod before it reaches the app.
import { z } from "npm:zod@4.6.7";
import { json, notConfigured, preflight } from "../_shared/http.ts";
import { INTENTS, JSON_SCHEMA, LANGS, SYSTEM } from "../_shared/nlu-prompt.ts";

const BASE_URL = (Deno.env.get("LLM_BASE_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("LLM_API_KEY") ?? "";
const MODEL = Deno.env.get("LLM_MODEL") ?? "";
const TIMEOUT_MS = Number(Deno.env.get("LLM_TIMEOUT_MS") ?? 9000);

const ParseSchema = z.object({
  intent: z.enum(INTENTS as [string, ...string[]]),
  customer_name: z.string().max(80).nullable().catch(null),
  customer_id: z.string().max(64).nullable().catch(null),
  amount: z.coerce.number().positive().max(10_000_000).nullable().catch(null),
  items: z.array(z.string().max(40)).max(12).catch([]),
  yes_no: z.enum(["yes", "no"]).nullable().catch(null),
  language: z.enum(LANGS as [string, ...string[]]).catch("ta"),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h.Authorization = `Bearer ${API_KEY}`;
  return h;
}

type Format = "json_schema" | "json_object" | "none";

async function complete(userContent: string, format: Format, signal: AbortSignal) {
  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
  };
  if (format === "json_schema") {
    body.response_format = { type: "json_schema", json_schema: { name: "ledger_command", strict: true, schema: JSON_SCHEMA } };
  } else if (format === "json_object") {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(`${BASE_URL}/chat/completions`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  return res;
}

/** Pull the first {...} object out of a reply (for servers without JSON mode). */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in reply");
    return JSON.parse(m[0]);
  }
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (!BASE_URL || !MODEL) return notConfigured("Language understanding (LLM_BASE_URL / LLM_MODEL)");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  const transcript = String(body?.transcript ?? "").trim().slice(0, 500);
  if (!transcript) return json({ error: "transcript missing" }, 400);
  const customers = Array.isArray(body?.customers)
    ? body.customers.slice(0, 300).map((c: any) => ({
      id: String(c.id),
      name: String(c.name ?? "").slice(0, 80),
      ...(c.name_ta ? { name_ta: String(c.name_ta).slice(0, 80) } : {}),
      ...(Array.isArray(c.aliases) && c.aliases.length ? { aliases: c.aliases.slice(0, 8).map(String) } : {}),
    }))
    : [];
  const context = body?.context && typeof body.context === "object" ? body.context : null;
  const userContent = JSON.stringify({ utterance: transcript, customers, context });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Strongest constraint first; fall back for servers that do not support it.
    let res: Response | null = null;
    for (const format of ["json_schema", "json_object", "none"] as Format[]) {
      res = await complete(userContent, format, ctrl.signal);
      if (res.ok) break;
      const detail = (await res.text()).slice(0, 200);
      if (res.status !== 400 && res.status !== 422) {
        console.error("llm error", res.status, detail);
        return json({ error: "upstream error", code: res.status === 429 ? "rate_limited" : "upstream" }, 502);
      }
      console.warn(`response_format ${format} rejected, retrying`, detail);
    }
    if (!res?.ok) return json({ error: "upstream error", code: "upstream" }, 502);

    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const parsed = ParseSchema.safeParse(extractJson(text));
    if (!parsed.success) {
      console.error("invalid parse", parsed.error.issues, text.slice(0, 300));
      return json({ error: "invalid model output", code: "invalid" }, 502);
    }
    const out = parsed.data;
    // Never trust an id the shop does not have.
    if (out.customer_id && !customers.some((c: any) => c.id === out.customer_id)) out.customer_id = null;
    return json({ ...out, model: data?.model ?? MODEL });
  } catch (err) {
    console.error("understand failed", err);
    return json({ error: "understand failed", code: ctrl.signal.aborted ? "timeout" : "internal" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
