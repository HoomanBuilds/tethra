import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAll, DATA, num, USDC, won, fmt, type Tenor } from './data.ts';

const closes = (f: string): number[] => {
  try {
    return (JSON.parse(readFileSync(resolve(DATA, f), 'utf8')) as unknown[][]).map((r) => Number(r[4]));
  } catch {
    return [];
  }
};
const daily = [...closes('btc_1d_old.json'), ...closes('btc_1d.json')];
const m15 = closes('btc_15m.json');
const worstRoll = (s: number[], k: number): number => {
  let w = 0;
  for (let i = k; i < s.length; i++) w = Math.min(w, s[i] / s[i - k] - 1);
  return w;
};
const bestRoll = (s: number[], k: number): number => {
  let b = 0;
  for (let i = k; i < s.length; i++) b = Math.max(b, s[i] / s[i - k] - 1);
  return b;
};

const downTail: Record<Tenor, number> = { '15m': worstRoll(m15, 1), daily: worstRoll(daily, 1), weekly: worstRoll(daily, 7), monthly: worstRoll(daily, 30), unknown: worstRoll(daily, 1) };
const upTail: Record<Tenor, number> = { '15m': bestRoll(m15, 1), daily: bestRoll(daily, 1), weekly: bestRoll(daily, 7), monthly: bestRoll(daily, 30), unknown: bestRoll(daily, 1) };

const L = loadAll();
interface Pos { strike: number; isUp: boolean; qty: number; cost: number }
interface OB { positions: Pos[]; tenor: Tenor; settle: number; day: number }
const book = new Map<string, OB>();
for (const m of L.mints) {
  const S = L.settle.get(m.oracle_id);
  if (S === undefined) continue;
  const o = book.get(m.oracle_id) ?? { positions: [], tenor: L.tenorOf.get(m.oracle_id) ?? 'unknown', settle: S, day: Math.floor((L.settledAt.get(m.oracle_id) ?? 0) / 86_400_000) };
  o.positions.push({ strike: num(m.strike), isUp: m.is_up, qty: num(m.quantity) / USDC, cost: num(m.cost) / USDC });
  book.set(m.oracle_id, o);
}
const oracles = [...book.values()];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pnlAt = (o: OB, terminal: number): number => {
  let p = 0;
  for (const q of o.positions) p += q.cost - (won(q.isUp, q.strike, terminal) ? q.qty : 0);
  return p;
};

const down = oracles.map((o) => pnlAt(o, o.settle * (1 + downTail[o.tenor])));
const up = oracles.map((o) => pnlAt(o, o.settle * (1 + upTail[o.tenor])));
const worstDir = oracles.map((_, i) => Math.min(down[i], up[i]));
const worstCase = oracles.map((o) => Math.min(pnlAt(o, 0), pnlAt(o, Number.MAX_SAFE_INTEGER)));
const baseline = oracles.map((o) => pnlAt(o, o.settle));
const TVL = 1_000_000;

console.log('═══ STRESS TEST — real BTC crash regimes on the real book ═══');
console.log(`book: ${oracles.length} settled oracles, ${L.mints.length} positions, ~$1M vault.`);
console.log(`real BTC down tail: 15m ${(100 * downTail['15m']).toFixed(1)}%  1d ${(100 * downTail.daily).toFixed(1)}%  7d ${(100 * downTail.weekly).toFixed(1)}%  30d ${(100 * downTail.monthly).toFixed(1)}%`);
console.log(`real BTC up tail:   15m +${(100 * upTail['15m']).toFixed(1)}%  1d +${(100 * upTail.daily).toFixed(1)}%  7d +${(100 * upTail.weekly).toFixed(1)}%  30d +${(100 * upTail.monthly).toFixed(1)}%\n`);

const line = (lbl: string, s: number[]) => console.log(`${lbl.padEnd(30)} total ${fmt(sum(s)).padStart(11)} (${(100 * sum(s) / TVL).toFixed(2)}% TVL)  worst oracle ${fmt(Math.min(...s)).padStart(10)}`);
line('baseline (actual)', baseline);
line('crash DOWN', down);
line('crash UP', up);
line('worst direction / oracle', worstDir);
line('absolute floor (all ITM)', worstCase);

const byDay = new Map<number, number[]>();
oracles.forEach((o, i) => {
  const a = byDay.get(o.day) ?? [];
  a.push(i);
  byDay.set(o.day, a);
});
let worstDay = 0;
for (const idx of byDay.values()) worstDay = Math.min(worstDay, Math.min(sum(idx.map((i) => down[i])), sum(idx.map((i) => up[i]))));
console.log(`\nworst single settlement-day (worse direction): ${fmt(worstDay)} over ${byDay.size} active days`);

console.log('\nexposure cap bounds the worst-direction tail:');
for (const C of [250, 500, 1000, Infinity]) {
  const capped = worstDir.map((p) => Math.max(p, -C));
  console.log(`  cap ${(C === Infinity ? 'none' : '$' + C).padEnd(5)}: tail ${fmt(sum(capped)).padStart(11)} (${(100 * sum(capped) / TVL).toFixed(2)}% TVL)  worst oracle ${fmt(Math.min(...capped)).padStart(9)}`);
}
console.log(`\nscaling: tail is ${(100 * Math.abs(sum(worstDir)) / TVL).toFixed(2)}% of TVL at current ~0.07% utilization;`);
console.log(`it scales ~linearly with book size — at 10× utilization the uncapped tail ≈ ${(10 * 100 * Math.abs(sum(worstDir)) / TVL).toFixed(1)}% of TVL, which is why exposure caps matter as the vault grows.`);
