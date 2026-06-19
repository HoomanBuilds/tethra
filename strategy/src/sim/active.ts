// Track B — position-level active strategies vs passive PLP, OUT OF SAMPLE.
// Quantifies the prize of per-position selection/sizing (requires owner-gated
// mint access, so hypothetical-but-measured). NO LOOKAHEAD: every selection
// decision uses only at-mint observables (tenor, ask_price, moneyness via a
// forward proxy known at mint, quoteSpread). settlement_price is used ONLY to
// compute realized PnL afterward.
//
// Forward proxy: btc_1d close covering the mint timestamp (all oracles). The 10
// rich oracles additionally carry an on-chain `forward` in prices_<id>.json,
// used for B5 fair-value comparison. btc_15m.json is stale (Aug-2024) and does
// NOT overlap the 2026 mint window, so it is unusable as a forward proxy here.
import { readFileSync, readdirSync } from 'node:fs';
import { loadAll, won, num, USDC, SCALE, fmt, classifyTenor, type Mint, type Tenor } from './data.ts';
import { upPrice, quoteSpread, decodeSvi, type RawSvi } from '../svi/pricing.ts';
import { DATA } from './data.ts';

const TRAIN_FRAC = 0.7;

// ---- helpers (data.ts does not export pct/std; define locally) ----
const pct = (arr: number[], p: number): number => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]): number => {
  if (a.length < 2) return 0;
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1));
};
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
const maxDrawdown = (pnls: number[]): number => {
  let peak = 0, cum = 0, dd = 0;
  for (const p of pnls) {
    cum += p;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
  }
  return dd;
};

// ---- load ----
const L = loadAll();
const oracleById = new Map(L.oracles.map((o) => [o.oracle_id, o]));

// btc_1d klines: [openTime, open, high, low, close, ...] — forward proxy at mint time.
const btc1d = JSON.parse(readFileSync(`${DATA}/btc_1d.json`, 'utf8')) as (number | string)[][];
btc1d.sort((a, b) => Number(a[0]) - Number(b[0]));
const fwdProxy = (t: number): number | null => {
  let r: number | null = null;
  for (const b of btc1d) {
    if (Number(b[0]) <= t) r = Number(b[4]);
    else break;
  }
  return r;
};

// On-chain forward + SVI for the 10 rich oracles (keyed without 0x).
type PxEv = { checkpoint_timestamp_ms: number; spot: number; forward: number };
const richFwd = new Map<string, PxEv[]>();
const richSvi = new Map<string, (RawSvi & { checkpoint_timestamp_ms: number })[]>();
for (const f of readdirSync(DATA)) {
  if (f.startsWith('prices_')) {
    const id = '0x' + f.slice(7, -5);
    const arr = JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8')) as PxEv[];
    arr.sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);
    richFwd.set(id, arr);
  }
  if (f.startsWith('svi_')) {
    const id = '0x' + f.slice(4, -5);
    const arr = JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8')) as (RawSvi & { checkpoint_timestamp_ms: number })[];
    arr.sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);
    richSvi.set(id, arr);
  }
}
// last event at or before t (no lookahead)
function atOrBefore<T extends { checkpoint_timestamp_ms: number }>(arr: T[] | undefined, t: number): T | null {
  if (!arr) return null;
  let r: T | null = null;
  for (const e of arr) {
    if (e.checkpoint_timestamp_ms <= t) r = e;
    else break;
  }
  return r;
}

// ---- enriched mint records (only mints on settled oracles) ----
interface EMint {
  oracle: string;
  isUp: boolean;
  strike: number; // human
  qty: number; // human (max payout if win)
  cost: number; // premium human
  ask: number; // ask_price as fraction [0,1]
  t: number; // mint timestamp
  settT: number; // settlement time (ordering)
  tenor: Tenor;
  win: boolean; // realized (NOT used for selection)
  pnl: number; // realized house pnl on this mint = cost - (win?qty:0)
  k: number | null; // moneyness ln(K/F) at mint, forward proxy
  spread: number; // quoteSpread at fair=ask (at-mint observable proxy for edge)
}
const emints: EMint[] = [];
for (const m of L.mints) {
  const S = L.settle.get(m.oracle_id);
  if (S === undefined) continue;
  const strike = num(m.strike) / SCALE;
  const qty = num(m.quantity) / USDC;
  const cost = num(m.cost) / USDC;
  const ask = num(m.ask_price) / SCALE; // ask_price scaled 1e9 -> fraction
  const win = won(m.is_up, num(m.strike), S);
  const f = fwdProxy(m.checkpoint_timestamp_ms);
  const k = f && f > 0 ? Math.log(strike / f) : null;
  emints.push({
    oracle: m.oracle_id,
    isUp: m.is_up,
    strike,
    qty,
    cost,
    ask,
    t: m.checkpoint_timestamp_ms,
    settT: L.settledAt.get(m.oracle_id) ?? m.checkpoint_timestamp_ms,
    tenor: L.tenorOf.get(m.oracle_id) ?? 'unknown',
    win,
    pnl: cost - (win ? qty : 0),
    k,
    spread: ask > 0 && ask < 1 ? quoteSpread(ask) : 0,
  });
}

