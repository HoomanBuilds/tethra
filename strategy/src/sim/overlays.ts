// Model-free risk overlays on the real house book (no pricing model needed):
//   A) tenor tilt (exclude/limit the unprofitable 15m leg)
//   B) per-oracle exposure cap (bound worst-case loss per settlement)
// Each oracle's worst case = Σ qty (max payout); realized = Σ premium − Σ payout.
import { loadAll, won, num, USDC, fmt, pct, std, type Tenor } from './data.ts';

const { mints, settle, tenorOf } = loadAll();

interface OAgg {
  prem: number;
  pay: number;
  maxpay: number;
  tenor: Tenor;
}
const byOracle = new Map<string, OAgg>();
for (const m of mints) {
  const S = settle.get(m.oracle_id);
  if (S === undefined) continue;
  const o = byOracle.get(m.oracle_id) ?? { prem: 0, pay: 0, maxpay: 0, tenor: tenorOf.get(m.oracle_id) ?? 'unknown' };
  const qty = num(m.quantity) / USDC;
  o.prem += num(m.cost) / USDC;
  o.maxpay += qty;
  if (won(m.is_up, num(m.strike), S)) o.pay += qty;
  byOracle.set(m.oracle_id, o);
}
const oracles = [...byOracle.values()];
const pnlOf = (o: OAgg) => o.prem - o.pay;

function summary(label: string, pnls: number[], prem: number) {
  const total = pnls.reduce((a, b) => a + b, 0);
  console.log(
    `${label.padEnd(26)} pnl ${fmt(total).padStart(11)}  edge ${((100 * total) / (prem || 1)).toFixed(1).padStart(6)}%  ` +
      `worst ${fmt(Math.min(...pnls)).padStart(11)}  p5 ${fmt(pct(pnls, 0.05)).padStart(9)}  std ${fmt(std(pnls)).padStart(8)}`,
  );
}

console.log('═══ RISK OVERLAYS (real book, ' + oracles.length + ' settled oracles) ═══\n');
console.log('baseline + tenor tilts:');
summary('all flow (baseline)', oracles.map(pnlOf), oracles.reduce((a, o) => a + o.prem, 0));
for (const ex of [['no 15m', ['15m']], ['no 15m+weekly', ['15m', 'weekly']]] as [string, Tenor[]][]) {
  const sel = oracles.filter((o) => !ex[1].includes(o.tenor));
  summary(ex[0], sel.map(pnlOf), sel.reduce((a, o) => a + o.prem, 0));
}

console.log('\nper-oracle exposure cap sweep (scale participation so worst-case ≤ cap):');
const totalPrem = oracles.reduce((a, o) => a + o.prem, 0);
for (const cap of [25, 50, 100, 250, 500, 1000, Infinity]) {
  const scaled = oracles.map((o) => {
    const f = o.maxpay > 0 ? Math.min(1, cap / o.maxpay) : 1;
    return pnlOf(o) * f;
  });
  const capLbl = cap === Infinity ? 'uncapped' : `$${cap}`;
  summary(`cap ${capLbl}/oracle`, scaled, totalPrem);
}

console.log('\nNote: tenor tilt & caps require the active keeper leg (offset/limit exposure);');
console.log('shown as the risk/return frontier available to active management vs passive PLP.');
