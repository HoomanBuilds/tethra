// Track A — AGGREGATE-EXPOSURE TIMING vs always-in passive PLP.
//
// The vault's only permissionless lever is a participation weight w_t in [0,1]
// applied to the WHOLE house-PnL stream (perOracle, ordered by settlement t).
// We cannot pick individual positions. Question: does timing total exposure
// beat passive (w=1) OUT OF SAMPLE, after reposition costs, on risk-adjusted
// terms? Realistic upside is drawdown reduction, not more yield.
//
// Data: real DeepBook Predict testnet flow (data.ts) + btc_1d.json for BTC
// momentum / realized vol. btc_15m.json is OUT OF the trading window so it is
// unusable here. The 10 SVI/prices files are 15m oracles on just 3 days, far
// too sparse for an honest implied-vs-realized gate across the full set, so A1
// is reported as LIMITED / inconclusive.
//
// Run: npx tsx src/sim/timing.ts  (from strategy/)

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAll, perOracle, fmt, DATA, type OAgg } from './data.ts';
import { decodeSvi, totalVariance, type RawSvi } from '../svi/pricing.ts';

// ── BTC daily klines: [openTime, o, h, l, c, ...] ────────────────────────────
type Kline = [number, string, string, string, string, ...unknown[]];
const btc1d = JSON.parse(readFileSync(resolve(DATA, 'btc_1d.json'), 'utf8')) as Kline[];
const btcBars = btc1d
  .map((k) => ({ t: Number(k[0]), close: Number(k[4]) }))
  .sort((a, b) => a.t - b.t);

// Daily log return at the bar whose open <= ts (last completed daily move).
function btcMomentum(ts: number, windowDays: number): number {
  let i = btcBars.length - 1;
  while (i > 0 && btcBars[i].t > ts) i--;
  if (i - windowDays < 0) return 0;
  const a = btcBars[i - windowDays].close;
  const b = btcBars[i].close;
  if (a <= 0 || b <= 0) return 0;
  return Math.log(b / a);
}

// ── helpers (backtest.ts has these privately; replicate, do not import) ───────
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const maxDrawdown = (pnls: number[]) => {
  let cum = 0;
  let peak = 0;
  let mdd = 0;
  for (const p of pnls) {
    cum += p;
    peak = Math.max(peak, cum);
    mdd = Math.max(mdd, peak - cum);
  }
  return mdd;
};

// ── reposition cost ──────────────────────────────────────────────────────────
// Changing w means withdrawing/redepositing pool capital: gas + pool conversion
// spread. Charge COST_BPS on the |Δw| fraction of a reference book size each
// time w changes. Reference = a notional vault slice tied to per-oracle premium
// scale (median premium ~ $2, p90 ~ $76); we use a fixed REF_CAPITAL so the cost
// is a real drag, not a rounding error. State assumption clearly in output.
const COST_BPS = 5; // 5 bps of repositioned capital per reposition step
const REF_CAPITAL = 1000; // $ of pool capital repositioned per full 0->1 swing

function repositionCost(weights: number[]): number {
  let c = 0;
  let prev = 1; // start fully in (passive default); first move away is a cost
  for (const w of weights) {
    c += (Math.abs(w - prev) * REF_CAPITAL * COST_BPS) / 10_000;
    prev = w;
  }
  return c;
}

// ── weighted stats for one segment given a weight per oracle ──────────────────
interface Stats {
  n: number;
  pnl: number;
  prem: number;
  edge: number;
  std: number;
  worst: number;
  p5: number;
  pctLosing: number;
  mdd: number;
  sharpe: number;
  cost: number;
  netPnl: number;
}
function evalSeg(seg: OAgg[], weights: number[]): Stats {
  const wp = seg.map((o, i) => o.pnl * weights[i]);
  const wprem = seg.map((o, i) => o.prem * weights[i]);
  const pnl = sum(wp);
  const prem = sum(wprem);
  const losing = wp.filter((v) => v < 0).length;
  const cost = repositionCost(weights);
  return {
    n: seg.length,
    pnl,
    prem,
    edge: prem ? (100 * pnl) / prem : 0,
    std: std(wp),
    worst: Math.min(...wp),
    p5: pct(wp, 0.05),
    pctLosing: (100 * losing) / seg.length,
    mdd: maxDrawdown(wp),
    sharpe: std(wp) ? mean(wp) / std(wp) : 0,
    cost,
    netPnl: pnl - cost,
  };
}