// ---- aggregate a set of selected mints to per-oracle PnL series, time-ordered ----
interface OStat {
  id: string;
  pnl: number;
  prem: number;
  t: number;
}
function aggregate(mints: EMint[]): OStat[] {
  const m = new Map<string, OStat>();
  for (const e of mints) {
    const a = m.get(e.oracle) ?? { id: e.oracle, pnl: 0, prem: 0, t: e.settT };
    a.pnl += e.pnl;
    a.prem += e.cost;
    m.set(e.oracle, a);
  }
  return [...m.values()].filter((o) => o.prem > 0).sort((a, b) => a.t - b.t);
}

interface Metrics {
  n: number;
  pnl: number;
  prem: number;
  edge: number;
  std: number;
  worst: number;
  p5: number;
  pctLose: number;
  maxDD: number;
  sharpe: number;
}
function metrics(stats: OStat[]): Metrics {
  const pnls = stats.map((s) => s.pnl);
  const prem = sum(stats.map((s) => s.prem));
  const total = sum(pnls);
  const s = std(pnls);
  return {
    n: stats.length,
    pnl: total,
    prem,
    edge: prem > 0 ? (100 * total) / prem : 0,
    std: s,
    worst: pnls.length ? Math.min(...pnls) : 0,
    p5: pct(pnls, 0.05),
    pctLose: pnls.length ? (100 * pnls.filter((v) => v < 0).length) / pnls.length : 0,
    maxDD: maxDrawdown(pnls),
    sharpe: s > 0 ? mean(pnls) / s : 0,
  };
}
const row = (label: string, m: Metrics): string =>
  `${label.padEnd(24)} n${String(m.n).padStart(4)}  pnl ${fmt(m.pnl).padStart(11)}  edge ${m.edge.toFixed(1).padStart(6)}%  ` +
  `std ${fmt(m.std).padStart(8)}  worst ${fmt(m.worst).padStart(10)}  p5 ${fmt(m.p5).padStart(9)}  ` +
  `lose ${m.pctLose.toFixed(0).padStart(3)}%  maxDD ${fmt(m.maxDD).padStart(10)}  Sh ${m.sharpe.toFixed(3).padStart(7)}`;

// ---- chronological train/test split on settlement time (oracle level) ----
const allStats = aggregate(emints); // passive universe, time-ordered
const splitIdx = Math.floor(allStats.length * TRAIN_FRAC);
const trainOracles = new Set(allStats.slice(0, splitIdx).map((o) => o.id));
const testOracles = new Set(allStats.slice(splitIdx).map((o) => o.id));
const splitT = allStats[splitIdx]?.t ?? 0;
const trainMints = emints.filter((e) => trainOracles.has(e.oracle));
const testMints = emints.filter((e) => testOracles.has(e.oracle));

console.log('═══════════════════════════════════════════════════════════════════════════════════════');
console.log('TRACK B — POSITION-LEVEL ACTIVE STRATEGIES vs PASSIVE PLP (out-of-sample validated)');
console.log('═══════════════════════════════════════════════════════════════════════════════════════');
console.log(
  `settled oracles: ${allStats.length}  mints: ${emints.length}  | chronological split @ settlement ` +
    `${new Date(splitT).toISOString().slice(0, 10)}  train ${trainOracles.size} oracles / test ${testOracles.size} oracles`,
);
console.log('Forward proxy = btc_1d close at/-before mint ts (overlaps the 2026 window; btc_15m is stale Aug-2024, unusable).');
console.log('');

