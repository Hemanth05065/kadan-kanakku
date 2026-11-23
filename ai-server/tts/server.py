"""
Tamil / English server voice for Kadan Kanakku.

OpenAI-compatible POST /v1/audio/speech backed by AI4Bharat Indic Parler-TTS
(Apache-2.0, https://huggingface.co/ai4bharat/indic-parler-tts). The app only uses
this when the phone has no Tamil voice installed; the phone's own voice is faster.

    uvicorn server:app --host 0.0.0.0 --port 8001
"""
import io
import os

import soundfile as sf
import torch
from fastapi import FastAPI
from fastapi.responses import Response
from parler_tts import ParlerTTSForConditionalGeneration
from pydantic import BaseModel
from transformers import AutoTokenizer

MODEL_ID = os.getenv("TTS_MODEL", "ai4bharat/indic-parler-tts")
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"

model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID).to(DEVICE)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
description_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)

# Default speakers per language; see the model card for the full list.
DEFAULT_VOICE = {
    "ta": os.getenv("TTS_VOICE_TA", "Jaya"),
    "en": os.getenv("TTS_VOICE_EN", "Thoma"),
    "hi": os.getenv("TTS_VOICE_HI", "Rohit"),
    "te": os.getenv("TTS_VOICE_TE", "Prakash"),
}


class SpeechRequest(BaseModel):
    input: str
    voice: str | None = None
    language: str | None = "ta"
    model: str | None = None
    response_format: str | None = "wav"


app = FastAPI(title="Kadan Kanakku TTS")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "device": DEVICE}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    lang = req.language if req.language in DEFAULT_VOICE else "ta"
    speaker = req.voice or DEFAULT_VOICE[lang]
    description = (
        f"{speaker} speaks at a slightly fast pace with a clear, friendly voice. "
        "The recording is very high quality, close-sounding, with no background noise."
    )
    desc = description_tokenizer(description, return_tensors="pt").to(DEVICE)
    prompt = tokenizer(req.input[:400], return_tensors="pt").to(DEVICE)
    with torch.inference_mode():
        audio = model.generate(
            input_ids=desc.input_ids,
            attention_mask=desc.attention_mask,
            prompt_input_ids=prompt.input_ids,
            prompt_attention_mask=prompt.attention_mask,
        )
    buf = io.BytesIO()
    sf.write(buf, audio.cpu().numpy().squeeze(), model.config.sampling_rate, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")