// ── A1: SVI ATM implied vol proxy from the rich (but sparse) oracles ──────────
// ATM total variance w(k=0) = a + b*(sqrt(m^2+sigma^2) - rho*m). Annualize using
// each oracle's tenor (15m -> hours) to an implied sigma. Compare vs realized
// BTC daily vol at the same time. Reported only; NOT used as a full-set gate.
function sviAtmImpliedVolReport(byT: Map<number, number>): string[] {
  const files = readdirSync(DATA).filter((f) => f.startsWith('svi_'));
  const lines: string[] = [];
  const oracles = loadAll().oracles;
  const oById = new Map(oracles.map((o) => [o.oracle_id.replace(/^0x/, ''), o]));
  const realizedVol = (ts: number) => {
    // annualized realized vol from trailing 14 daily log returns
    let i = btcBars.length - 1;
    while (i > 0 && btcBars[i].t > ts) i--;
    const rets: number[] = [];
    for (let j = Math.max(1, i - 13); j <= i; j++) rets.push(Math.log(btcBars[j].close / btcBars[j - 1].close));
    return std(rets) * Math.sqrt(365);
  };
  for (const f of files.sort()) {
    const id = f.slice(4, -5);
    const evs = JSON.parse(readFileSync(resolve(DATA, f), 'utf8')) as (RawSvi & { checkpoint_timestamp_ms: number })[];
    if (!evs.length) continue;
    const last = evs[evs.length - 1];
    const s = decodeSvi(last);
    const wAtm = totalVariance(s.a, s.b, s.rho, s.m, s.sigma, 0); // total variance at k=0
    const o = oById.get(id);
    const lifeH = o?.activated_at ? (o.expiry - o.activated_at) / 3_600_000 : 0;
    // SVI 'w' is total variance over the option's life; annualize: sigma=sqrt(w/T)
    const T = lifeH / (24 * 365);
    const ivAnn = T > 0 ? Math.sqrt(Math.max(wAtm, 0) / T) : NaN;
    const ts = Number(last.checkpoint_timestamp_ms);
    const rv = realizedVol(ts);
    byT.set(ts, ivAnn);
    lines.push(
      `  ${id.slice(0, 8)}  ${new Date(ts).toISOString().slice(0, 16)}  IV(ATM) ${(ivAnn * 100).toFixed(0)}%  RV(14d) ${(rv * 100).toFixed(0)}%  IV-RV ${((ivAnn - rv) * 100).toFixed(0)}pp`,
    );
  }
  return lines;
}

// ── timing strategies: each returns a weight per oracle over the FULL stream ──
// (defined causally — weight for oracle i uses only info available before t_i)
type Strategy = (s: OAgg[]) => number[];

const A0_passive: Strategy = (s) => s.map(() => 1);

// A2 trend/regime filter: tail risk is a BTC rally; cut w when |momentum| big.
// 3-day BTC log-return; if |mom| > 4% halve w, > 7% quarter it.
const A2_trend: Strategy = (s) =>
  s.map((o) => {
    const m = Math.abs(btcMomentum(o.t, 3));
    if (m > 0.07) return 0.25;
    if (m > 0.04) return 0.5;
    return 1;
  });

