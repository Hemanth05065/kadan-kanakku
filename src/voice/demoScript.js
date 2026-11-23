// The scripted counter conversation played by the demo autopilot (Home → ▶ Demo).
// Runs on the freshly reset demo shop, through the real understanding + decision logic.
// `note` is the caption shown to the audience.

export const DEMO_SCRIPT = [
  { say: 'Murugan anna, 240 rupees, arisi and oil, kadan', note: 'Credit by voice: confirmed aloud, saved after 3 s' },
  { say: 'Murugan anna 100 kuduthaar', note: 'Payment, with the new balance spoken back' },
  { say: 'Murugan evlo baaki?', note: 'Balance question' },
  { say: 'Murugasan 300 kadan', note: 'Two customers sound alike, so it asks…', pause: 300 },
  { tap: 'Murugan anna', note: '…and remembers the answer as an alias' },
  { say: 'Ganesh 150 kadan', note: 'Unknown name: offers to add a new customer', pause: 300 },
  { say: 'aamaa', note: 'Yes: customer added, entry continues' },
  { say: 'Selvi akka 2500 kadan', note: 'Above ₹2,000: confirms before saving', pause: 300 },
  { say: 'sari', note: 'Confirmed' },
  { say: 'Last-a pottadha cancel pannu', note: 'Voice undo' },
  { say: 'Ravi, two kilo arisi, nootri irubathu, kadan', note: 'Mixed Tamil + English numbers: "2 kilo" is a quantity, ₹120 is the price' },
  { say: 'How much does Lakshmi owe?', note: 'Spoken in English, answered in English' },
  { say: 'Ravi ka kitna baaki hai?', note: 'Hindi works too' },
  { say: 'Indru kanakku evlo?', note: "Closing time: today's summary" },
];
