import { useEffect, useState } from 'react';
import { BiLabel, Button, useT } from '../components/ui.jsx';
import { useStore, setSettings, resetDemo } from '../lib/store.js';
import { syncNow } from '../lib/sync.js';
import { signOut, createInvite, listMembers } from '../lib/auth.js';
import { speak, voicePlanFor } from '../voice/tts.js';
import { useVoiceClips, packProgress } from '../voice/voiceClips.js';
import { nameClipKey } from '../voice/voicePack.js';
import { reply } from '../i18n/index.js';
import { DEVICE_MODELS, loadDeviceModel, unloadDeviceModel, useWhisperStatus } from '../voice/localWhisper.js';

function Choice({ k, value, options, onChange }) {
  const { t } = useT();
  return (
    <div className="space-y-1">
      <BiLabel k={k} className="text-sm font-semibold text-stone-600" />
      <div className="flex flex-wrap gap-2">
        {options.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`min-h-12 rounded-xl px-4 font-semibold ${value === v ? 'bg-leaf-800 text-white' : 'bg-white ring-1 ring-stone-300'}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Status({ ok, label, detail }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? 'bg-leaf-100 text-leaf-800' : 'bg-stone-200 text-stone-600'}`}>
        {ok ? '✓' : '—'} {detail}
      </span>
    </li>
  );
}

function Card({ children, title }) {
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      {title && <h2 className="text-lg font-bold text-leaf-900"><BiLabel k={title} /></h2>}
      {children}
    </section>
  );
}

function OnDeviceAI() {
  const s = useStore();
  const w = useWhisperStatus();
  const chosen = s.settings.onDeviceModel;
  return (
    <section className="space-y-3 rounded-2xl bg-gradient-to-br from-leaf-800 to-leaf-900 p-4 text-white shadow-lg">
      <div>
        <h2 className="text-lg font-bold">🧠 On-device AI · போனிலேயே AI</h2>
        <p className="text-sm text-leaf-100">
          Open-source Whisper runs inside this phone, so voice entries work with no internet. Downloaded once, then cached.
        </p>
      </div>
      <div className="space-y-2">
        {DEVICE_MODELS.map((m) => {
          const active = w.model === m.id && w.state !== 'off';
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { setSettings({ onDeviceModel: m.id }); loadDeviceModel(m.id); }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${active ? 'bg-white text-leaf-900' : 'bg-white/10'}`}
            >
              <span>
                <span className="font-semibold">{m.label}</span>
                <span className="block text-xs opacity-80">{m.note}</span>
              </span>
              <span className="text-sm font-mono">{m.sizeMb} MB</span>
            </button>
          );
        })}
      </div>
      {w.state === 'loading' && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round(w.progress * 100)}%` }} />
          </div>
          <p className="text-xs text-leaf-100">{w.totalMb ? `${w.loadedMb} / ${w.totalMb} MB` : 'Preparing…'}</p>
        </div>
      )}
      {w.state === 'ready' && (
        <p className="text-sm font-semibold text-amber-300">✓ Ready offline{w.lastMs ? ` · last clip ${(w.lastMs / 1000).toFixed(1)} s` : ''}</p>
      )}
      {w.state === 'error' && <p className="rounded-lg bg-red-500/30 p-2 text-sm">{w.error}</p>}
      {chosen && (
        <button type="button" className="text-sm underline" onClick={() => { setSettings({ onDeviceModel: null }); unloadDeviceModel(); }}>
          Turn off on-device AI
        </button>
      )}
    </section>
  );
}


