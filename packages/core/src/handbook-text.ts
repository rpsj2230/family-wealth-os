/**
 * Every fixed text the family handbook writes, in English and in Hindi, each with a "simple words" variant where the text is a step,
 * a checklist line or a note. The stored handbook keeps only keys and their values (names, numbers, dates), so one stored copy can be
 * read in either language and either style; names, numbers, bank names and the family's own message are never translated.
 *
 * A test fails when a text has no Hindi, or a step, checklist line or note has no simple variant. Pure: no I/O.
 */
import { formatInr, formatInrCompact } from './money';
import { termLabel } from './terms';

export type HbLang = 'en' | 'hi';
export type HbParam = string | number | string[] | null;
export type HbParams = Record<string, HbParam>;

/** How values are written in each language. */
export interface HbFmt {
  lang: HbLang;
  /** "1 January 2027" / "1 जनवरी 2027" */
  date: (iso: string) => string;
  /** "26 Oct 2026, 09:30" */
  dateTime: (iso: string) => string;
  /** full rupees, or "not recorded" */
  inr: (n: number | null) => string;
  /** lakh / crore: "₹3.40 Cr" */
  short: (n: number) => string;
  /** "a, b and c" / "a, b और c" */
  list: (xs: string[]) => string;
}

type Line = string | ((p: HbParams, f: HbFmt) => string);
export interface HbEntry {
  en: Line;
  hi: Line;
  /** shorter, plainer words; falls back to `en` */
  enPlain?: Line;
  /** shorter, plainer words in Hindi; falls back to `hi` */
  hiPlain?: Line;
}

const s = (p: HbParams, k: string) => {
  const v = p[k];
  return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v);
};
const n = (p: HbParams, k: string) => Number(p[k] ?? 0);
const l = (p: HbParams, k: string): string[] => {
  const v = p[k];
  return Array.isArray(v) ? v : [];
};
const en1 = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
const hi1 = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

