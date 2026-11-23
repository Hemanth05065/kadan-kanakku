// Runs the Silero voice detector off the main thread, next to (not inside) the Whisper
// worker, so it keeps up with the microphone even while Whisper is busy.
import { env } from '@huggingface/transformers';
import { loadSilero } from './silero.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
if ('useWasmCache' in env) env.useWasmCache = true;

let vad = null;
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  if (data.type === 'load') {
    loadSilero({ device: 'wasm' })
      .then((v) => {
        vad = v;
        self.postMessage({ type: 'ready' });
      })
      .catch((err) => self.postMessage({ type: 'error', error: String(err?.message || err) }));
  } else if (data.type === 'reset') {
    queue = queue.then(() => vad?.reset());
  } else if (data.type === 'frame') {
    // One at a time, in order: the model carries state from frame to frame.
    queue = queue
      .then(async () => self.postMessage({ type: 'prob', id: data.id, p: vad ? await vad.prob(data.frame) : 0 }))
      .catch((err) => self.postMessage({ type: 'prob', id: data.id, p: 0, error: String(err?.message || err) }));
  }
};
