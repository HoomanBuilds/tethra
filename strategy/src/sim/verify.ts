import { loadAll, perOracle, fmt, type OAgg } from './data.ts';

const L = loadAll();
const os = perOracle(L);
const pnls = os.map((o) => o.pnl);

interface Stats {
  n: number;
  total: number;
  mean: number;
  sd: number;
  sharpe: number;
  worst: number;
  cvar5: number;
}
function stats(s: number[]): Stats {
  const n = s.length;
  const total = s.reduce((a, b) => a + b, 0);
  const mean = total / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const sorted = [...s].sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(0.05 * n));
  const cvar5 = sorted.slice(0, k).reduce((a, b) => a + b, 0) / k;
  return { n, total, mean, sd, sharpe: sd > 0 ? mean / sd : 0, worst: sorted[0], cvar5 };
}
function maxDD(s: number[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const p of s) {
    cum += p;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}
const cap = (s: number[], C: number) => s.map((p) => Math.max(p, -C));
const capCost = (s: number[], C: number, rate: number) => s.map((p) => Math.max(p, -C) - rate * Math.max(0, -p - C));
const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function row(label: string, s: number[]) {
  const m = stats(s);
  console.log(
    `${label.padEnd(24)} total ${fmt(m.total).padStart(10)}  mean ${fmt(m.mean).padStart(7)}  sd ${fmt(m.sd).padStart(7)}  ` +
      `sharpe ${m.sharpe.toFixed(3).padStart(6)}  CVaR5% ${fmt(m.cvar5).padStart(9)}  maxDD ${fmt(maxDD(s)).padStart(9)}  worst ${fmt(m.worst).padStart(9)}`,
  );
}

console.log(`═══ STRATEGY VERIFICATION (n=${os.length} settled oracles with flow, chronological) ═══\n`);
console.log('per-oracle PnL metrics by strategy:');
row('passive PLP (bench)', pnls);
row('cap $500/oracle', cap(pnls, 500));
row('cap $250/oracle', cap(pnls, 250));
row('cap $250 @cost0.5', capCost(pnls, 250, 0.5));
row('cap $250 @cost1.0 (fair)', capCost(pnls, 250, 1.0));
const non15 = os.filter((o) => o.tenor !== '15m').map((o) => o.pnl);
row('drop 15m (upper bnd)', non15);

console.log('\nde-leverage control — match passive to cap$250 tail (CVaR), compare return:');
const capped = cap(pnls, 250);
const Lmatch = stats(capped).cvar5 / stats(pnls).cvar5;
const scaled = pnls.map((p) => p * Lmatch);
console.log(`  passive scaled ×${Lmatch.toFixed(3)} to equal cap$250 CVaR: total ${fmt(stats(scaled).total)}  vs cap$250 total ${fmt(stats(capped).total)}`);
console.log(`  → cap beats naive de-leverage at equal tail: ${stats(capped).total > stats(scaled).total ? 'YES' : 'NO'} (free-offset assumption)`);

function boot(transform: (a: number[]) => number[], metric: (a: number[]) => number, iters = 3000): [number, number, number] {
  const n = pnls.length;
  const diffs: number[] = [];
  for (let b = 0; b < iters; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(Math.random() * n));
    const base = idx.map((i) => pnls[i]);
    diffs.push(metric(transform(base)) - metric(base));
  }
  const mean = diffs.reduce((a, c) => a + c, 0) / iters;
  return [quantile(diffs, 0.025), mean, quantile(diffs, 0.975)];
}
const T = (a: number[]) => cap(a, 250);
const Tc = (a: number[]) => capCost(a, 250, 1.0);
const mTot = (a: number[]) => stats(a).total;
const mShar = (a: number[]) => stats(a).sharpe;
const mCv = (a: number[]) => stats(a).cvar5;

console.log('\nbootstrap 95% CI of (cap$250 − passive), 3000 resamples:');
const [tl, tm, th] = boot(T, mTot);
const [sl, sm, sh] = boot(T, mShar);
const [cl, cm, ch] = boot(T, mCv);
console.log(`  Δtotal   ${fmt(tm)}  CI [${fmt(tl)}, ${fmt(th)}]  ${tl > 0 ? 'SIGNIFICANT +' : th < 0 ? 'SIGNIFICANT -' : 'not significant'}`);
console.log(`  Δsharpe  ${sm.toFixed(3)}  CI [${sl.toFixed(3)}, ${sh.toFixed(3)}]  ${sl > 0 ? 'SIGNIFICANT +' : sh < 0 ? 'SIGNIFICANT -' : 'not significant'}`);
console.log(`  ΔCVaR5%  ${fmt(cm)}  CI [${fmt(cl)}, ${fmt(ch)}]  ${cl > 0 ? 'SIGNIFICANT + (less tail)' : 'not significant'}`);
console.log('\nsame, with fair offset cost (rate 1.0):');
const [tl2, tm2, th2] = boot(Tc, mTot);
const [cl2, cm2, ch2] = boot(Tc, mCv);
console.log(`  Δtotal   ${fmt(tm2)}  CI [${fmt(tl2)}, ${fmt(th2)}]  ${tl2 > 0 ? 'SIGNIFICANT +' : th2 < 0 ? 'SIGNIFICANT -' : 'not significant'}`);
console.log(`  ΔCVaR5%  ${fmt(cm2)}  CI [${fmt(cl2)}, ${fmt(ch2)}]  ${cl2 > 0 ? 'SIGNIFICANT + (less tail)' : 'not significant'}`);

console.log('\nout-of-sample (split by settlement time, 60/40):');
const cut = Math.floor(os.length * 0.6);
const tr = pnls.slice(0, cut), te = pnls.slice(cut);
for (const [lbl, seg] of [['train', tr], ['test', te]] as [string, number[]][]) {
  const p = stats(seg), c = stats(cap(seg, 250));
  console.log(`  ${lbl}: passive sharpe ${p.sharpe.toFixed(3)} CVaR ${fmt(p.cvar5)} | cap$250 sharpe ${c.sharpe.toFixed(3)} CVaR ${fmt(c.cvar5)}  → sharpe ${c.sharpe > p.sharpe ? 'up' : 'down'}, tail ${c.cvar5 > p.cvar5 ? 'better' : 'worse'}`);
}

console.log('\nrobustness: drop the single worst oracle, recompute passive vs cap$250:');
const exWorst = [...os].sort((a, b) => a.pnl - b.pnl).slice(1).map((o) => o.pnl);
console.log(`  passive total ${fmt(stats(exWorst).total)} sharpe ${stats(exWorst).sharpe.toFixed(3)} | cap$250 total ${fmt(stats(cap(exWorst, 250)).total)} sharpe ${stats(cap(exWorst, 250)).sharpe.toFixed(3)}`);
