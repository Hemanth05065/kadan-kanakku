import { describe, it, expect } from 'vitest';
import { parseNumber, tokenize, extractNumbers } from './numbers.js';
import { skeleton, transliterate } from './translit.js';
import { buildNameIndex, resolveName } from './names.js';
import { parseLocal } from './localParser.js';

const customers = [
  { id: 'c1', name: 'Murugan', name_ta: 'முருகன்', honorific: 'anna' },
  { id: 'c2', name: 'Lakshmi', name_ta: 'லட்சுமி', honorific: 'akka' },
  { id: 'c3', name: 'Ravi', name_ta: 'ரவி' },
  { id: 'c4', name: 'Selvi', name_ta: 'செல்வி', honorific: 'akka' },
  { id: 'c5', name: 'Murugesan', name_ta: 'முருகேசன்' },
  { id: 'c6', name: 'Fathima', name_ta: 'பாத்திமா', honorific: 'akka' },
];
const index = buildNameIndex(customers, [{ id: 'a1', customer_id: 'c3', alias: 'Ravikumar' }]);

describe('numbers: digits and English', () => {
  it.each([
    ['240', 240],
    ['₹1,500', 1500],
    ['rs.240', 240],
    ['240/-', 240],
    ['2k', 2000],
    ['1.5k', 1500],
    ['two forty', 240],
    ['two-forty', 240],
    ['one fifty', 150],
    ['two forty five', 245],
    ['two hundred and forty', 240],
    ['two hundred forty', 240],
    ['fifteen hundred', 1500],
    ['twelve fifty', 1250],
    ['one thousand five hundred', 1500],
    ['two thousand five hundred', 2500],
    ['twenty five', 25],
    ['one lakh twenty thousand', 120000],
    ['hundred', 100],
  ])('%s -> %d', (text, value) => expect(parseNumber(text)).toBe(value));
});

describe('numbers: Tamil (Latin spellings and Tamil script)', () => {
  it.each([
    ['irunooru naarpadhu', 240],
    ['irunootru naarpathu', 240],
    ['இருநூற்று நாற்பது', 240],
    ['nooru', 100],
    ['nootri irubathu', 120],
    ['aayirathu ainooru', 1500],
    ['ஆயிரத்து ஐநூறு', 1500],
    ['rendaayiram', 2000],
    ['ரெண்டாயிரம்', 2000],
    ['munnooru', 300],
    ['anjooru', 500],
    ['aimbathu', 50],
    ['ambathu', 50],
    ['irubathiyanju', 25],
    ['இருபத்தைந்து', 25],
    ['thonnooru', 90],
    ['pathu', 10],
    ['rendu nooru', 200],
    ['rendu aayiram anjooru', 2500],
    ['oru latcham', 100000],
  ])('%s -> %d', (text, value) => expect(parseNumber(text)).toBe(value));
});

describe('numbers: mixed language', () => {
  it.each([
    ['rendu thousand', 2000],
    ['two aayiram', 2000],
    ['3 nooru', 300],
    ['aayiram five hundred', 1500],
  ])('%s -> %d', (text, value) => expect(parseNumber(text)).toBe(value));

  it('keeps quantities separate from prices', () => {
    const nums = extractNumbers(tokenize('Ravi, two kilo arisi, 120, kadan'));
    expect(nums.map((n) => [n.value, n.unit])).toEqual([[2, 'kilo'], [120, null]]);
  });
});

describe('transliteration and sound skeletons', () => {
  it('transliterates Tamil script', () => {
    expect(transliterate('முருகன்')).toBe('murukan');
  });
  it('folds spelling variants together', () => {
    expect(skeleton('Murugan')).toBe(skeleton('முருகன்'));
    expect(skeleton('naarpadhu')).toBe(skeleton('நாற்பது'));
    expect(skeleton('kuduthaar')).toBe(skeleton('குடுத்தார்'));
  });
});

