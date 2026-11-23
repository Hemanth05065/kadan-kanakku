// POST multipart/form-data { audio: File, keyterms?: JSON string[], lang?: "ta"|"en"|"auto" }
// -> { transcript, language, provider, model }
//
// Speech-to-text with open-weight Whisper (large-v3 by default) through any
// OpenAI-compatible /audio/transcriptions server:
//   • self-hosted: speaches / faster-whisper (ai-server/docker-compose.yml), whisper.cpp server, LocalAI, vLLM
//   • hosted open weights: Groq (whisper-large-v3, whisper-large-v3-turbo)
// The shop's customer and item names go in Whisper's `prompt` as vocabulary hints.
// Keys and endpoints stay server-side.
import { json, notConfigured, preflight } from "../_shared/http.ts";

const BASE_URL = (Deno.env.get("STT_BASE_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("STT_API_KEY") ?? "";
const MODEL = Deno.env.get("STT_MODEL") ?? "whisper-large-v3";
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function vocabulary(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    return arr
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().slice(0, 40))
      .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
      .slice(0, 60);
  } catch {
    return [];
  }
}

/**
 * Whisper conditions on the prompt as if it were the previous sentence, so a short
 * Tanglish ledger line plus the shop's names steers both script and spelling.
 * Whisper reads at most 224 prompt tokens; keep it well under that.
 */
const PROMPT_HEAD: Record<string, string> = {
  ta: "முருகன் அண்ணா, 240 ரூபாய், அரிசி, எண்ணெய், கடன். ரவி 100 குடுத்தார்.",
  en: "Murugan anna, 240 rupees, rice and oil, credit. Ravi paid 100.",
  hi: "रमेश भैया, 240 रुपये, चावल और तेल, उधार। रवि ने 100 दिए।",
  te: "శ్రీనివాస్ గారు, 240 రూపాయలు, బియ్యం, నూనె, అప్పు. రవి 100 ఇచ్చారు.",
};

function buildPrompt(terms: string[], lang: string): string {
  const head = PROMPT_HEAD[lang] ?? PROMPT_HEAD.ta;
  let prompt = head;
  for (const t of terms) {
    if ((prompt + ", " + t).length > 420) break;
    prompt += (prompt === head ? " " : ", ") + t;
  }
  return prompt;
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (!BASE_URL) return notConfigured("Speech-to-text (STT_BASE_URL)");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "expected multipart/form-data" }, 400);
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return json({ error: "audio file missing" }, 400);
  if (audio.size > MAX_BYTES) return json({ error: "audio too long" }, 413);
  const lang = String(form.get("lang") ?? "ta");
  const terms = vocabulary(form.get("keyterms"));

  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "clip.wav");
  upstream.append("model", MODEL);
  if (PROMPT_HEAD[lang]) upstream.append("language", lang);
  upstream.append("prompt", buildPrompt(terms, lang));
  upstream.append("response_format", "json");
  upstream.append("temperature", "0");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
      body: upstream,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("whisper error", res.status, (await res.text()).slice(0, 300));
      return json({ error: "transcription failed", code: res.status === 429 ? "rate_limited" : "upstream" }, 502);
    }
    const data = await res.json();
    return json({
      transcript: String(data.text ?? "").trim(),
      language: data.language ?? null,
      provider: "whisper",
      model: MODEL,
    });
  } catch (err) {
    console.error("transcribe failed", err);
    return json({ error: "transcription failed", code: ctrl.signal.aborted ? "timeout" : "upstream" }, 502);
  } finally {
    clearTimeout(timer);
  }
});
