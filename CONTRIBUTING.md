# Contributing to Kadan Kanakku

Thanks for helping shopkeepers keep their books by voice. Everything here is MIT-licensed.

## Run it

```bash
npm install
npm run dev        # demo mode: no keys needed, data stays in the browser
npm test           # 210+ tests, ~2 s, no network
```

Server features (phone login, sync, Whisper large-v3, the LLM) need Supabase and an
OpenAI-compatible model server; see the README.

## Where things live

| Area | Files |
|---|---|
| Spoken replies, labels, vocabulary, number words | `src/i18n/<lang>.js` |
| Number parsing (any language, mixed) | `src/lib/numbers.js` |
| Name matching by sound, transliteration | `src/lib/names.js`, `src/lib/translit.js` |
| On-device understanding | `src/lib/localParser.js` |
| Conversation rules (confirm, ask, undo…) | `src/voice/decide.js` (pure, well tested) |
| Mic, quality gate, Whisper, voice | `src/voice/` |
| Data, offline outbox, sync | `src/lib/store.js`, `src/lib/sync.js` |
| Database + row-level security | `supabase/migrations/`, tested in `supabase/tests/` |
| Server functions | `supabase/functions/` (the LLM prompt is in `_shared/nlu-prompt.ts`) |

## Add a language

1. Copy `src/i18n/ta.js` to `src/i18n/<code>.js` and translate `labels`, `replies` (each has
   `show` for the screen and `say` for the voice, in native script), `whatsapp`.
2. Fill `lexicon` (words for credit, payment, balance, yes/no, honorifics, items…) and
   `numbers` (`[value, 'add' | 'mult' | 'mod', ...spellings]`). Words that are also ordinary
   words ("do" in Hindi) go in `weakNumbers`.
3. If the script is new, add it to `SCRIPTS` in `src/lib/translit.js`.
4. Register the pack in `src/i18n/index.js`, add a few phrases to `eval/cases.json`, and run
   `npm test` and `npm run eval:nlu`. The "language packs are complete" test tells you which
   replies are missing.

## Improve accuracy

- Add real phrases you hear at a counter to `eval/cases.json` (expected intent, customer and
  amount), then `npm run eval:nlu`. A miss usually means a missing word in a `lexicon`.
- Record real voices with the in-app **Accuracy lab** (Settings), export, and score speech
  engines with `npm run eval:stt -- bundle.json --engine local:onnx-community/whisper-base`
  or `--engine server`.
- The number that matters most is **silent wrong saves**: it must stay at 0.

## Pull requests

Keep them small and say how you checked them (the PR template has the list). CI runs the
tests, the understanding eval (must stay ≥ 95%), the build and the edge-function type check.