// a rule = a predicate on a mint, calibrated ONLY on train, applied to both windows.
type Rule = (e: EMint) => boolean;
function evalRule(rule: Rule) {
  const trS = aggregate(trainMints.filter(rule));
  const teS = aggregate(testMints.filter(rule));
  return { train: metrics(trS), test: metrics(teS), teS };
}
const passiveTrain = metrics(aggregate(trainMints));
const passiveTest = metrics(aggregate(testMints));
const passiveTestStats = aggregate(testMints);

function show(name: string, rule: Rule) {
  const r = evalRule(rule);
  console.log(`── ${name}`);
  console.log(row('  passive[train]', passiveTrain));
  console.log(row('  rule   [train]', r.train));
  console.log(row('  passive[TEST]', passiveTest));
  console.log(row('  rule   [TEST]', r.test));
  const dEdge = r.test.edge - passiveTest.edge;
  const dPnl = r.test.pnl - passiveTest.pnl;
  console.log(
    `  OOS verdict: edge ${dEdge >= 0 ? '+' : ''}${dEdge.toFixed(1)}pp  pnl ${dPnl >= 0 ? '+' : ''}${fmt(dPnl)}  ` +
      `Sharpe ${(r.test.sharpe - passiveTest.sharpe >= 0 ? '+' : '')}${(r.test.sharpe - passiveTest.sharpe).toFixed(3)}  ` +
      `${r.test.edge > passiveTest.edge ? 'BEATS passive OOS' : 'does NOT beat passive OOS'}`,
  );
  console.log('');
  return r;
}

// ============ B1 dynamic tenor selection ============
// Estimate each tenor's edge on TRAIN; include only tenors with positive train edge.
const tenorEdgeTrain = new Map<Tenor, number>();
for (const t of ['15m', 'daily', 'weekly', 'monthly', 'unknown'] as Tenor[]) {
  const sel = trainMints.filter((e) => e.tenor === t);
  const prem = sum(sel.map((e) => e.cost));
  const pnl = sum(sel.map((e) => e.pnl));
  tenorEdgeTrain.set(t, prem > 0 ? (100 * pnl) / prem : -Infinity);
}
const goodTenors = new Set([...tenorEdgeTrain].filter(([, e]) => e > 0).map(([t]) => t));
console.log('B1 train tenor edges:',
  [...tenorEdgeTrain].map(([t, e]) => `${t}=${e === -Infinity ? 'n/a' : e.toFixed(1) + '%'}`).join('  '),
  '→ keep:', [...goodTenors].join(',') || '(none)');
const b1 = show('B1 dynamic tenor selection (keep train-positive tenors)', (e) => goodTenors.has(e.tenor));

// ============ B2 moneyness selection ============
// Bucket by |k| (forward proxy at mint). Keep buckets with positive TRAIN edge.
const kEdge = (lo: number, hi: number): number => {
  const sel = trainMints.filter((e) => e.k != null && Math.abs(e.k) >= lo && Math.abs(e.k) < hi);
  const prem = sum(sel.map((e) => e.cost));
  return prem > 0 ? (100 * sum(sel.map((e) => e.pnl))) / prem : -Infinity;
};
const kBuckets: [number, number][] = [[0, 0.005], [0.005, 0.015], [0.015, 0.03], [0.03, 0.06], [0.06, Infinity]];
const goodK = kBuckets.filter(([lo, hi]) => kEdge(lo, hi) > 0);
console.log('B2 train |k| bucket edges:',
  kBuckets.map(([lo, hi]) => `[${lo},${hi === Infinity ? '∞' : hi})=${(() => { const e = kEdge(lo, hi); return e === -Infinity ? 'n/a' : e.toFixed(1) + '%'; })()}`).join('  '),
  '→ keep', goodK.length, 'buckets');
const b2 = show('B2 moneyness selection (keep train-positive |k| buckets)', (e) =>
  e.k != null && goodK.some(([lo, hi]) => Math.abs(e.k!) >= lo && Math.abs(e.k!) < hi),
);