/** The recorded shop voice: progress, on/off and the way into the studio. */
function ShopVoiceCard({ go }) {
  const s = useStore();
  const { t, en } = useT();
  const { has } = useVoiceClips();
  const prog = packProgress('ta');
  const customers = s.customers.filter((c) => !c.deleted_at);
  const names = customers.filter((c) => has(nameClipKey(c))).length;
  const on = s.settings.shopVoice !== false;
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-2 ring-amber-400">
      <div>
        <h2 className="text-lg font-bold text-leaf-900">🎙 <BiLabel k="shop_voice" /></h2>
        <p className="text-sm text-stone-600">
          Replies in a real person's voice (yours, or anyone at the shop) instead of a robot voice. Record once; works offline.
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full bg-amber-500" style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} />
      </div>
      <p className="text-sm text-stone-700">
        Tamil: {prog.done} / {prog.total} {en('recorded')} · {en('names')} {names}/{customers.length}
        {prog.ready && <b className="ml-2 text-leaf-700">✓ Ready</b>}
      </p>
      <Button className="w-full" onClick={() => go('#/voice')}>
        🎙 {prog.started ? 'Continue recording' : 'Record the shop voice'}
      </Button>
      {prog.started && (
        <label className="flex min-h-12 items-center justify-between gap-3">
          <span className="text-sm font-semibold">Speak in the shop voice</span>
          <input type="checkbox" className="h-6 w-6 accent-leaf-800" checked={on} onChange={(e) => setSettings({ shopVoice: e.target.checked })} />
        </label>
      )}
    </section>
  );
}

