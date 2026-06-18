// Realized house-PnL backtest over REAL DeepBook Predict testnet data.
// No pricing model needed for the baseline: per settled oracle,
//   house PnL = Σ premiums(cost) − Σ payouts(qty to winners).
// Winner rule mirrors compute_price at settlement (digital call):
//   UP wins iff settlement > strike; DOWN wins iff settlement <= strike.
//
// Data files (raw indexer JSON) live in repo-root data/.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data');
const SCALE = 1_000_000_000; // 1e9 for prices/strikes
const USDC = 1_000_000; // 6dp; quantity & cost are USDC units ($1 payout = 1_000_000)

interface Mint {
  oracle_id: string;
  strike: string | number;
  is_up: boolean;
  quantity: string | number;
  cost: string | number;
  checkpoint_timestamp_ms: number;
}
interface Oracle {
  oracle_id: string;
  status: string;
  settlement_price?: string | number | null;
  expiry: number;
  activated_at?: number;
}
interface Redeem {
  oracle_id: string;
  payout: string | number;
  is_settled: boolean;
}

const load = <T>(f: string): T => JSON.parse(readFileSync(resolve(DATA, f), 'utf8')) as T;
const num = (x: string | number | null | undefined): number => (x == null ? 0 : Number(x));

const mints = load<Mint[]>('positions_minted.json');
const oracles = load<Oracle[]>('oracles.json');
const reds = load<Redeem[]>('positions_redeemed.json');

// settled oracle -> settlement price (1e9), plus tenor classification
const settle = new Map<string, number>();
const tenorOf = new Map<string, string>();
for (const o of oracles) {
  if (o.status === 'settled' && o.settlement_price != null) settle.set(o.oracle_id, num(o.settlement_price));
  const lifeH = o.activated_at ? (o.expiry - o.activated_at) / 3_600_000 : 0;
  tenorOf.set(o.oracle_id, lifeH <= 0 ? 'unknown' : lifeH < 3 ? '15m' : lifeH < 36 ? 'daily' : lifeH < 240 ? 'weekly' : 'monthly');
}

const won = (isUp: boolean, strike: number, S: number) => (isUp ? S > strike : S <= strike);

// Per-oracle aggregation (hold-to-settlement).
const prem = new Map<string, number>();
const pay = new Map<string, number>();
const cnt = new Map<string, number>();
let unmatched = 0;
let minTs = Infinity;
let maxTs = 0;
const tenorPnl = new Map<string, { prem: number; pay: number; n: number }>();

for (const m of mints) {
  const S = settle.get(m.oracle_id);
  minTs = Math.min(minTs, m.checkpoint_timestamp_ms);
  maxTs = Math.max(maxTs, m.checkpoint_timestamp_ms);
  if (S === undefined) {
    unmatched++;
    continue;
  }
  const strike = num(m.strike);
  const qty = num(m.quantity) / USDC;
  const cost = num(m.cost) / USDC;
  prem.set(m.oracle_id, (prem.get(m.oracle_id) ?? 0) + cost);
  cnt.set(m.oracle_id, (cnt.get(m.oracle_id) ?? 0) + 1);
  const w = won(m.is_up, strike, S);
  if (w) pay.set(m.oracle_id, (pay.get(m.oracle_id) ?? 0) + qty);
  const tk = tenorOf.get(m.oracle_id) ?? 'unknown';
  const tp = tenorPnl.get(tk) ?? { prem: 0, pay: 0, n: 0 };
  tp.prem += cost;
  tp.pay += w ? qty : 0;
  tp.n += 1;
  tenorPnl.set(tk, tp);
}

const oids = [...prem.keys()];
const pnl = oids.map((o) => (prem.get(o) ?? 0) - (pay.get(o) ?? 0));
const totalPrem = [...prem.values()].reduce((a, b) => a + b, 0);
const totalPay = [...pay.values()].reduce((a, b) => a + b, 0);
const totalPnl = totalPrem - totalPay;
const nMints = [...cnt.values()].reduce((a, b) => a + b, 0);

const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const fmt = (x: number) => `$${x.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const losers = pnl.filter((v) => v < 0);
const days = (maxTs - minTs) / 86_400_000;

console.log('═══ PLP HOUSE BACKTEST (real testnet flow, hold-to-settlement) ═══');
console.log(`mints total: ${mints.length}  on settled oracles: ${nMints}  (unmatched/unsettled: ${unmatched})`);
console.log(`settled oracles with flow: ${oids.length}`);
console.log(`period: ${days.toFixed(1)} days (${new Date(minTs).toISOString().slice(0, 10)} → ${new Date(maxTs).toISOString().slice(0, 10)})`);
console.log('');
console.log(`Σ premium collected: ${fmt(totalPrem)}`);
console.log(`Σ payout to winners: ${fmt(totalPay)}`);
console.log(`HOUSE PnL:           ${fmt(totalPnl)}   (edge = PnL/premium = ${((100 * totalPnl) / totalPrem).toFixed(2)}%)`);
console.log(`as % of ~$1M vault:  ${((100 * totalPnl) / 1e6).toFixed(3)}%  over ${days.toFixed(0)}d  →  ~${(((totalPnl / 1e6) * 365) / days * 100).toFixed(2)}% APR (gross, flow-limited)`);
console.log('');
console.log('per-oracle PnL distribution:');
console.log(`  min ${fmt(Math.min(...pnl))}  p1 ${fmt(pct(pnl, 0.01))}  p5 ${fmt(pct(pnl, 0.05))}  median ${fmt(pct(pnl, 0.5))}  p95 ${fmt(pct(pnl, 0.95))}  max ${fmt(Math.max(...pnl))}`);
console.log(`  losing oracles: ${losers.length}/${pnl.length} (${((100 * losers.length) / pnl.length).toFixed(1)}%)  total loss on losers ${fmt(losers.reduce((a, b) => a + b, 0))}`);
console.log('');
console.log('by tenor:');
for (const [t, v] of [...tenorPnl.entries()].sort()) {
  const p = v.prem - v.pay;
  console.log(`  ${t.padEnd(8)} mints ${String(v.n).padStart(5)}  prem ${fmt(v.prem).padStart(12)}  pnl ${fmt(p).padStart(12)}  edge ${((100 * p) / (v.prem || 1)).toFixed(1)}%`);
}
console.log('');
// Model-free cross-check: every recorded cashflow.
const cashIn = mints.reduce((a, m) => a + num(m.cost), 0) / USDC;
const cashOut = reds.reduce((a, r) => a + num(r.payout), 0) / USDC;
console.log('model-free cash recon (all recorded flow, incl. unsettled & pre-settle exits):');
console.log(`  Σ mint cost in ${fmt(cashIn)}  −  Σ redeemed payout out ${fmt(cashOut)}  =  net ${fmt(cashIn - cashOut)}`);
console.log(`  (${reds.length} redemptions: ${reds.filter((r) => !r.is_settled).length} pre-settle, ${reds.filter((r) => r.is_settled).length} settled)`);