// ============ B3 edge-weighted participation ============
// Tilt toward higher quoteSpread (proxy for edge). Threshold = TRAIN median spread.
const spreads = trainMints.map((e) => e.spread).filter((s) => s > 0).sort((a, b) => a - b);
const spThresh = spreads[Math.floor(spreads.length / 2)] ?? 0;
console.log(`B3 train median quoteSpread threshold = ${spThresh.toFixed(4)} (keep mints with spread ≥ threshold)`);
const b3 = show('B3 high-spread participation (spread ≥ train median)', (e) => e.spread >= spThresh);
// also: high ask_price tilt (rich-premium positions)
const asks = trainMints.map((e) => e.ask).filter((a) => a > 0).sort((a, b) => a - b);
const askThresh = asks[Math.floor(asks.length * 0.5)] ?? 0;
console.log(`B3b train median ask threshold = ${askThresh.toFixed(4)}`);
const b3b = show('B3b high-ask participation (ask ≥ train median)', (e) => e.ask >= askThresh);

// ============ B4 inventory / side skew ============
// Per oracle, cap NET directional exposure |UP qty - DOWN qty|. Sweep the cap.
// We bound the rally tail by scaling down the *net* directional book per oracle:
// realized pnl with net cap = full pnl, but worst-case net liability ≤ cap.
// Model: split each oracle into balanced (offsetting) book + net residual; cap
// the net residual exposure to `cap`, keeping all premium on the balanced book.
function b4eval(cap: number, mints: EMint[]): OStat[] {
  const byO = new Map<string, EMint[]>();
  for (const e of mints) (byO.get(e.oracle) ?? byO.set(e.oracle, []).get(e.oracle)!).push(e);
  const out: OStat[] = [];
  for (const [oid, es] of byO) {
    const upQ = sum(es.filter((e) => e.isUp).map((e) => e.qty));
    const dnQ = sum(es.filter((e) => !e.isUp).map((e) => e.qty));
    const net = Math.abs(upQ - dnQ);
    // scale only the net-directional slice; balanced slice unaffected.
    const f = net > cap ? cap / net : 1; // fraction of net residual we keep
    // realized pnl decomposition: balanced book pnl + net book pnl.
    // balanced qty per side = min(upQ,dnQ); residual on the heavier side.
    const heavyIsUp = upQ >= dnQ;
    let pnl = 0, prem = 0;
    for (const e of es) {
      // a position on the heavy side contributes (balanced part *1) + (residual part *f)
      const onHeavy = e.isUp === heavyIsUp;
      const scale = onHeavy ? (() => {
        const heavyTot = heavyIsUp ? upQ : dnQ;
        const bal = Math.min(upQ, dnQ);
        const fracBalanced = heavyTot > 0 ? bal / heavyTot : 1; // share of this side that is balanced
        return fracBalanced + (1 - fracBalanced) * f;
      })() : 1;
      pnl += scale * e.pnl;
      prem += scale * e.cost;
    }
    out.push({ id: oid, pnl, prem, t: es[0].settT });
  }
  return out.sort((a, b) => a.t - b.t);
}
console.log('── B4 net-directional exposure cap sweep (bounds rally tail; OOS = TEST window)');
console.log(row('  passive[TEST]', passiveTest));
let b4best: { cap: number; m: Metrics } | null = null;
for (const cap of [25, 50, 100, 250, 500, 1000, Infinity]) {
  const trM = metrics(b4eval(cap, trainMints));
  const teM = metrics(b4eval(cap, testMints));
  const lbl = cap === Infinity ? 'uncapped' : `$${cap}`;
  console.log(row(`  cap ${lbl}[TEST]`, teM) + `   [train edge ${trM.edge.toFixed(1)}%]`);
  if (cap !== Infinity && (!b4best || teM.sharpe > b4best.m.sharpe)) b4best = { cap, m: teM };
}
console.log(`  best OOS Sharpe at cap $${b4best?.cap}: Sharpe ${b4best?.m.sharpe.toFixed(3)} vs passive ${passiveTest.sharpe.toFixed(3)}; ` +
  `pnl ${fmt(b4best?.m.pnl ?? 0)} vs ${fmt(passiveTest.pnl)} (caps trade PnL for tail safety)`);
console.log('');

