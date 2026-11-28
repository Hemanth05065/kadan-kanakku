import { describe, it, expect } from 'vitest';
import { upiLink, isVpa, encodePay, decodePay, payRequest, payPageUrl, shopUpi } from './upi.js';
import { reminderText } from './whatsapp.js';
import { parseLocal } from './localParser.js';
import { buildNameIndex } from './names.js';
import { decide, EMPTY_CONVO } from '../voice/decide.js';
import { planReply, scriptItems } from '../voice/voicePack.js';
import { handsFreeShouldAct } from '../voice/vad.js';
import { setReplyVariety } from '../i18n/index.js';

const BASE = 'https://shop.example/';
const settings = { upiId: 'murugan.stores@okaxis', upiName: 'Murugan Stores' };
const murugan = { id: 'm', name: 'Murugan', honorific: 'anna', name_ta: 'முருகன் அண்ணா', deleted_at: null };

describe('the UPI link', () => {
  it('is the standard upi://pay link every UPI app understands', () => {
    expect(upiLink({ vpa: 'murugan.stores@okaxis', name: 'Murugan Stores', amount: 1140, note: 'Kadan' }))
      .toBe('upi://pay?pa=murugan.stores@okaxis&pn=Murugan%20Stores&am=1140.00&cu=INR&tn=Kadan');
    expect(upiLink({ vpa: '9876543210@ybl', amount: 12.5 })).toBe('upi://pay?pa=9876543210@ybl&am=12.50&cu=INR');
    expect(upiLink({ vpa: 'a1@upi', amount: 0 })).toBe('upi://pay?pa=a1@upi&cu=INR'); // customer types the amount
  });

  it('accepts real UPI IDs and refuses anything else', () => {
    for (const ok of ['murugan.stores@okaxis', '9876543210@ybl', 'selvi-akka_1@paytm', 'shop@oksbi']) expect(isVpa(ok)).toBe(true);
    for (const bad of ['', 'murugan', '@okaxis', 'a b@ybl', 'x@1bank', 'murugan@', 'javascript:alert(1)@x']) expect(isVpa(bad)).toBe(false);
  });
});

describe('the pay page link', () => {
  it('carries everything in the link, Tamil names included', () => {
    const pay = { vpa: 'murugan.stores@okaxis', name: 'முருகன் ஸ்டோர்ஸ்', amount: 1140, customer: 'செல்வி அக்கா', shop: 'Murugan Stores', note: 'Kadan' };
    expect(decodePay(encodePay(pay))).toEqual(pay);
    const url = payPageUrl(pay, BASE);
    expect(url.startsWith(`${BASE}#/pay?d=`)).toBe(true);
    expect(url).not.toMatch(/[+/=]$/); // URL-safe
  });

  it('a broken or tampered link shows nothing to pay', () => {
    expect(decodePay('not-base64!!')).toBeNull();
    expect(decodePay(encodePay({ vpa: 'not a vpa', amount: 5 }))).toBeNull();
    expect(decodePay(encodePay({ vpa: 'a1@upi', amount: -40 })).amount).toBe(0);
    expect(decodePay(encodePay({ vpa: 'a1@upi', amount: 1e9 })).amount).toBe(0);
  });

  it('a payment request needs the shop\'s UPI ID and something owed', () => {
    expect(payRequest(murugan, 1140, {}, 'Murugan Stores', BASE)).toBeNull();
    expect(payRequest(murugan, 0, settings, 'Murugan Stores', BASE)).toBeNull();
    const req = payRequest(murugan, 1140, settings, 'Murugan Stores', BASE);
    expect(req.link).toBe('upi://pay?pa=murugan.stores@okaxis&pn=Murugan%20Stores&am=1140.00&cu=INR&tn=Murugan%20Stores%20%C2%B7%20Murugan%20anna');
    expect(decodePay(req.page.split('d=')[1])).toMatchObject({ amount: 1140, customer: 'Murugan anna', vpa: 'murugan.stores@okaxis' });
    expect(shopUpi({ upiId: 'shop@ybl' }, 'Selvi Stores')).toEqual({ vpa: 'shop@ybl', name: 'Selvi Stores' });
  });

  it('the WhatsApp reminder ends with the pay link', () => {
    const text = reminderText(murugan, 1140, 'Murugan Stores', 'ta', { payUrl: 'https://shop.example/#/pay?d=x' });
    expect(text).toContain('₹1,140');
    expect(text.endsWith('UPI-ல கட்ட: https://shop.example/#/pay?d=x')).toBe(true);
    expect(reminderText(murugan, 1140, 'Murugan Stores', 'en')).not.toContain('UPI');
  });
});