// A3 flow/utilization scaling: scale w UP with recent premium volume (wider
// spreads accompany high utilization -> better expected edge). Rolling 20-oracle
// premium sum, normalized to its running median; clamp w to [0.5,1].
const A3_flow: Strategy = (s) => {
  const win = 20;
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const lo = Math.max(0, i - win);
    const recent = s.slice(lo, i).map((o) => o.prem);
    if (recent.length < 5) {
      out.push(1);
      continue;
    }
    const med = pct(recent, 0.5) || 1;
    const cur = mean(recent.slice(-5));
    const ratio = cur / med;
    out.push(Math.max(0.5, Math.min(1, 0.5 + 0.5 * ratio)));
  }
  return out;
};

// A4 drawdown control: track cumulative (passive) PnL; if drawdown from peak
// exceeds a threshold, cut w; restore once recovered. Causal (uses realized
// PnL only up to the prior oracle).
const A4_dd: Strategy = (s) => {
  const cut = 80; // $ drawdown to de-risk
  const restore = 30; // $ recovery (from trough) to re-risk
  const out: number[] = [];
  let cum = 0;
  let peak = 0;
  let trough = 0;
  let on = true;
  for (let i = 0; i < s.length; i++) {
    out.push(on ? 1 : 0.25);
    cum += s[i].pnl; // realized after deciding weight for i
    peak = Math.max(peak, cum);
    trough = Math.min(trough, cum);
    if (on && peak - cum > cut) {
      on = false;
      trough = cum;
    } else if (!on) {
      trough = Math.min(trough, cum);
      if (cum - trough > restore) on = true;
    }
  }
  return out;
};

// A5 combination: de-risk on big momentum OR active drawdown; otherwise lean on
// flow. w = min(trend, dd) * flow.
const A5_combo: Strategy = (s) => {
  const t = A2_trend(s);
  const d = A4_dd(s);
  const f = A3_flow(s);
  return s.map((_, i) => Math.min(t[i], d[i]) * f[i]);
};

const STRATS: { name: string; fn: Strategy }[] = [
  { name: 'A0 passive   ', fn: A0_passive },
  { name: 'A2 trend     ', fn: A2_trend },
  { name: 'A3 flow      ', fn: A3_flow },
  { name: 'A4 drawdown  ', fn: A4_dd },
  { name: 'A5 combo     ', fn: A5_combo },
];

// ── run ──────────────────────────────────────────────────────────────────────
const l = loadAll();
const stream = perOracle(l); // ordered by settlement t

const ivByT = new Map<number, number>();
const a1Lines = sviAtmImpliedVolReport(ivByT);

const hr = '─'.repeat(118);
console.log('═══ TRACK A — AGGREGATE-EXPOSURE TIMING vs PASSIVE PLP (real testnet flow) ═══');
console.log(`oracles with flow: ${stream.length}`);
console.log(`cost model: ${COST_BPS} bps of $${REF_CAPITAL} repositioned per full 0→1 weight swing (gas + pool conversion spread)`);
console.log('');

// Flow is heavily back-loaded; expose regime structure so OOS results are read
// honestly. The final calendar week dominates total PnL.
const t0 = stream[0].t;
const t1 = stream[stream.length - 1].t;
console.log('WEEKLY passive house PnL (regime context — the final week dominates):');
const byWk = new Map<number, { n: number; pnl: number }>();
for (const o of stream) {
  const wk = Math.floor((o.t - t0) / (7 * 86_400_000));
  const a = byWk.get(wk) ?? { n: 0, pnl: 0 };
  a.n += 1;
  a.pnl += o.pnl;
  byWk.set(wk, a);
}
for (const wk of [...byWk.keys()].sort((a, b) => a - b)) {
  const v = byWk.get(wk)!;
  console.log(`  wk${wk}  n ${String(v.n).padStart(4)}  passive PnL ${fmt(v.pnl).padStart(11)}`);
}
console.log('');