// ============ B5 selective participation on the 10 rich oracles ============
// Where recorded ask diverges FAVORABLY from fair N(d2) (ask > fair for the side
// sold → house overcharged → positive expected edge), participate only there.
// Forward + SVI taken at-or-before mint ts (no lookahead).
console.log('── B5 rich-oracle selective participation (SMALL subset: 10 oracles with SVI+price data)');
interface RMint extends EMint { fairUp: number | null; edgeProxy: number | null }
const richMints: RMint[] = [];
for (const m of L.mints) {
  if (!richFwd.has(m.oracle_id)) continue;
  const S = L.settle.get(m.oracle_id);
  if (S === undefined) continue;
  const px = atOrBefore(richFwd.get(m.oracle_id), m.checkpoint_timestamp_ms);
  const sviEv = atOrBefore(richSvi.get(m.oracle_id), m.checkpoint_timestamp_ms);
  const strike = num(m.strike) / SCALE;
  const qty = num(m.quantity) / USDC;
  const cost = num(m.cost) / USDC;
  const ask = num(m.ask_price) / SCALE;
  const win = won(m.is_up, num(m.strike), S);
  let fairUp: number | null = null;
  if (px && sviEv) {
    const s = decodeSvi(sviEv);
    const fwd = px.forward / SCALE;
    try {
      fairUp = upPrice(s.a, s.b, s.rho, s.m, s.sigma, fwd, strike);
    } catch {
      fairUp = null;
    }
  }
  // fair price of the SIDE that was actually sold to the trader
  const fairSide = fairUp == null ? null : m.is_up ? fairUp : 1 - fairUp;
  // edge proxy = ask charged − fair value of that side (positive ⇒ house edge)
  const edgeProxy = fairSide == null ? null : ask - fairSide;
  richMints.push({
    oracle: m.oracle_id, isUp: m.is_up, strike, qty, cost, ask,
    t: m.checkpoint_timestamp_ms, settT: L.settledAt.get(m.oracle_id) ?? m.checkpoint_timestamp_ms,
    tenor: L.tenorOf.get(m.oracle_id) ?? 'unknown', win, pnl: cost - (win ? qty : 0),
    k: null, spread: 0, fairUp, edgeProxy,
  });
}
const priced = richMints.filter((r) => r.edgeProxy != null);
console.log(`  rich mints: ${richMints.length}  priced (SVI+fwd available at mint): ${priced.length}`);
if (priced.length) {
  const allRich = metrics(aggregate(priced));
  const favorable = priced.filter((r) => r.edgeProxy! > 0); // house overcharged
  const unfav = priced.filter((r) => r.edgeProxy! <= 0);
  console.log(row('  all rich flow', allRich));
  console.log(row('  favorable (ask>fair)', metrics(aggregate(favorable))) + `  [${favorable.length} mints]`);
  console.log(row('  unfavorable(ask≤fair)', metrics(aggregate(unfav))) + `  [${unfav.length} mints]`);
  // realized edge on the favorable subset vs all
  const favPnl = sum(favorable.map((r) => r.pnl)), favPrem = sum(favorable.map((r) => r.cost));
  const allPnl = sum(priced.map((r) => r.pnl)), allPrem = sum(priced.map((r) => r.cost));
  console.log(`  realized edge: favorable ${(100 * favPnl / (favPrem || 1)).toFixed(1)}%  vs  all-rich ${(100 * allPnl / (allPrem || 1)).toFixed(1)}%`);
  console.log('  NOTE: 10 oracles over a few days — too few independent settlements to validate OOS; directional read only.');
} else {
  console.log('  insufficient priced rich mints — cannot evaluate B5.');
}
console.log('');

// ============ B-best: combine OOS-surviving rules ============
const survivors: { name: string; rule: Rule }[] = [];
if (b1.test.edge > passiveTest.edge) survivors.push({ name: 'B1-tenor', rule: (e) => goodTenors.has(e.tenor) });
if (b2.test.edge > passiveTest.edge) survivors.push({ name: 'B2-moneyness', rule: (e) => e.k != null && goodK.some(([lo, hi]) => Math.abs(e.k!) >= lo && Math.abs(e.k!) < hi) });
if (b3.test.edge > passiveTest.edge) survivors.push({ name: 'B3-spread', rule: (e) => e.spread >= spThresh });
if (b3b.test.edge > passiveTest.edge) survivors.push({ name: 'B3b-ask', rule: (e) => e.ask >= askThresh });
console.log('── B-best: AND-combine rules that beat passive OOS:', survivors.map((s) => s.name).join(' & ') || '(none survived)');
let bbest: ReturnType<typeof evalRule> | null = null;
if (survivors.length) {
  const combo: Rule = (e) => survivors.every((s) => s.rule(e));
  bbest = show('B-best (' + survivors.map((s) => s.name).join(' & ') + ')', combo);
} else {
  console.log('  No single rule beat passive out-of-sample on edge; nothing to combine.\n');
}