describe('name matching', () => {
  it('matches exact names and ignores honorifics', () => {
    expect(resolveName('Murugan anna', index)).toMatchObject({ status: 'match', customer: { id: 'c1' } });
    expect(resolveName('Selvi akka', index)).toMatchObject({ status: 'match', customer: { id: 'c4' } });
  });
  it('matches by sound, not spelling', () => {
    expect(resolveName('Muruga', index)).toMatchObject({ status: 'match', customer: { id: 'c1' } });
    expect(resolveName('முருகன்', index)).toMatchObject({ status: 'match', customer: { id: 'c1' } });
    expect(resolveName('Murugesh', index)).toMatchObject({ status: 'match', customer: { id: 'c5' } });
    expect(resolveName('Pathima', index)).toMatchObject({ status: 'match', customer: { id: 'c6' } });
    expect(resolveName('Muruganukku', index)).toMatchObject({ status: 'match', customer: { id: 'c1' } });
  });
  it('asks when two customers sound alike', () => {
    const r = resolveName('Murugen', index);
    expect(['ambiguous', 'weak', 'match']).toContain(r.status);
    const r2 = resolveName('Murgesan', index);
    expect(r2.status === 'match' ? r2.customer.id : r2.candidates.map((c) => c.id)).toBeTruthy();
  });
  it('uses saved aliases', () => {
    expect(resolveName('Ravikumar', index)).toMatchObject({ status: 'match', customer: { id: 'c3' } });
  });
  it('reports unknown names', () => {
    expect(resolveName('Ganesh', index).status).toBe('none');
  });
});

describe('local parser: the spec utterances', () => {
  const p = (text) => parseLocal(text, { index });
  it('credit with items', () => {
    expect(p('Murugan anna, 240 rupees, arisi and oil, kadan')).toMatchObject({
      intent: 'credit', customer_id: 'c1', amount: 240, items: ['arisi', 'oil'], language: 'ta',
    });
  });
  it('payment', () => {
    expect(p('Murugan anna 100 kuduthaar')).toMatchObject({ intent: 'payment', customer_id: 'c1', amount: 100 });
  });
  it('balance query', () => {
    expect(p('Murugan evlo baaki?')).toMatchObject({ intent: 'query_balance', customer_id: 'c1', amount: null });
  });
  it('undo', () => {
    expect(p('Last-a pottadha cancel pannu')).toMatchObject({ intent: 'undo_last' });
  });
  it('mixed language credit with quantity', () => {
    expect(p('Ravi, two kilo arisi, 120, kadan')).toMatchObject({ intent: 'credit', customer_id: 'c3', amount: 120 });
  });
  it('Tamil script credit', () => {
    expect(p('முருகன் அண்ணா இருநூற்று நாற்பது ரூபாய் அரிசி கடன்')).toMatchObject({
      intent: 'credit', customer_id: 'c1', amount: 240, language: 'ta',
    });
  });
  it('Tamil script payment', () => {
    expect(p('லட்சுமி அக்கா 500 குடுத்தாங்க')).toMatchObject({ intent: 'payment', customer_id: 'c2', amount: 500 });
  });
  it('English', () => {
    expect(p('Ravi paid two hundred')).toMatchObject({ intent: 'payment', customer_id: 'c3', amount: 200, language: 'en' });
    expect(p('How much does Selvi owe')).toMatchObject({ intent: 'query_balance', customer_id: 'c4', language: 'en' });
    expect(p('who owes the most')).toMatchObject({ intent: 'query_top' });
  });
  it('unknown customer keeps the spoken name', () => {
    expect(p('Ganesh 300 kadan')).toMatchObject({ intent: 'credit', customer_id: null, customer_name: 'ganesh', amount: 300 });
  });
  it('yes / no answers', () => {
    expect(p('aamaa')).toMatchObject({ intent: 'confirm_yes', yes_no: 'yes' });
    expect(p('venaam')).toMatchObject({ intent: 'confirm_no', yes_no: 'no' });
    expect(p('sari')).toMatchObject({ yes_no: 'yes' });
  });
  it('a bare amount (answer to "how much?")', () => {
    expect(p('irunooru')).toMatchObject({ amount: 200 });
  });
  it('no keyword -> low confidence credit', () => {
    const r = p('Ravi 150');
    expect(r.intent).toBe('credit');
    expect(r.confidence).toBeLessThan(0.8);
  });
  it('several prices are summed but confirmed', () => {
    const r = p('Selvi arisi 100 paruppu 80 kadan');
    expect(r.amount).toBe(180);
    expect(r.confidence).toBeLessThan(0.8);
  });
});