/** Owner invites staff with a 6-digit code; staff sign in with their own phone and type it. */
function StaffCard() {
  const s = useStore();
  const { t, en } = useT();
  const [members, setMembers] = useState([]);
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const owner = s.shop?.role !== 'staff';
  useEffect(() => {
    if (s.online) listMembers().then(setMembers).catch(() => {});
  }, [s.online, code]);
  const shareText = code
    ? `Join ${s.shop?.name} on Kadan Kanakku: open the app, sign in with your phone, choose "Join a shop with a code" and enter ${code} (valid for 2 days).`
    : '';
  return (
    <Card title="staff">
      <ul className="divide-y divide-stone-100 text-sm">
        {members.map((m) => (
          <li key={m.user_id} className="flex justify-between py-2">
            <span>{m.isMe ? `${t('you')} · ${en('you')}` : `${m.user_id.slice(0, 8)}…`}</span>
            <span className="rounded-full bg-stone-100 px-2 text-xs font-semibold">{m.role === 'owner' ? t('owner') : t('staff')}</span>
          </li>
        ))}
      </ul>
      {owner && !code && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={!s.online}
          onClick={async () => {
            setError(null);
            try { setCode(await createInvite()); } catch (e) { setError(e.message); }
          }}
        >
          + {t('add_staff')} · {en('add_staff')}
        </Button>
      )}
      {code && (
        <div className="space-y-2 rounded-xl bg-leaf-50 p-3 text-center">
          <BiLabel k="invite_code" className="items-center text-sm text-stone-600" />
          <p className="text-4xl font-extrabold tracking-[0.3em] text-leaf-900">{code}</p>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-xl bg-[#25D366] px-4 py-2 font-semibold text-white"
          >
            💬 {t('send')}
          </a>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </Card>
  );
}

export default function Settings({ go }) {
  const s = useStore();
  const { t, en } = useT();
  const w = useWhisperStatus();
  const browserSR = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const st = s.settings;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-28 pt-3">
      <h1 className="text-xl font-extrabold text-leaf-900"><BiLabel k="settings" /></h1>

      <Card>
        <p className="text-lg font-bold">{s.shop?.name}</p>
        <p className="text-sm text-stone-500">{s.mode === 'local' ? `${t('demo_mode')} · ${en('demo_mode')}` : s.session?.user?.phone}</p>
      </Card>

      <OnDeviceAI />

      <ShopVoiceCard go={go} />

      <Card>
        <Choice k="ui_language" value={st.uiLang} onChange={(v) => setSettings({ uiLang: v })} options={[['ta', 'tamil'], ['en', 'english'], ['hi', 'hindi'], ['te', 'telugu']]} />
        <Choice k="speech_language" value={st.speechLang} onChange={(v) => setSettings({ speechLang: v })} options={[['ta-IN', 'tamil'], ['en-IN', 'english'], ['hi-IN', 'hindi'], ['te-IN', 'telugu']]} />
        <Choice k="reply_language" value={st.replyLang} onChange={(v) => setSettings({ replyLang: v })} options={[['auto', 'auto'], ['ta', 'tamil'], ['en', 'english'], ['hi', 'hindi'], ['te', 'telugu']]} />
        <Choice k="voice_output" value={st.voice} onChange={(v) => setSettings({ voice: v })} options={[['auto', 'auto'], ['phone', 'phone_voice'], ['server', 'server_voice']]} />
        <Choice k="hf_wait" value={st.handsFreeWait || 'normal'} onChange={(v) => setSettings({ handsFreeWait: v })} options={[['short', 'wait_short'], ['normal', 'wait_normal'], ['long', 'wait_long']]} />
        <Button variant="secondary" className="w-full" onClick={() => { const l = ['ta', 'en', 'hi', 'te'].includes(st.replyLang) ? st.replyLang : (st.speechLang || 'ta-IN').slice(0, 2); speak(reply('credit_saved', l, { name: 'Murugan anna', nameSay: l === 'ta' ? 'முருகன் அண்ணா' : 'Murugan anna', nameKey: 'murugan anna', amt: '240', amtSay: '240', amtN: 240, total: '1,140', totalSay: '1140', totalN: 1140 })); }}>
          🔊 {t('test_voice')} · {en('test_voice')}
        </Button>
      </Card>

      <Card title="server_status">
        <ul className="divide-y divide-stone-100 text-sm">
          <Status ok={s.mode === 'cloud' && s.server.stt} label="Whisper large-v3 (server)" detail={s.mode === 'cloud' ? (s.server.stt ? 'on' : 'not set') : 'demo'} />
          <Status ok={s.mode === 'cloud' && s.server.nlu} label="Open LLM (server)" detail={s.mode === 'cloud' ? (s.server.nlu ? 'on' : 'not set') : 'demo'} />
          <Status ok={w.state === 'ready'} label="Whisper (on this phone)" detail={w.state} />
          <Status ok label="Tamil grammar parser (on this phone)" detail="always" />
          <Status ok={browserSR} label="Browser speech recognition" detail={browserSR ? 'fallback' : 'n/a'} />
          {['ta', 'hi', 'te'].map((l) => {
            const v = voicePlanFor(l);
            return (
              <Status
                key={l}
                ok={v.kind === 'phone'}
                label={`${{ ta: 'Tamil', hi: 'Hindi', te: 'Telugu' }[l]} voice on phone`}
                detail={v.kind === 'phone' ? v.name : v.kind === 'indian-english' ? 'Indian English reads it' : 'missing: text only'}
              />
            );
          })}
          <Status ok={s.mode === 'cloud' && s.server.tts} label="Indic Parler-TTS (server)" detail={s.mode === 'cloud' ? (s.server.tts ? 'on' : 'not set') : 'demo'} />
        </ul>
      </Card>

      <Button variant="secondary" className="w-full" onClick={() => go('#/lab')}>
        🎯 {t('accuracy_lab')} · {en('accuracy_lab')}
      </Button>

      {s.mode === 'cloud' && <StaffCard />}

      {s.mode === 'cloud' ? (
        <Card>
          <p className="text-sm text-stone-600">
            {t('pending_sync')}: <b>{s.outbox}</b>
            {s.lastSync && <> · {new Date(s.lastSync).toLocaleString('en-IN')}</>}
          </p>
          {s.syncError && <p className="text-xs text-red-700">{s.syncError}</p>}
          <Button variant="secondary" className="w-full" disabled={!s.online || s.syncing} onClick={syncNow}>↻ {t('sync_now')} · {en('sync_now')}</Button>
          <Button variant="ghost" className="w-full text-red-700" onClick={signOut}>{t('sign_out')} · {en('sign_out')}</Button>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-stone-600">
            Demo mode keeps everything on this phone. Add Supabase keys (see README) for phone login, cloud backup, sync and server AI.
          </p>
          <Button variant="ghost" className="w-full text-red-700" onClick={() => confirm('Reset demo data?') && resetDemo()}>
            {t('reset_demo')} · {en('reset_demo')}
          </Button>
        </Card>
      )}

      <p className="px-2 text-center text-xs text-stone-500">
        Kadan Kanakku · MIT licensed · Whisper (MIT) · Transformers.js (Apache-2.0) · Supabase (Apache-2.0)
      </p>
    </div>
  );
}
