// Validate the SVI pricing engine against REAL on-chain ask_price.
// For each minted position on a sampled oracle, find the latest SVI + forward
// at/just-before the mint time, recompute the modeled ask, and compare to the
// recorded ask_price. Small error ⇒ compute_nd2 + spread replicated correctly.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upPrice, quoteSpread, decodeSvi, SCALE, type RawSvi } from './pricing.ts';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data');
const num = (x: any): number => (x == null ? 0 : Number(x));

interface Mint {
  oracle_id: string;
  strike: string | number;
  is_up: boolean;
  cost: string | number;
  quantity: string | number;
  ask_price: string | number;
  checkpoint_timestamp_ms: number;
}
interface SviEv extends RawSvi {
  onchain_timestamp: number;
}
interface PriceEv {
  forward: number;
  spot: number;
  onchain_timestamp: number;
}

const mints = JSON.parse(readFileSync(resolve(DATA, 'positions_minted.json'), 'utf8')) as Mint[];
const sampled = readdirSync(DATA)
  .filter((f) => f.startsWith('svi_') && f.endsWith('.json'))
  .map((f) => '0x' + f.slice(4, -5));

const asc = (a: { onchain_timestamp: number }, b: { onchain_timestamp: number }) =>
  a.onchain_timestamp - b.onchain_timestamp;
const latestAtOrBefore = <T extends { onchain_timestamp: number }>(arr: T[], ts: number): T | null => {
  let lo = 0,
    hi = arr.length - 1,
    res: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].onchain_timestamp <= ts) {
      res = arr[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return res;
};

const errs: number[] = [];
const samples: string[] = [];
let covered = 0;
let total = 0;

for (const oid of sampled) {
  const safe = oid.slice(2);
  const svi = (JSON.parse(readFileSync(resolve(DATA, `svi_${safe}.json`), 'utf8')) as SviEv[]).sort(asc);
  const px = (JSON.parse(readFileSync(resolve(DATA, `prices_${safe}.json`), 'utf8')) as PriceEv[]).sort(asc);
  const oracleMints = mints.filter((m) => m.oracle_id === oid);
  total += oracleMints.length;
  for (const m of oracleMints) {
    const ts = m.checkpoint_timestamp_ms;
    const s = latestAtOrBefore(svi, ts);
    const p = latestAtOrBefore(px, ts);
    if (!s || !p || !p.forward) continue;
    covered++;
    const { a, b, rho, m: mm, sigma } = decodeSvi(s);
    let fairUp: number;
    try {
      fairUp = upPrice(a, b, rho, mm, sigma, p.forward, num(m.strike));
    } catch {
      continue;
    }
    const fairSide = m.is_up ? fairUp : 1 - fairUp;
    // utilization spread ~0 at current ~0.07% util; bernoulli term dominates.
    const spread = quoteSpread(fairUp);
    const modeledAsk = Math.min(fairSide + spread, 1);
    const realAsk = num(m.ask_price) / SCALE;
    const err = modeledAsk - realAsk;
    errs.push(err);
    if (samples.length < 8)
      samples.push(
        `  ${m.is_up ? 'UP ' : 'DN '} fair=${fairSide.toFixed(4)} spread=${spread.toFixed(4)} model=${modeledAsk.toFixed(4)} real=${realAsk.toFixed(4)} err=${(err >= 0 ? '+' : '') + err.toFixed(4)}`,
      );
  }
}

const abs = errs.map(Math.abs).sort((a, b) => a - b);
const mean = abs.reduce((a, b) => a + b, 0) / (abs.length || 1);
const p = (q: number) => abs[Math.min(abs.length - 1, Math.floor(q * abs.length))];
console.log('═══ SVI PRICING ENGINE VALIDATION (modeled ask vs real on-chain ask) ═══');
console.log(`sampled oracles: ${sampled.length}  mints: ${total}  priced: ${errs.length} (coverage ${((100 * covered) / total).toFixed(0)}%)`);
console.log(`abs error vs real ask:  mean ${mean.toFixed(5)}  median ${p(0.5).toFixed(5)}  p90 ${p(0.9).toFixed(5)}  p99 ${p(0.99).toFixed(5)}  max ${(abs[abs.length - 1] ?? 0).toFixed(5)}`);
console.log(`(ask is a probability in [0,1]; error 0.005 = half a cent on the dollar)`);
console.log('examples:');
console.log(samples.join('\n'));
