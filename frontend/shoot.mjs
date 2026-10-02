import { chromium } from 'playwright';
const OUT = process.env.SHOOT_OUT ?? '/tmp/shots';
const codes = { overview:'OVW', nowcast:'NOW', explorer:'3DX', timeline:'FTM', fusion:'FUS', explain:'XAI', replay:'REP', validation:'VAL', system:'SYS' };
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(codes);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1680, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:8011/', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /IMD/ }).click();
await p.waitForTimeout(3500);
for (const s of want) {
  await p.getByRole('button', { name: new RegExp('^' + codes[s]) }).first().click();
  await p.waitForTimeout(s === 'replay' || s === 'explorer' ? 3500 : 1800);
  const scroll = { explain: 1500, validation: 2300 }[s];
  if (scroll) await p.evaluate((y) => { const e = document.querySelector('.page'); if (e) e.scrollTop = y; }, scroll);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${s}.png` });
}
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