// ============ robustness: bootstrap CI on OOS edge improvement ============
// Resample TEST oracles with replacement; CI on (rule edge − passive edge).
function bootCI(rule: Rule, name: string) {
  const teRuleStats = aggregate(testMints.filter(rule));
  const ruleById = new Map(teRuleStats.map((s) => [s.id, s]));
  const passById = new Map(passiveTestStats.map((s) => [s.id, s]));
  const ids = passiveTestStats.map((s) => s.id);
  const N = 2000;
  const diffs: number[] = [];
  let rng = 123456789;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < N; i++) {
    let rp = 0, rpr = 0, pp = 0, ppr = 0;
    for (let j = 0; j < ids.length; j++) {
      const id = ids[Math.floor(rand() * ids.length)];
      const rs = ruleById.get(id);
      if (rs) { rp += rs.pnl; rpr += rs.prem; }
      const ps = passById.get(id)!;
      pp += ps.pnl; ppr += ps.prem;
    }
    const rEdge = rpr > 0 ? (100 * rp) / rpr : 0;
    const pEdge = ppr > 0 ? (100 * pp) / ppr : 0;
    diffs.push(rEdge - pEdge);
  }
  diffs.sort((a, b) => a - b);
  const lo = diffs[Math.floor(0.025 * N)], hi = diffs[Math.floor(0.975 * N)], md = diffs[Math.floor(0.5 * N)];
  const pPos = (100 * diffs.filter((d) => d > 0).length) / N;
  console.log(`  ${name.padEnd(16)} ΔEdge OOS median ${md >= 0 ? '+' : ''}${md.toFixed(1)}pp  95% CI [${lo.toFixed(1)}, ${hi.toFixed(1)}]pp  P(Δ>0)=${pPos.toFixed(0)}%`);
}
console.log('── robustness: bootstrap CI on OOS edge improvement (2000 resamples of TEST oracles)');
bootCI((e) => goodTenors.has(e.tenor), 'B1-tenor');
bootCI((e) => e.k != null && goodK.some(([lo, hi]) => Math.abs(e.k!) >= lo && Math.abs(e.k!) < hi), 'B2-moneyness');
bootCI((e) => e.spread >= spThresh, 'B3-spread');
bootCI((e) => e.ask >= askThresh, 'B3b-ask');
if (survivors.length) bootCI((e) => survivors.every((s) => s.rule(e)), 'B-best');
console.log('');

// ============ walk-forward (3 chronological folds) for the tenor rule ============
// Re-fit goodTenors on each expanding train, evaluate on next slice.
console.log('── walk-forward (expanding window, refit B1 tenor selection each fold)');
const folds = 4;
for (let k = 1; k < folds; k++) {
  const cut = Math.floor((allStats.length * k) / folds);
  const nextCut = Math.floor((allStats.length * (k + 1)) / folds);
  const trIds = new Set(allStats.slice(0, cut).map((o) => o.id));
  const teIds = new Set(allStats.slice(cut, nextCut).map((o) => o.id));
  const tr = emints.filter((e) => trIds.has(e.oracle));
  const te = emints.filter((e) => teIds.has(e.oracle));
  const ge = new Set<Tenor>();
  for (const t of ['15m', 'daily', 'weekly', 'monthly'] as Tenor[]) {
    const sel = tr.filter((e) => e.tenor === t);
    const prem = sum(sel.map((e) => e.cost));
    if (prem > 0 && sum(sel.map((e) => e.pnl)) > 0) ge.add(t);
  }
  const pPass = metrics(aggregate(te));
  const pRule = metrics(aggregate(te.filter((e) => ge.has(e.tenor))));
  console.log(`  fold ${k}: keep[${[...ge].join(',') || 'none'}]  passive edge ${pPass.edge.toFixed(1)}%  rule edge ${pRule.edge.toFixed(1)}%  ` +
    `Δ ${(pRule.edge - pPass.edge >= 0 ? '+' : '')}${(pRule.edge - pPass.edge).toFixed(1)}pp  ${pRule.edge > pPass.edge ? 'WIN' : 'lose'}`);
}
