// POST JSON { text, lang: "ta"|"en" } -> { audio: base64, mime }
// Optional server voice for phones without a Tamil voice installed. Calls any
// OpenAI-compatible /audio/speech server, e.g. the open-source Indic Parler-TTS
// server in ai-server/tts (Apache-2.0 model by AI4Bharat). The app uses the
// phone's own voice whenever it has one, so this is only a fallback.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { json, notConfigured, preflight } from "../_shared/http.ts";

const BASE_URL = (Deno.env.get("TTS_BASE_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("TTS_API_KEY") ?? "";
const MODEL = Deno.env.get("TTS_MODEL") ?? "ai4bharat/indic-parler-tts";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (!BASE_URL) return notConfigured("Text-to-speech (TTS_BASE_URL)");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  const text = String(body?.text ?? "").trim().slice(0, 400);
  if (!text) return json({ error: "text missing" }, 400);
  const lang = ["ta", "en", "hi", "te"].includes(body?.lang) ? body.lang : "ta";
  const voice = Deno.env.get(`TTS_VOICE_${lang.toUpperCase()}`) ?? undefined;

  const res = await fetch(`${BASE_URL}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL, input: text, voice, response_format: "mp3", language: lang }),
  });
  if (!res.ok) {
    console.error("tts failed", res.status, (await res.text()).slice(0, 300));
    return json({ error: "tts failed", code: "upstream" }, 502);
  }
  const mime = res.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
  const audio = encodeBase64(new Uint8Array(await res.arrayBuffer()));
  return json({ audio, mime });
});