function header(label: string) {
  console.log(`${label}`);
  console.log(
    'strategy        ' +
      ['gPnL', 'cost', 'netPnL', 'edge%', 'std', 'worst', 'p5', 'lose%', 'MDD', 'Sharpe'].map((h) => h.padStart(10)).join(''),
  );
  console.log(hr);
}
function row(name: string, st: Stats) {
  console.log(
    name +
      [
        fmt(st.pnl),
        fmt(st.cost),
        fmt(st.netPnl),
        st.edge.toFixed(2) + '%',
        fmt(st.std),
        fmt(st.worst),
        fmt(st.p5),
        st.pctLosing.toFixed(1) + '%',
        fmt(st.mdd),
        st.sharpe.toFixed(3),
      ]
        .map((c) => c.padStart(10))
        .join(''),
  );
}

// Run a full IS/OOS report for a given train/test partition (by index).
function runSplit(label: string, splitFn: () => number) {
  const idx = splitFn();
  const train = stream.slice(0, idx);
  const test = stream.slice(idx);
  console.log(`\n████ ${label} ████`);
  console.log(`train ${train.length} oracles (${new Date(train[0].t).toISOString().slice(0, 16)} → ${new Date(train[idx - 1].t).toISOString().slice(0, 16)})`);
  console.log(`test  ${test.length} oracles (${new Date(test[0].t).toISOString().slice(0, 16)} → ${new Date(test[test.length - 1].t).toISOString().slice(0, 16)})`);
  console.log('');

  const results: { name: string; is: Stats; oos: Stats }[] = [];
  for (const { name, fn } of STRATS) {
    const wFull = fn(stream); // causal weights over full stream, then slice
    results.push({ name, is: evalSeg(train, wFull.slice(0, idx)), oos: evalSeg(test, wFull.slice(idx)) });
  }

  header('IN-SAMPLE (train) — net of cost');
  for (const r of results) row(r.name, r.is);
  console.log('');
  header('OUT-OF-SAMPLE (test) — net of cost');
  for (const r of results) row(r.name, r.oos);
  console.log('');

  const passiveOos = results[0].oos;
  console.log('OUT-OF-SAMPLE vs passive (net of cost):');
  for (const r of results.slice(1)) {
    const dYield = r.oos.netPnl - passiveOos.netPnl;
    const dMdd = passiveOos.mdd - r.oos.mdd; // positive = less drawdown
    const dSharpe = r.oos.sharpe - passiveOos.sharpe;
    const mddTag = Math.abs(dMdd) < 0.5 ? '(same risk)' : dMdd > 0 ? '(less risk)' : '(MORE risk)';
    console.log(
      `  ${r.name}  Δnet ${fmt(dYield).padStart(10)}  ΔMDD ${(dMdd >= 0 ? '-' : '+') + fmt(Math.abs(dMdd))} ${mddTag}  ΔSharpe ${dSharpe >= 0 ? '+' : ''}${dSharpe.toFixed(3)}  ${dYield >= 0 ? 'YIELD≥passive' : 'yield<passive'}`,
    );
  }
}

// Split 1: chronological by COUNT (first 70% of oracles). Test = last ~3 days
// because flow is back-loaded.
runSplit('SPLIT BY COUNT (first 70% of oracles)', () => Math.floor(stream.length * 0.7));
// Split 2: chronological by CALENDAR TIME (first 70% of the time span). Wider,
// more representative test window.
runSplit('SPLIT BY CALENDAR TIME (first 70% of elapsed time)', () => {
  const cut = t0 + 0.7 * (t1 - t0);
  let i = 0;
  while (i < stream.length && stream[i].t < cut) i++;
  return i;
});
console.log('');

// ── A1 limited report ────────────────────────────────────────────────────────
console.log('A1 vol-regime gate — LIMITED / INCONCLUSIVE');
console.log('  Only 10 SVI surfaces exist, all 15m oracles on 3 days (2026-05-11, -06-10, -06-11).');
console.log('  Cannot honestly gate the full 2-month stream on implied-minus-realized. ATM IV proxy below:');
for (const ln of a1Lines) console.log(ln);