export const HB_TEXT = {
  // ---------------------------------------------------------------- page
  title: {
    en: (p) => `${s(p, 'household')}: family handbook`,
    hi: (p) => `${s(p, 'household')}: परिवार की मार्गदर्शिका`,
  },
  updated: {
    en: (p, f) => `Written from the family’s records. Last updated ${f.dateTime(s(p, 'at'))}.`,
    hi: (p, f) => `परिवार के रिकॉर्ड से बनी। आख़िरी बार ${f.dateTime(s(p, 'at'))} को अपडेट हुई।`,
  },
  disclaimer: {
    en: 'General guidance, not legal or tax advice. Figures are estimates built from recorded values, interest and prices, not bank statements. This handbook does not move money or give anyone the right to it.',
    hi: 'यह सामान्य मार्गदर्शन है, क़ानूनी या टैक्स सलाह नहीं। रक़में अनुमान हैं, जो दर्ज रक़मों, ब्याज और भावों से निकाली गई हैं, बैंक स्टेटमेंट से नहीं। यह मार्गदर्शिका न पैसा कहीं भेजती है, न किसी को उस पर हक़ देती है।',
    enPlain: 'General guidance only, not legal or tax advice. All figures are estimates.',
    hiPlain: 'यह सिर्फ़ सामान्य मार्गदर्शन है, क़ानूनी या टैक्स सलाह नहीं। सभी रक़में अनुमान हैं।',
  },
  'ui.print': { en: 'Print or save as PDF', hi: 'प्रिंट करें या PDF में सेव करें' },
  'ui.refresh': { en: 'Update now', hi: 'अभी अपडेट करें' },
  'ui.reading': { en: 'Reading options', hi: 'पढ़ने के विकल्प' },
  'ui.language': { en: 'Language', hi: 'भाषा' },
  'ui.simple': { en: 'Simple words', hi: 'आसान शब्द' },
  'ui.larger': { en: 'Larger text', hi: 'बड़े अक्षर' },
  'ui.sections': { en: 'Sections', hi: 'हिस्से' },
  'ui.done': {
    en: (p) => `${n(p, 'done')} of ${n(p, 'total')} done`,
    hi: (p) => `${n(p, 'total')} में से ${n(p, 'done')} हो गए`,
  },
  'ui.tickedBy': {
    en: (p, f) => `Ticked by ${s(p, 'who')} on ${f.dateTime(s(p, 'at'))}`,
    hi: (p, f) => `${s(p, 'who')} ने ${f.dateTime(s(p, 'at'))} को निशान लगाया`,
  },
  'who.you': { en: 'you', hi: 'आप' },
  'who.viewer': { en: 'the family login', hi: 'परिवार वाले लॉगिन' },
  'who.member': { en: 'a family member', hi: 'परिवार के एक सदस्य' },
  'ui.sampleTicks': {
    en: 'In this sample, ticks stay in this browser only. Nothing is saved.',
    hi: 'इस नमूने में निशान सिर्फ़ इसी ब्राउज़र में रहते हैं। कुछ भी सेव नहीं होता।',
  },
  'ui.tickFailed': {
    en: 'That tick could not be saved. Please try again in a moment.',
    hi: 'यह निशान सेव नहीं हो सका। कृपया थोड़ी देर बाद फिर कोशिश करें।',
  },
  'ui.tickShared': {
    en: 'Tick a step when it is done. Everyone who opens this handbook sees the ticks.',
    hi: 'जो काम हो जाए, उस पर निशान लगाएँ। यह मार्गदर्शिका खोलने वाले सभी लोग ये निशान देखते हैं।',
    enPlain: 'Tick each step when it is done.',
    hiPlain: 'हर काम होने पर निशान लगाएँ।',
  },
  'ui.dial': {
    en: (p) => `Call ${s(p, 'name')}`,
    hi: (p) => `${s(p, 'name')} को फ़ोन करें`,
  },

  // ---------------------------------------------------------------- start card
  'start.kicker': { en: 'Start here', hi: 'यहाँ से शुरू करें' },
  'start.defaultMessage': {
    en: 'We made this so you are never left wondering what to do. You are not alone, and nothing here has to be done today.',
    hi: 'हमने यह इसलिए बनाया है ताकि आपको कभी यह सोचना न पड़े कि अब क्या करें। आप अकेले नहीं हैं, और इनमें से कुछ भी आज ही करना ज़रूरी नहीं है।',
    enPlain: 'You are not alone. Nothing here has to be done today.',
    hiPlain: 'आप अकेले नहीं हैं। इनमें से कुछ भी आज करना ज़रूरी नहीं है।',
  },
  'start.call': {
    en: (p) => `Call ${s(p, 'name')} first`,
    hi: (p) => `सबसे पहले ${s(p, 'name')} को फ़ोन करें`,
  },
  'start.noCall': {
    en: 'No one to call has been written down yet. Ask a trusted adult in the family.',
    hi: 'अभी तक फ़ोन करने के लिए किसी का नाम नहीं लिखा गया है। परिवार के किसी भरोसेमंद बड़े से पूछें।',
    enPlain: 'Ask a trusted adult in the family.',
    hiPlain: 'परिवार के किसी भरोसेमंद बड़े से पूछें।',
  },
  'start.have': {
    en: (p, f) => {
      const parts = [
        n(p, 'banks') ? en1(n(p, 'banks'), 'bank', 'banks') : '',
        n(p, 'funds') ? en1(n(p, 'funds'), 'fund', 'funds') : '',
        n(p, 'policies')
          ? en1(n(p, 'policies'), 'insurance policy', 'insurance policies')
          : '',
      ].filter(Boolean);
      if (parts.length === 0) return 'No accounts, funds or policies are recorded yet.';
      return n(p, 'total') > 0
        ? `About ${f.short(n(p, 'total'))} in ${f.list(parts)} — details below.`
        : `${f.list(parts)} — details below.`;
    },
    hi: (p, f) => {
      const parts = [
        n(p, 'banks') ? hi1(n(p, 'banks'), 'बैंक', 'बैंकों') : '',
        n(p, 'funds') ? hi1(n(p, 'funds'), 'फ़ंड', 'फ़ंडों') : '',
        n(p, 'policies') ? hi1(n(p, 'policies'), 'बीमा पॉलिसी', 'बीमा पॉलिसियों') : '',
      ].filter(Boolean);
      if (parts.length === 0) return 'अभी कोई खाता, फ़ंड या पॉलिसी दर्ज नहीं है।';
      return n(p, 'total') > 0
        ? `लगभग ${f.short(n(p, 'total'))}, ${f.list(parts)} में — पूरी जानकारी नीचे है।`
        : `${f.list(parts)} — पूरी जानकारी नीचे है।`;
    },
  },
  'start.calm': {
    en: 'Take your time. Go one step at a time, in the order below.',
    hi: 'आराम से। नीचे दिए क्रम में एक-एक क़दम आगे बढ़ें।',
    enPlain: 'Go one step at a time.',
    hiPlain: 'एक-एक क़दम चलें।',
  },

  // ---------------------------------------------------------------- who to call
  'sec.call': { en: 'Who to call, in this order', hi: 'किसे फ़ोन करें, इसी क्रम में' },
  'sec.advisers': {
    en: 'Advisers: lawyer, accountant, agents',
    hi: 'सलाहकार: वकील, अकाउंटेंट, एजेंट',
  },
  'call.none': {
    en: 'No one has been written down yet. Ask a trusted adult in the family, or look at the paper copy of this handbook.',
    hi: 'अभी तक किसी का नाम नहीं लिखा गया है। परिवार के किसी भरोसेमंद बड़े से पूछें, या इस मार्गदर्शिका की छपी हुई कॉपी देखें।',
    enPlain: 'No one has been written down yet. Ask a trusted adult.',
    hiPlain: 'अभी किसी का नाम नहीं लिखा है। किसी भरोसेमंद बड़े से पूछें।',
  },
  'call.noNumber': { en: 'no number written down', hi: 'कोई नंबर नहीं लिखा' },

  // ---------------------------------------------------------------- timeline
  'sec.timeline': { en: 'The first days, step by step', hi: 'शुरुआती दिन, एक-एक क़दम' },
  'phase.week': { en: 'First week', hi: 'पहला हफ़्ता' },
  'phase.month': { en: 'First 30 days', hi: 'पहले 30 दिन' },
  'phase.quarter': { en: 'First 90 days', hi: 'पहले 90 दिन' },
  'step.breathe': {
    en: 'Take a breath. Look after each other first; money matters can wait a few days.',
    enPlain: 'Look after each other first. Money can wait.',
    hi: 'एक गहरी साँस लें। पहले एक-दूसरे का ख़याल रखें; पैसे के काम कुछ दिन रुक सकते हैं।',
    hiPlain: 'पहले एक-दूसरे का ख़याल रखें। पैसा रुक सकता है।',
  },
  'step.call': {
    en: 'Call the people listed under “Who to call”, in that order. They know where the papers are.',
    enPlain: 'Call the people in “Who to call”.',
    hi: '“किसे फ़ोन करें” में लिखे लोगों को उसी क्रम में फ़ोन करें। उन्हें पता है कि काग़ज़ कहाँ रखे हैं।',
    hiPlain: '“किसे फ़ोन करें” वाले लोगों को फ़ोन करें।',
  },
  'step.certificates': {
    en: 'Ask for 10 or more certified copies of the death certificate. Almost every bank, fund house and insurer asks for one.',
    enPlain: 'Get 10 or more copies of the death certificate.',
    hi: 'मृत्यु प्रमाणपत्र की 10 या उससे ज़्यादा सत्यापित प्रतियाँ बनवाएँ। लगभग हर बैंक, फ़ंड हाउस और बीमा कंपनी एक प्रति माँगती है।',
    hiPlain: 'मृत्यु प्रमाणपत्र की 10 या ज़्यादा प्रतियाँ बनवाएँ।',
  },
  'step.noHurry': {
    en: 'Do not close accounts, sell investments or sign anything in a hurry. Nothing here needs a quick decision.',
    enPlain: 'Do not close, sell or sign anything yet.',
    hi: 'जल्दबाज़ी में कोई खाता बंद न करें, कोई निवेश न बेचें और किसी काग़ज़ पर दस्तख़त न करें। यहाँ किसी बात का फ़ैसला तुरंत नहीं करना है।',
    hiPlain: 'अभी न कुछ बंद करें, न बेचें, न किसी काग़ज़ पर दस्तख़त करें।',
  },
  'step.will': {
    en: (p) =>
      s(p, 'where')
        ? `Find the will (${s(p, 'where')}) and read who is named as executor and guardian.`
        : 'Find the will, if there is one, and read who is named as executor and guardian. Ask a lawyer if there is none.',
    enPlain: (p) =>
      s(p, 'where') ? `Find the will (${s(p, 'where')}).` : 'Look for a will. If none, ask a lawyer.',
    hi: (p) =>
      s(p, 'where')
        ? `वसीयत ढूँढें (${s(p, 'where')}) और देखें कि उसमें एग्ज़ीक्यूटर और अभिभावक किसे बनाया गया है।`
        : 'अगर वसीयत है तो उसे ढूँढें और देखें कि उसमें एग्ज़ीक्यूटर और अभिभावक किसे बनाया गया है। वसीयत न हो तो किसी वकील से पूछें।',
    hiPlain: (p) =>
      s(p, 'where')
        ? `वसीयत ढूँढें (${s(p, 'where')})।`
        : 'वसीयत ढूँढें। न मिले तो वकील से पूछें।',
  },
  'step.guardian': {
    en: (p, f) =>
      `Confirm who looks after ${f.list(l(p, 'children'))} and their money (${f.list(l(p, 'guardians'))}). Their accounts continue under that adult.`,
    enPlain: (p, f) => `Confirm who looks after ${f.list(l(p, 'children'))}.`,
    hi: (p, f) =>
      `पक्का करें कि ${f.list(l(p, 'children'))} और उनके पैसे की देखभाल कौन करेगा (${f.list(l(p, 'guardians'))})। उनके खाते उसी बड़े की देखरेख में चलते रहेंगे।`,
    hiPlain: (p, f) => `पक्का करें कि ${f.list(l(p, 'children'))} का ख़याल कौन रखेगा।`,
  },
  'step.dependants': {
    en: 'Confirm who will handle money for anyone who depends on the family.',
    enPlain: 'Decide who handles money for dependants.',
    hi: 'पक्का करें कि परिवार पर निर्भर लोगों का पैसा कौन संभालेगा।',
    hiPlain: 'तय करें कि आश्रितों का पैसा कौन देखेगा।',
  },
  'step.insurers': {
    en: (p, f) =>
      `Tell the insurers (${f.list(l(p, 'insurers'))}). Ask each for its claim checklist, and start the life (term) claim first.`,
    enPlain: (p, f) => `Tell the insurers (${f.list(l(p, 'insurers'))}).`,
    hi: (p, f) =>
      `बीमा कंपनियों (${f.list(l(p, 'insurers'))}) को बताएँ। हर एक से क्लेम के काग़ज़ों की सूची माँगें, और सबसे पहले जीवन (टर्म) बीमा का क्लेम शुरू करें।`,
    hiPlain: (p, f) => `बीमा कंपनियों (${f.list(l(p, 'insurers'))}) को बताएँ।`,
  },
  'step.insurersNone': {
    en: 'Look for any insurance that is not listed here, such as cover through an employer, and tell the insurer.',
    enPlain: 'Look for any other insurance, e.g. through work.',
    hi: 'देखें कि कोई ऐसा बीमा तो नहीं जो यहाँ लिखा नहीं है, जैसे नौकरी से मिला बीमा, और उस बीमा कंपनी को बताएँ।',
    hiPlain: 'कोई और बीमा तो नहीं, जैसे नौकरी वाला? देख लें।',
  },
  'step.banks': {
    en: (p, f) =>
      `Write to each bank (${f.list(l(p, 'banks'))}) with the death certificate. Ask for its claim checklist and what to do with fixed deposits that mature.`,
    enPlain: (p, f) => `Tell each bank (${f.list(l(p, 'banks'))}) and ask what it needs.`,
    hi: (p, f) =>
      `हर बैंक (${f.list(l(p, 'banks'))}) को मृत्यु प्रमाणपत्र के साथ लिखकर बताएँ। उनसे क्लेम के काग़ज़ों की सूची माँगें और पूछें कि मैच्योर होने वाली एफ़डी का क्या करना है।`,
    hiPlain: (p, f) => `हर बैंक (${f.list(l(p, 'banks'))}) को बताएँ और पूछें कि क्या चाहिए।`,
  },
  'step.funds': {
    en: 'Contact CAMS or KFintech (the two registrars), or any fund house, about the mutual funds. Do not sell yet.',
    enPlain: 'Contact CAMS or KFintech about the funds. Do not sell yet.',
    hi: 'म्यूचुअल फ़ंड के लिए CAMS या KFintech (दोनों रजिस्ट्रार) या किसी भी फ़ंड हाउस से संपर्क करें। अभी कुछ न बेचें।',
    hiPlain: 'फ़ंड के लिए CAMS या KFintech से बात करें। अभी न बेचें।',
  },
  'step.automatic': {
    en: 'Check the payments that go out by themselves (monthly investments, insurance premiums, loan repayments) and make sure the account they use still works, or move them.',
    enPlain: 'Check the payments that go out by themselves.',
    hi: 'अपने-आप होने वाले भुगतान देखें (हर महीने के निवेश, बीमा प्रीमियम, लोन की किस्तें) और पक्का करें कि जिस खाते से वे कटते हैं वह चालू है, या उन्हें दूसरे खाते पर ले जाएँ।',
    hiPlain: 'अपने-आप कटने वाले भुगतान देख लें।',
  },
  'step.devices': {
    en: 'Keep phones, computers and email safe (see “Where things are”). Do not delete anything; banks often send claim information by email.',
    enPlain: 'Keep phones and email safe. Do not delete anything.',
    hi: 'फ़ोन, कंप्यूटर और ईमेल सुरक्षित रखें (“चीज़ें कहाँ रखी हैं” देखें)। कुछ भी डिलीट न करें; बैंक अक्सर क्लेम की जानकारी ईमेल पर भेजते हैं।',
    hiPlain: 'फ़ोन और ईमेल सुरक्षित रखें। कुछ भी डिलीट न करें।',
  },
  'step.advisers': {
    en: 'Ask the advisers listed under “Who to call” before any big step. This handbook is general guidance, not legal or tax advice.',
    enPlain: 'Ask an adviser before any big step.',
    hi: 'कोई भी बड़ा क़दम उठाने से पहले “किसे फ़ोन करें” में लिखे सलाहकारों से पूछें। यह मार्गदर्शिका सामान्य मार्गदर्शन है, क़ानूनी या टैक्स सलाह नहीं।',
    hiPlain: 'बड़े क़दम से पहले किसी सलाहकार से पूछें।',
  },
  'step.claims': {
    en: 'Claim the accounts, funds and policies that have a nominee, as each place advises. Keep a copy of everything you send.',
    enPlain: 'Make the claims. Keep a copy of every paper.',
    hi: 'हर संस्था की सलाह के हिसाब से उन खातों, फ़ंड और पॉलिसियों का क्लेम करें जिनमें नॉमिनी है। जो भी काग़ज़ भेजें, उसकी कॉपी अपने पास रखें।',
    hiPlain: 'क्लेम करें। हर काग़ज़ की कॉपी रखें।',
  },
  'step.succession': {
    en: 'If there is no nominee, or the will needs to be confirmed, a lawyer can advise on a succession certificate or probate. Money in India and abroad may each need its own process.',
    enPlain: 'No nominee? Ask a lawyer what is needed.',
    hi: 'अगर नॉमिनी नहीं है, या वसीयत की पुष्टि करानी है, तो वकील उत्तराधिकार प्रमाणपत्र (सक्सेशन सर्टिफ़िकेट) या प्रोबेट के बारे में सलाह दे सकते हैं। भारत और विदेश में रखे पैसे के लिए अलग-अलग प्रक्रिया हो सकती है।',
    hiPlain: 'नॉमिनी नहीं है? वकील से पूछें कि क्या चाहिए।',
  },
  'step.tax': {
    en: 'Ask an accountant to file the last tax return (it is due within the year) and to advise on tax on inherited money, in India and where the family lives.',
    enPlain: 'Ask an accountant about the last tax return.',
    hi: 'किसी अकाउंटेंट से आख़िरी टैक्स रिटर्न भरवाएँ (यह साल के अंदर भरना होता है) और विरासत में मिले पैसे पर टैक्स की सलाह लें, भारत में भी और जहाँ परिवार रहता है वहाँ भी।',
    hiPlain: 'आख़िरी टैक्स रिटर्न के लिए अकाउंटेंट से बात करें।',
  },
  'step.steady': {
    en: 'Make no large decisions in the first three months. Keep paying the essentials and keep some cash at hand.',
    enPlain: 'No big decisions for three months.',
    hi: 'पहले तीन महीनों में कोई बड़ा फ़ैसला न लें। ज़रूरी ख़र्च चलते रहें और कुछ नक़द पास रखें।',
    hiPlain: 'तीन महीने तक कोई बड़ा फ़ैसला नहीं।',
  },

  // ---------------------------------------------------------------- where things are
  'sec.where': { en: 'Where things are', hi: 'चीज़ें कहाँ रखी हैं' },
  'where.missing': { en: 'Not written down yet', hi: 'अभी लिखा नहीं गया' },
  'where.will': { en: 'Will and estate papers', hi: 'वसीयत और संपत्ति के काग़ज़' },
  'where.documents': {
    en: 'Other important documents (passports, property papers, policies)',
    hi: 'बाक़ी ज़रूरी काग़ज़ (पासपोर्ट, प्रॉपर्टी के काग़ज़, पॉलिसियाँ)',
  },
  'where.locker': { en: 'Bank locker', hi: 'बैंक लॉकर' },
  'where.passwords': { en: 'Passwords and logins', hi: 'पासवर्ड और लॉगिन' },
  'where.devices': {
    en: 'Phones, computers and other devices',
    hi: 'फ़ोन, कंप्यूटर और बाक़ी उपकरण',
  },
  'where.email': {
    en: 'Email accounts used for banks and investments',
    hi: 'बैंक और निवेश के लिए इस्तेमाल होने वाले ईमेल खाते',
  },
  'where.backupKey': {
    en: 'Key to open the encrypted backups of this app',
    hi: 'इस ऐप के एन्क्रिप्टेड बैकअप खोलने की चाबी',
  },
  'where.nominees': {
    en: 'Nominees named on accounts, funds and policies',
    hi: 'खातों, फ़ंड और पॉलिसियों में दर्ज नॉमिनी',
  },
  'where.instructions': { en: 'Other instructions', hi: 'बाक़ी निर्देश' },

  // ---------------------------------------------------------------- institution cards
  'sec.cards': { en: 'Banks, funds and insurance', hi: 'बैंक, फ़ंड और बीमा' },
  'cards.intro': {
    en: 'One card for each place that holds money or cover: what is there, who the nominee is, whom to call and which papers to take.',
    enPlain: 'One card for each bank, fund house and insurer.',
    hi: 'हर उस जगह के लिए एक कार्ड जहाँ पैसा या बीमा है: वहाँ क्या है, नॉमिनी कौन है, किसे फ़ोन करें और कौन-से काग़ज़ ले जाएँ।',
    hiPlain: 'हर बैंक, फ़ंड हाउस और बीमा कंपनी का एक कार्ड।',
  },
  'cards.none': {
    en: 'No banks, funds or policies are recorded yet.',
    hi: 'अभी कोई बैंक, फ़ंड या पॉलिसी दर्ज नहीं है।',
  },
  'group.bank': { en: 'Banks', hi: 'बैंक' },
  'group.funds': { en: 'Mutual funds', hi: 'म्यूचुअल फ़ंड' },
  'group.insurer': { en: 'Insurance', hi: 'बीमा' },
  'card.total': {
    en: (p, f) => `${termLabel('currentValue')}: about ${f.short(n(p, 'amount'))}`,
    hi: (p, f) => `मौजूदा मूल्य: लगभग ${f.short(n(p, 'amount'))}`,
  },
  'card.policies': {
    en: (p) => en1(n(p, 'count'), 'policy', 'policies'),
    hi: (p) => hi1(n(p, 'count'), 'पॉलिसी', 'पॉलिसियाँ'),
  },
  'card.held': { en: 'What is held here', hi: 'यहाँ क्या है' },
  'card.nominee': { en: 'Nominee', hi: 'नॉमिनी' },
  'card.notRecorded': { en: 'Not recorded', hi: 'दर्ज नहीं' },
  'card.helpline': { en: 'Helpline', hi: 'हेल्पलाइन' },
  'card.helplineMissing.bank': {
    en: 'Not recorded. It is printed on the passbook, the cheque book and the bank’s website.',
    enPlain: 'Not recorded. See the passbook.',
    hi: 'दर्ज नहीं। यह पासबुक, चेकबुक और बैंक की वेबसाइट पर छपा होता है।',
    hiPlain: 'दर्ज नहीं। पासबुक पर देखें।',
  },
  'card.helplineMissing.funds': {
    en: 'Not recorded. It is on the account statement; CAMS and KFintech also help with every fund.',
    enPlain: 'Not recorded. See the statement.',
    hi: 'दर्ज नहीं। यह खाते के स्टेटमेंट पर होता है; CAMS और KFintech भी हर फ़ंड में मदद करते हैं।',
    hiPlain: 'दर्ज नहीं। स्टेटमेंट पर देखें।',
  },
  'card.helplineMissing.insurer': {
    en: 'Not recorded. It is printed on the policy document.',
    enPlain: 'Not recorded. See the policy.',
    hi: 'दर्ज नहीं। यह पॉलिसी के काग़ज़ पर छपा होता है।',
    hiPlain: 'दर्ज नहीं। पॉलिसी पर देखें।',
  },
  'card.claim': {
    en: 'How to claim: papers to collect',
    hi: 'क्लेम कैसे करें: ये काग़ज़ इकट्ठा करें',
  },
  'note.bank': {
    en: 'A joint account carries on with the other holder; ask the bank to update it. NRE and NRO accounts have their own rules for sending money abroad, so ask before moving anything.',
    enPlain: 'A joint account carries on with the other name. Ask before sending money abroad.',
    hi: 'जॉइंट खाता दूसरे खाताधारक के नाम से चलता रहता है; बैंक से उसे अपडेट करने को कहें। NRE और NRO खातों से विदेश पैसा भेजने के अपने नियम हैं, इसलिए कुछ भी भेजने से पहले पूछ लें।',
    hiPlain: 'जॉइंट खाता दूसरे नाम से चलता रहता है। विदेश पैसा भेजने से पहले पूछें।',
  },
  'note.funds': {
    en: 'Mutual funds are kept on record by two registrars, CAMS and KFintech. One request to either can cover many funds. Do not sell in a hurry.',
    enPlain: 'CAMS or KFintech can help with all the funds. Do not sell in a hurry.',
    hi: 'म्यूचुअल फ़ंड का रिकॉर्ड दो रजिस्ट्रार, CAMS और KFintech, रखते हैं। इनमें से किसी एक को दी गई एक अर्ज़ी से कई फ़ंड का काम हो सकता है। जल्दबाज़ी में न बेचें।',
    hiPlain: 'CAMS या KFintech सारे फ़ंड में मदद करते हैं। जल्दी में न बेचें।',
  },
  'note.insurer': {
    en: 'Claims have time limits and need the original policy papers. Start with the life (term) policy.',
    enPlain: 'Claim early. Start with the life (term) policy.',
    hi: 'क्लेम की समय-सीमा होती है और असली पॉलिसी के काग़ज़ चाहिए होते हैं। शुरुआत जीवन (टर्म) बीमा से करें।',
    hiPlain: 'जल्दी क्लेम करें। पहले जीवन (टर्म) बीमा।',
  },
  'h.savings': {
    en: (p) => `Savings account${s(p, 'kind') ? ` (${s(p, 'kind')})` : ''}${s(p, 'last4') ? ` …${s(p, 'last4')}` : ''}`,
    hi: (p) => `बचत खाता${s(p, 'kind') ? ` (${s(p, 'kind')})` : ''}${s(p, 'last4') ? ` …${s(p, 'last4')}` : ''}`,
  },
  'h.fd': {
    en: (p) => `Fixed deposit${s(p, 'kind') ? ` (${s(p, 'kind')})` : ''}${s(p, 'last4') ? ` …${s(p, 'last4')}` : ''}`,
    hi: (p) => `फ़िक्स्ड डिपॉज़िट${s(p, 'kind') ? ` (${s(p, 'kind')})` : ''}${s(p, 'last4') ? ` …${s(p, 'last4')}` : ''}`,
  },
  'h.fdTerms': {
    en: (p, f) =>
      `${s(p, 'rate')}% a year · matures ${f.date(s(p, 'on'))}${n(p, 'amount') ? ` · ${termLabel('maturityValue')} about ${f.short(n(p, 'amount'))}` : ''}${s(p, 'ref') ? ` · deposit number ends ${s(p, 'ref')}` : ''}`,
    hi: (p, f) =>
      `${s(p, 'rate')}% सालाना · ${f.date(s(p, 'on'))} को मैच्योर होगी${n(p, 'amount') ? ` · तब लगभग ${f.short(n(p, 'amount'))} मिलेंगे` : ''}${s(p, 'ref') ? ` · डिपॉज़िट नंबर के आख़िरी अंक ${s(p, 'ref')}` : ''}`,
  },
  'h.fdMatured': {
    en: 'Matured: not counted until the bank confirms where the money went',
    hi: 'मैच्योर हो चुकी: जब तक बैंक न बताए कि पैसा कहाँ गया, तब तक गिनी नहीं गई',
  },
  'h.balanceAsOf': {
    en: (p, f) => `balance as of ${f.date(s(p, 'on'))}`,
    hi: (p, f) => `${f.date(s(p, 'on'))} का बैलेंस`,
  },
  'h.joint': { en: 'joint', hi: 'जॉइंट' },
  'h.sip': {
    en: (p, f) => `SIP of ${f.inr(n(p, 'amount'))} a month running`,
    hi: (p, f) => `हर महीने ${f.inr(n(p, 'amount'))} की SIP चल रही है`,
  },
  'h.sipStopped': { en: 'SIP stopped', hi: 'SIP बंद है' },
  'policy.term': { en: 'Life (term) cover', hi: 'जीवन बीमा (टर्म)' },
  'policy.health_sg': { en: 'Health cover (Singapore)', hi: 'स्वास्थ्य बीमा (सिंगापुर)' },
  'policy.health_in': { en: 'Health cover (India)', hi: 'स्वास्थ्य बीमा (भारत)' },
  'policy.ulip': { en: 'ULIP (insurance with investment)', hi: 'यूलिप (निवेश वाला बीमा)' },
  'policy.nps': { en: 'NPS (pension)', hi: 'एनपीएस (पेंशन)' },
  'policy.other': { en: 'Policy', hi: 'पॉलिसी' },
  'h.policyDetail': {
    en: (p, f) =>
      [
        s(p, 'cover') ? `Cover: ${s(p, 'cover')}` : '',
        l(p, 'insured').length ? `Insured: ${f.list(l(p, 'insured'))}` : '',
        s(p, 'renews') ? `Renews ${f.date(s(p, 'renews'))}` : '',
        s(p, 'ends') ? `Ends ${f.date(s(p, 'ends'))}` : '',
        s(p, 'paidBy') ? `Paid by ${s(p, 'paidBy')}` : '',
        s(p, 'papers') ? `Papers: ${s(p, 'papers')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    hi: (p, f) =>
      [
        s(p, 'cover') ? `कवर: ${s(p, 'cover')}` : '',
        l(p, 'insured').length ? `बीमित: ${f.list(l(p, 'insured'))}` : '',
        s(p, 'renews') ? `${f.date(s(p, 'renews'))} को रिन्यू होती है` : '',
        s(p, 'ends') ? `${f.date(s(p, 'ends'))} को ख़त्म होती है` : '',
        s(p, 'paidBy') ? `भुगतान: ${s(p, 'paidBy')}` : '',
        s(p, 'papers') ? `काग़ज़: ${s(p, 'papers')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
  },

  // ---------------------------------------------------------------- claim checklists (one list per kind of place)
  'claim.bank.inform': {
    en: 'Bank informed (a branch visit is best, or in writing)',
    enPlain: 'Bank informed',
    hi: 'बैंक को बता दिया (ब्रांच जाना सबसे अच्छा, या लिखकर)',
    hiPlain: 'बैंक को बता दिया',
  },
  'claim.bank.deathCert': {
    en: 'Death certificate collected (a certified copy for this bank)',
    enPlain: 'Death certificate collected',
    hi: 'मृत्यु प्रमाणपत्र ले लिया (इस बैंक के लिए एक सत्यापित प्रति)',
    hiPlain: 'मृत्यु प्रमाणपत्र ले लिया',
  },
  'claim.bank.form': {
    en: 'The bank’s claim form, filled in and signed',
    enPlain: 'Claim form filled in',
    hi: 'बैंक का क्लेम फ़ॉर्म भरकर दस्तख़त कर दिए',
    hiPlain: 'क्लेम फ़ॉर्म भर दिया',
  },
  'claim.bank.nomineeId': {
    en: 'Nominee’s photo ID and address proof (PAN, Aadhaar or passport)',
    enPlain: 'Nominee’s ID and address proof',
    hi: 'नॉमिनी का फ़ोटो पहचान पत्र और पते का प्रमाण (पैन, आधार या पासपोर्ट)',
    hiPlain: 'नॉमिनी का पहचान और पते का प्रमाण',
  },
  'claim.bank.passbook': {
    en: 'Passbook, cheque book and fixed deposit receipts',
    enPlain: 'Passbook and FD receipts',
    hi: 'पासबुक, चेकबुक और एफ़डी की रसीदें',
    hiPlain: 'पासबुक और एफ़डी रसीदें',
  },
  'claim.bank.payout': {
    en: 'A cancelled cheque or bank details where the money should be paid',
    enPlain: 'Bank details for the payment',
    hi: 'कैंसल किया हुआ चेक या उस खाते का ब्योरा जिसमें पैसा आना है',
    hiPlain: 'पैसा पाने वाले खाते का ब्योरा',
  },
  'claim.bank.noNominee': {
    en: 'If no nominee is registered: asked the bank which extra papers it needs',
    enPlain: 'No nominee: asked which extra papers are needed',
    hi: 'अगर नॉमिनी दर्ज नहीं है: बैंक से पूछ लिया कि और कौन-से काग़ज़ चाहिए',
    hiPlain: 'नॉमिनी नहीं: पूछ लिया कि और क्या चाहिए',
  },
  'claim.funds.inform': {
    en: 'CAMS or KFintech (the registrar) or the fund house informed',
    enPlain: 'CAMS or KFintech informed',
    hi: 'CAMS या KFintech (रजिस्ट्रार) या फ़ंड हाउस को बता दिया',
    hiPlain: 'CAMS या KFintech को बता दिया',
  },
  'claim.funds.form': {
    en: 'Transmission request form, filled in and signed by the nominee',
    enPlain: 'Transmission form filled in',
    hi: 'ट्रांसमिशन रिक्वेस्ट फ़ॉर्म, नॉमिनी ने भरकर दस्तख़त कर दिए',
    hiPlain: 'ट्रांसमिशन फ़ॉर्म भर दिया',
  },
  'claim.funds.deathCert': {
    en: 'Death certificate collected (a certified copy)',
    enPlain: 'Death certificate collected',
    hi: 'मृत्यु प्रमाणपत्र ले लिया (एक सत्यापित प्रति)',
    hiPlain: 'मृत्यु प्रमाणपत्र ले लिया',
  },
  'claim.funds.kyc': {
    en: 'Nominee’s KYC: PAN, photo ID and address proof',
    enPlain: 'Nominee’s KYC (PAN and ID)',
    hi: 'नॉमिनी का केवाईसी: पैन, फ़ोटो पहचान पत्र और पते का प्रमाण',
    hiPlain: 'नॉमिनी का केवाईसी (पैन और पहचान)',
  },
  'claim.funds.bankProof': {
    en: 'Nominee’s bank proof (a cancelled cheque or a bank statement)',
    enPlain: 'Nominee’s bank proof',
    hi: 'नॉमिनी के बैंक खाते का प्रमाण (कैंसल चेक या बैंक स्टेटमेंट)',
    hiPlain: 'नॉमिनी के बैंक का प्रमाण',
  },
  'claim.funds.statement': {
    en: 'Latest account statement showing the folio numbers',
    enPlain: 'Latest statement with folio numbers',
    hi: 'फ़ोलियो नंबर वाला सबसे नया स्टेटमेंट',
    hiPlain: 'फ़ोलियो नंबर वाला स्टेटमेंट',
  },
  'claim.insurer.inform': {
    en: 'Insurer informed (claims have time limits, so early is better)',
    enPlain: 'Insurer informed',
    hi: 'बीमा कंपनी को बता दिया (क्लेम की समय-सीमा होती है, इसलिए जल्दी बेहतर है)',
    hiPlain: 'बीमा कंपनी को बता दिया',
  },
  'claim.insurer.form': {
    en: 'The insurer’s claim form, filled in and signed',
    enPlain: 'Claim form filled in',
    hi: 'बीमा कंपनी का क्लेम फ़ॉर्म भरकर दस्तख़त कर दिए',
    hiPlain: 'क्लेम फ़ॉर्म भर दिया',
  },
  'claim.insurer.policy': {
    en: 'Original policy document found',
    enPlain: 'Policy document found',
    hi: 'असली पॉलिसी का काग़ज़ मिल गया',
    hiPlain: 'पॉलिसी का काग़ज़ मिल गया',
  },
  'claim.insurer.deathCert': {
    en: 'Death certificate collected (a certified copy)',
    enPlain: 'Death certificate collected',
    hi: 'मृत्यु प्रमाणपत्र ले लिया (एक सत्यापित प्रति)',
    hiPlain: 'मृत्यु प्रमाणपत्र ले लिया',
  },
  'claim.insurer.claimant': {
    en: 'Claimant’s photo ID, address proof and bank details',
    enPlain: 'Claimant’s ID and bank details',
    hi: 'क्लेम करने वाले का फ़ोटो पहचान पत्र, पते का प्रमाण और बैंक का ब्योरा',
    hiPlain: 'क्लेम करने वाले की पहचान और बैंक ब्योरा',
  },
  'claim.insurer.medical': {
    en: 'Medical records or hospital papers, if the insurer asks for them',
    enPlain: 'Medical papers, if asked',
    hi: 'मेडिकल रिकॉर्ड या अस्पताल के काग़ज़, अगर बीमा कंपनी माँगे',
    hiPlain: 'मेडिकल काग़ज़, अगर माँगे जाएँ',
  },

  // ---------------------------------------------------------------- other things
  'sec.other': { en: 'Other things we own', hi: 'हमारी बाक़ी चीज़ें' },
  'other.property': { en: 'Property and other assets', hi: 'प्रॉपर्टी और बाक़ी संपत्ति' },
  'note.property': {
    en: 'Property passes through the will or succession law, with the registered papers. Ask a lawyer.',
    enPlain: 'Property goes by the will. Ask a lawyer.',
    hi: 'प्रॉपर्टी वसीयत या उत्तराधिकार क़ानून के हिसाब से, रजिस्टर्ड काग़ज़ों के साथ आगे जाती है। किसी वकील से पूछें।',
    hiPlain: 'प्रॉपर्टी वसीयत से जाती है। वकील से पूछें।',
  },
  'other.held': {
    en: 'Held for us by other people or brokers',
    hi: 'दूसरे लोगों या ब्रोकर के पास रखा हमारा पैसा',
  },
  'note.held': {
    en: 'These need the same death certificate and a claim to that broker or person.',
    enPlain: 'Ask that person or broker with the death certificate.',
    hi: 'इनके लिए भी वही मृत्यु प्रमाणपत्र और उस ब्रोकर या व्यक्ति के पास क्लेम चाहिए।',
    hiPlain: 'मृत्यु प्रमाणपत्र के साथ उस व्यक्ति या ब्रोकर से बात करें।',
  },
  'other.owed': { en: 'Money other people owe us', hi: 'दूसरों से मिलने वाला पैसा' },
  'note.owed': {
    en: 'These are informal. Keep any messages or notes about them.',
    enPlain: 'Keep any messages about them.',
    hi: 'ये अनौपचारिक हैं। इनसे जुड़े सारे संदेश या नोट सँभालकर रखें।',
    hiPlain: 'इनके संदेश सँभालकर रखें।',
  },
  'other.expected': {
    en: (p, f) => (s(p, 'on') ? `expected back ${f.date(s(p, 'on'))}` : 'no date agreed'),
    hi: (p, f) => (s(p, 'on') ? `${f.date(s(p, 'on'))} तक वापस मिलना है` : 'कोई तारीख़ तय नहीं'),
  },
  'other.none': { en: 'Nothing recorded.', hi: 'कुछ दर्ज नहीं।' },
  'sec.moving': { en: 'Money that moves by itself', hi: 'अपने-आप चलने वाला पैसा' },
  'moving.sips': {
    en: (p, f) =>
      n(p, 'count') > 0
        ? `${en1(n(p, 'count'), 'monthly investment (SIP) is', 'monthly investments (SIPs) are')} running, ${f.inr(n(p, 'amount'))} a month in all. They are taken from a bank account automatically; if that account is frozen they will fail. Decide with an adviser whether to keep or stop them.`
        : 'No monthly investments (SIPs) are running.',
    enPlain: (p, f) =>
      n(p, 'count') > 0
        ? `${en1(n(p, 'count'), 'SIP', 'SIPs')} running, ${f.inr(n(p, 'amount'))} a month. Ask an adviser.`
        : 'No SIPs are running.',
    hi: (p, f) =>
      n(p, 'count') > 0
        ? `${n(p, 'count')} मासिक निवेश (SIP) चल रहे हैं, कुल ${f.inr(n(p, 'amount'))} हर महीने। ये बैंक खाते से अपने-आप कटते हैं; अगर वह खाता रुक गया तो ये नहीं कटेंगे। किसी सलाहकार के साथ तय करें कि इन्हें चालू रखें या बंद करें।`
        : 'कोई मासिक निवेश (SIP) नहीं चल रहा है।',
    hiPlain: (p, f) =>
      n(p, 'count') > 0
        ? `${n(p, 'count')} SIP चल रही हैं, ${f.inr(n(p, 'amount'))} हर महीने। सलाहकार से पूछें।`
        : 'कोई SIP नहीं चल रही।',
  },
  'moving.maturing': {
    en: 'Deposits maturing in the next 12 months',
    hi: 'अगले 12 महीनों में मैच्योर होने वाली एफ़डी',
  },
  'note.maturing': {
    en: 'A matured deposit may renew by itself unless the bank is told otherwise.',
    enPlain: 'A deposit may renew by itself.',
    hi: 'मैच्योर हुई एफ़डी अपने-आप फिर से बन सकती है, जब तक बैंक को कुछ और न कहा जाए।',
    hiPlain: 'एफ़डी अपने-आप फिर से बन सकती है।',
  },
  'moving.maturingNone': {
    en: 'None in the next 12 months.',
    hi: 'अगले 12 महीनों में कोई नहीं।',
  },
  'moving.renewals': { en: 'Insurance renewals', hi: 'बीमा रिन्यूअल' },

  // ---------------------------------------------------------------- people
  'sec.people': { en: 'Who is who', hi: 'कौन कौन है' },
  'people.age': { en: (p) => `age ${n(p, 'age')}`, hi: (p) => `उम्र ${n(p, 'age')}` },
  'people.child': { en: 'child', hi: 'नाबालिग' },
  'people.lookedAfter': {
    en: (p) => `looked after by ${s(p, 'name')}`,
    hi: (p) => `देखभाल: ${s(p, 'name')}`,
  },
  'people.pan': { en: (p) => `PAN …${s(p, 'last4')}`, hi: (p) => `पैन …${s(p, 'last4')}` },
  'people.residency': {
    en: (p) => `tax residency ${s(p, 'value')}`,
    hi: (p) => `टैक्स निवास: ${s(p, 'value')}`,
  },
  'note.minors': {
    en: 'Children cannot manage money themselves. Their accounts are run by the adult who looks after them.',
    enPlain: 'An adult runs the children’s accounts.',
    hi: 'बच्चे ख़ुद पैसा नहीं सँभाल सकते। उनके खाते वही बड़ा चलाता है जो उनकी देखभाल करता है।',
    hiPlain: 'बच्चों के खाते एक बड़ा चलाता है।',
  },

  // ---------------------------------------------------------------- children
  'sec.children': { en: 'For the children', hi: 'बच्चों के लिए' },
  'kids.hello': { en: 'This part is for you.', hi: 'यह हिस्सा तुम्हारे लिए है।' },
  'kids.note': {
    en: 'The grown-ups made this guide so you never have to wonder what happens next. You are safe, and you are loved.',
    enPlain: 'You are safe, and you are loved.',
    hi: 'बड़ों ने यह मार्गदर्शिका इसलिए बनाई है ताकि तुम्हें कभी यह सोचना न पड़े कि आगे क्या होगा। तुम सुरक्षित हो, और सब तुमसे बहुत प्यार करते हैं।',
    hiPlain: 'तुम सुरक्षित हो, और सब तुमसे प्यार करते हैं।',
  },
  'kids.care': { en: 'Who looks after you', hi: 'तुम्हारा ख़याल कौन रखेगा' },
  'kids.careNone': {
    en: 'The grown-ups in the family will look after you.',
    hi: 'परिवार के बड़े तुम्हारा ख़याल रखेंगे।',
  },
  'kids.sad': {
    en: 'It is okay to feel sad, angry or mixed up. Every feeling is allowed. Talk to someone you trust, as often as you need.',
    enPlain: 'It is okay to feel sad. Talk to someone you trust.',
    hi: 'उदास, नाराज़ या उलझन में होना ठीक है। हर तरह का एहसास ठीक है। जब भी मन करे, किसी भरोसेमंद से बात करो।',
    hiPlain: 'उदास होना ठीक है। किसी भरोसेमंद से बात करो।',
  },
  'kids.money': {
    en: 'The money is looked after for you. It is not your job to worry about it.',
    enPlain: 'The money is looked after. Do not worry about it.',
    hi: 'पैसे का ध्यान रखा जा रहा है। इसकी चिंता करना तुम्हारा काम नहीं है।',
    hiPlain: 'पैसे का ध्यान रखा जा रहा है। चिंता मत करो।',
  },
  'kids.ask': {
    en: 'You can ask questions at any time. No question is silly.',
    enPlain: 'Ask anything, any time.',
    hi: 'तुम कभी भी सवाल पूछ सकते हो। कोई भी सवाल बेकार नहीं होता।',
    hiPlain: 'कभी भी कुछ भी पूछो।',
  },
  'kids.notAlone': { en: 'You are not alone.', hi: 'तुम अकेले नहीं हो।' },

  // ---------------------------------------------------------------- what is missing (members only)
  'meter.title': {
    en: (p) => `Handbook ${n(p, 'pct')}% complete`,
    hi: (p) => `मार्गदर्शिका ${n(p, 'pct')}% पूरी`,
  },
  'meter.intro': {
    en: 'Only people with full access see this. Fill in what is missing and the handbook rewrites itself.',
    enPlain: 'Only you see this. Fill in the gaps.',
    hi: 'यह सिर्फ़ पूरी पहुँच वाले लोग देखते हैं। जो छूटा है उसे भरें, मार्गदर्शिका अपने-आप बदल जाएगी।',
    hiPlain: 'यह सिर्फ़ आप देखते हैं। छूटी चीज़ें भरें।',
  },
  'meter.allDone': {
    en: 'Everything the handbook asks for is filled in.',
    hi: 'मार्गदर्शिका में माँगी गई हर चीज़ भरी जा चुकी है।',
  },
  'meter.fix': { en: 'Fill in', hi: 'भरें' },
  'gap.nomineeAccounts': {
    en: (p) =>
      `${en1(n(p, 'count'), 'account or deposit has', 'accounts and deposits have')} no nominee recorded`,
    hi: (p) => `${n(p, 'count')} ${n(p, 'count') === 1 ? 'खाते या एफ़डी' : 'खातों और एफ़डी'} में नॉमिनी दर्ज नहीं है`,
  },
  'gap.nomineeFunds': {
    en: (p) => `${en1(n(p, 'count'), 'fund has', 'funds have')} no nominee recorded`,
    hi: (p) => `${n(p, 'count')} ${n(p, 'count') === 1 ? 'फ़ंड' : 'फ़ंडों'} में नॉमिनी दर्ज नहीं है`,
  },
  'gap.nomineePolicies': {
    en: (p) => `${en1(n(p, 'count'), 'policy has', 'policies have')} no nominee recorded`,
    hi: (p) => `${n(p, 'count')} ${n(p, 'count') === 1 ? 'पॉलिसी' : 'पॉलिसियों'} में नॉमिनी दर्ज नहीं है`,
  },
  'gap.helpline': {
    en: (p) => `${en1(n(p, 'count'), 'bank has', 'banks have')} no helpline`,
    hi: (p) => `${n(p, 'count')} ${n(p, 'count') === 1 ? 'बैंक' : 'बैंकों'} की हेल्पलाइन दर्ज नहीं है`,
  },
  'gap.will': {
    en: 'Where is the will? Not written down yet',
    hi: 'वसीयत कहाँ है? अभी लिखा नहीं गया',
  },
  'gap.contacts': {
    en: 'No one to call first',
    hi: 'सबसे पहले फ़ोन करने के लिए कोई नाम नहीं',
  },
  'gap.where': {
    en: (p) =>
      `${en1(n(p, 'count'), 'other place is', 'other places are')} not written down (documents, passwords, devices…)`,
    hi: (p) => `${n(p, 'count')} और जगहें अभी लिखी नहीं गईं (काग़ज़, पासवर्ड, उपकरण…)`,
  },
  'gap.message': {
    en: 'No message to the family yet',
    hi: 'परिवार के लिए अभी कोई संदेश नहीं',
  },
} satisfies Record<string, HbEntry>;

export type HbKey = keyof typeof HB_TEXT;

/** A text of the handbook as it is stored: a key and the values it needs. */
export interface HbText {
  k: HbKey;
  p?: HbParams;
}

/** Texts that must have a "simple words" variant: steps, checklist lines and notes. */
export const HB_NEEDS_PLAIN = /^(step|claim|note)\./;

const DATE: Record<HbLang, string> = { en: 'en-GB', hi: 'hi-IN-u-nu-latn' };

/** How each language writes dates, rupees and lists. */
export function hbFmt(lang: HbLang): HbFmt {
  const loc = DATE[lang];
  return {
    lang,
    date: (iso) =>
      /^\d{4}-\d{2}-\d{2}$/.test(iso)
        ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(loc, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : iso,
    dateTime: (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleString(loc, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Singapore',
          });
    },
    inr: (x) =>
      x === null ? (lang === 'hi' ? 'दर्ज नहीं' : 'not recorded') : formatInr(Math.round(x)),
    short: (x) => formatInrCompact(Math.round(x)),
    list: (xs) => {
      const and = lang === 'hi' ? ' और ' : ' and ';
      const none = lang === 'hi' ? 'कोई दर्ज नहीं' : 'none recorded';
      if (xs.length === 0) return none;
      if (xs.length === 1) return xs[0]!;
      return `${xs.slice(0, -1).join(', ')}${and}${xs[xs.length - 1]}`;
    },
  };
}

/** One text in the chosen language and style. */
export function hbSay(t: HbText | HbKey, lang: HbLang = 'en', plain = false): string {
  const { k, p } = typeof t === 'string' ? { k: t, p: undefined } : t;
  const e: HbEntry = HB_TEXT[k];
  const line =
    lang === 'hi' ? (plain ? (e.hiPlain ?? e.hi) : e.hi) : plain ? (e.enPlain ?? e.en) : e.en;
  return typeof line === 'string' ? line : line(p ?? {}, hbFmt(lang));
}

/** A handy maker for stored texts. */
export const hbT = (k: HbKey, p?: HbParams): HbText => (p ? { k, p } : { k });
