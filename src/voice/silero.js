// Silero VAD (MIT, ~2 MB) through Transformers.js: is this 32 ms of audio a human voice?
// Unlike a loudness check it is not fooled by a mixer grinder, a passing bike or a fan.
import { AutoModel, Tensor } from '@huggingface/transformers';

export const SILERO_MODEL = 'onnx-community/silero-vad';
const RATE = 16000;
const CONTEXT = 64; // the model expects the last 64 samples of the previous frame in front of each frame

/** Load the model (downloaded once, then cached by the browser) and return a frame scorer. */
export async function loadSilero({ device = 'wasm', progress_callback } = {}) {
  const model = await AutoModel.from_pretrained(SILERO_MODEL, {
    config: { model_type: 'custom' },
    dtype: 'fp32', // 8-bit versions of this model turn speech into noise
    device,
    progress_callback,
  });
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);
  let state;
  let context;
  const reset = () => {
    state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
    context = new Float32Array(CONTEXT);
  };
  reset();

  return {
    reset,
    /** Probability (0..1) that this 512-sample, 16 kHz frame is speech. Frames must come in order. */
    async prob(frame) {
      const x = new Float32Array(CONTEXT + frame.length);
      x.set(context);
      x.set(frame, CONTEXT);
      context = frame.slice(frame.length - CONTEXT);
      const out = await model({ input: new Tensor('float32', x, [1, x.length]), sr, state });
      state = out.stateN;
      return out.output.data[0];
    },
  };
}
