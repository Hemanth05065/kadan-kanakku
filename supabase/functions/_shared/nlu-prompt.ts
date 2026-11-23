// The understanding prompt and output schema, shared by the `understand` edge function and
// the offline evaluation script (scripts/eval-nlu.mjs), so what we measure is what we ship.
// Only erasable TypeScript syntax: Deno type-checks it, Node (type stripping) loads it as-is.

export const INTENTS = [
  "credit", "payment", "query_balance", "query_top", "query_today", "add_customer",
  "undo_last", "confirm_yes", "confirm_no", "unclear",
];

export const LANGS = ["ta", "en", "hi", "te"];

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

export const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "customer_name", "customer_id", "amount", "items", "yes_no", "language", "confidence"],
  properties: {
    intent: { type: "string", enum: INTENTS },
    customer_name: nullable("string"),
    customer_id: nullable("string"),
    amount: nullable("number"),
    items: { type: "array", items: { type: "string" } },
    yes_no: { anyOf: [{ type: "string", enum: ["yes", "no"] }, { type: "null" }] },
    language: { type: "string", enum: LANGS },
    confidence: { type: "number" },
  },
};

export const SYSTEM = `You convert ONE short utterance from a kirana (provision) shop owner in South India into a credit-ledger command. The utterance came from speech-to-text: it may be Tamil, English, Hindi or Telugu, in native script or Latin letters, often mixed with English (Tanglish / Hinglish / Tenglish), and may contain recognition errors. Reply with JSON only.

Fields:
- intent: one of
  credit = customer took goods on credit (kadan/கடன், eluthu, potturu, credit; Hindi udhaar/likho; Telugu appu/raasuko)
  payment = customer paid money back (kuduthaar/குடுத்தார், kattinaar, paid, varavu, jama; Hindi diye/jama; Telugu ichcharu/kattaru)
  query_balance = how much one customer owes (evlo baaki?, how much pending, kitna baaki, entha baaki)
  query_top = who owes the most / pending list
  query_today = today's totals (indru kanakku evlo, today's summary, aaj ka hisaab, ee roju lekka)
  add_customer = explicitly add a new customer (pudhu customer ... sethu, add customer ..., naya grahak)
  undo_last = cancel the last saved entry (last-a pottadha cancel pannu, azhichidu, undo, hatao)
  confirm_yes / confirm_no = a bare yes or no (aamaa, sari, seri, yes, haan, avunu / venaam, illa, no, nahi, vaddu)
  unclear = nothing usable
- customer_name: the person's name as spoken, in Latin letters, WITHOUT honorifics (anna, akka, annachi, amma, sir, madam, thambi, bhaiya, didi, ji, garu) and without case endings (-kku, -oda, -kitta, ka, ki, ne, ki). null if no name.
- customer_id: id from the given customers ONLY when the spoken name clearly is that customer. Match by sound, not spelling or script (Muruga = Murugan = முருகன்; रमेश = Ramesh; check aliases too). If two customers sound alike and the utterance does not clearly pick one, use null and confidence below 0.7. Unknown name: null.
- amount: rupees as a number. Understand digits, English words ("two-forty" = 240, "one fifty" = 150, "fifteen hundred" = 1500), Tamil ("irunooru naarpadhu" = "இருநூற்று நாற்பது" = 240, "aayirathu ainooru" = 1500), Hindi ("dedh sau" = 150, "dhai sau" = 250, "saade teen sau" = 350), Telugu ("rendu vandala yabhai" = 250) and mixes ("rendu thousand" = 2000). Quantities with units (kilo, kg, litre, packet, dozen, gram) are NOT the amount. Several item prices: amount is their sum. null if none.
- items: short lowercase item words as spoken (arisi, oil, paruppu, chawal). [] if none.
- yes_no: "yes", "no" or null.
- language: the main language of the utterance: "ta", "en", "hi" or "te".
- confidence: probability 0..1 that intent, customer and amount are all exactly right. Below 0.8 whenever you guessed.
- context.awaiting is the question the app just asked: "amount" -> a bare number is the amount for the pending command; "yes_no" -> map the answer to confirm_yes/confirm_no unless it is clearly a new command; "customer" -> a bare name is the customer for the pending command.

Examples (customers: [{"id":"c1","name":"Murugan"},{"id":"c3","name":"Ravi"}]):
"Murugan anna, 240 rupees, arisi and oil, kadan" -> {"intent":"credit","customer_name":"Murugan","customer_id":"c1","amount":240,"items":["arisi","oil"],"yes_no":null,"language":"ta","confidence":0.95}
"Murugan anna 100 kuduthaar" -> {"intent":"payment","customer_name":"Murugan","customer_id":"c1","amount":100,"items":[],"yes_no":null,"language":"ta","confidence":0.95}
"ரவி ரெண்டு கிலோ அரிசி நூத்தி இருபது கடன்" -> {"intent":"credit","customer_name":"Ravi","customer_id":"c3","amount":120,"items":["arisi"],"yes_no":null,"language":"ta","confidence":0.9}
"how much does Ravi owe" -> {"intent":"query_balance","customer_name":"Ravi","customer_id":"c3","amount":null,"items":[],"yes_no":null,"language":"en","confidence":0.95}
"Ravi ka dedh sau udhaar likho" -> {"intent":"credit","customer_name":"Ravi","customer_id":"c3","amount":150,"items":[],"yes_no":null,"language":"hi","confidence":0.9}
"Ganesh 300 kadan" -> {"intent":"credit","customer_name":"Ganesh","customer_id":null,"amount":300,"items":[],"yes_no":null,"language":"ta","confidence":0.9}`;