describe('"Murugan anna-ku QR kaattu"', () => {
  const customers = [murugan, { id: 's', name: 'Selvi', honorific: 'akka', deleted_at: null }];
  const index = buildNameIndex(customers, []);
  const parse = (text) => parseLocal(text, { index });
  const entries = [{ id: 'e1', customer_id: 'm', type: 'credit', amount: 1140, status: 'confirmed', deleted_at: null, created_at: '2026-11-20T10:00:00Z' }];
  const ctx = (upi = true) => ({ customers, entries, aliases: [], index, replyLang: 'auto', upi, lastUndoable: () => null, justSaved: null });
  const run = (text, upi) => decide({ ...parse(text), transcript: text }, EMPTY_CONVO, ctx(upi));

  it.each([
    ['Murugan anna-ku QR kaattu', 'show_pay', 'm', null],
    ['முருகன் அண்ணா QR காட்டு', 'show_pay', 'm', null],
    ['Selvi akka 500 QR', 'show_pay', 's', 500],
    ['Show the QR for Selvi', 'show_pay', 's', null],
    ['Murugan ka QR dikhao', 'show_pay', 'm', null],
    ['Murugan QR chupinchu', 'show_pay', 'm', null],
    ['Murugan anna 500 GPay-la kuduthaar', 'payment', 'm', 500], // paid by GPay: a payment, not a QR
  ])('"%s" -> %s', (text, intent, id, amount) => {
    expect(parse(text)).toMatchObject({ intent, customer_id: id, amount });
  });

  it('shows the QR for what they owe, and says so', () => {
    setReplyVariety(false);
    const a = run('Murugan anna-ku QR kaattu');
    expect(a).toMatchObject({ kind: 'show_pay', customerId: 'm', amount: 1140 });
    expect(a.reply.show).toBe('Murugan anna, 1,140 roobaai. QR kaattren, scan pannunga.');
    const script = new Set(scriptItems('ta').map((i) => i.key));
    expect(planReply(a.reply, (k) => script.has(k) || k.startsWith('name:')).filter((s) => s.clip).map((s) => s.clip))
      .toEqual(['name:murugan anna', 'aayirathi', 'h100', 'n40', 'roobaai', 'qr_kaattren']);
    setReplyVariety(true);
  });

  it('a spoken amount wins; nothing owed or no UPI ID gets an answer instead of a QR', () => {
    expect(run('Murugan anna 500 QR')).toMatchObject({ kind: 'show_pay', amount: 500 });
    expect(run('Selvi akka QR kaattu')).toMatchObject({ kind: 'answer', reply: { key: 'balance_zero' } });
    expect(run('Murugan anna-ku QR kaattu', false)).toMatchObject({ kind: 'answer', reply: { key: 'upi_missing' } });
    expect(run('QR kaattu')).toMatchObject({ kind: 'ask', awaiting: 'customer' });
  });

  it('hands-free acts on it when a name is said', () => {
    expect(handsFreeShouldAct({ intent: 'show_pay', customer_name: 'murugan' })).toBe(true);
    expect(handsFreeShouldAct({ intent: 'show_pay' })).toBe(false); // "scan pannunga" said to a customer
  });
});
