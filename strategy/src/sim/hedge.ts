// Delta-hedge simulation on REAL per-oracle tick history, with variants.
// Finding under test: naive delta-hedging of SHORT-DATED DIGITALS backfires
// because a binary's delta spikes near the strike at expiry. We test fixes:
//   - stop hedging in the final N minutes before expiry (avoid the spike)
//   - cap the hedge size |H| (don't chase the spike)
//
// House is short every trader position:
//   trader UP (digital call): house delta = -qty * upDelta
//   trader DOWN (1-UP):       house delta = +qty * upDelta
// Hedge h (BTC) = -netHouseDelta; hedgePnL += h * (F_next - F_cur).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAll, DATA, num, USDC, SCALE, won, fmt, std } from './data.ts';
import { upDelta, decodeSvi, type RawSvi } from '../svi/pricing.ts';

const FEE_BPS = 5;

const { mints, reds, settle, oracles } = loadAll();
const expiryOf = new Map(oracles.map((o) => [o.oracle_id, o.expiry]));
const sampled = readdirSync(DATA)
  .filter((f) => f.startsWith('svi_') && f.endsWith('.json'))
  .map((f) => '0x' + f.slice(4, -5))
  .filter((oid) => settle.has(oid));

interface SviEv extends RawSvi { onchain_timestamp: number }
interface PxEv { forward: number; onchain_timestamp: number }
const asc = (a: { onchain_timestamp: number }, b: { onchain_timestamp: number }) => a.onchain_timestamp - b.onchain_timestamp;
const latestIdx = (arr: { onchain_timestamp: number }[], ts: number): number => {
  let lo = 0, hi = arr.length - 1, res = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].onchain_timestamp <= ts) { res = mid; lo = mid + 1; } else hi = mid - 1; }
  return res;
};

interface Ev { ts: number; key: string; strike: number; isUp: boolean; dq: number }
interface Cfg { K: number; stopMin: number; capMult: number }

function simOracle(oid: string, c: Cfg): [number, number] | null {
  const safe = oid.slice(2);
  let svi: SviEv[], px: PxEv[];
  try {
    svi = (JSON.parse(readFileSync(resolve(DATA, `svi_${safe}.json`), 'utf8')) as SviEv[]).sort(asc);
    px = (JSON.parse(readFileSync(resolve(DATA, `prices_${safe}.json`), 'utf8')) as PxEv[]).sort(asc);
  } catch { return null; }
  if (px.length < 2 || svi.length === 0) return null;
  const expiry = expiryOf.get(oid) ?? Infinity;

  const evs: Ev[] = [];
  let premium = 0, payout = 0;
  for (const m of mints) {
    if (m.oracle_id !== oid) continue;
    premium += num(m.cost) / USDC;
    if (won(m.is_up, num(m.strike), settle.get(oid)!)) payout += num(m.quantity) / USDC;
    evs.push({ ts: m.checkpoint_timestamp_ms, key: `${m.strike}|${m.is_up}`, strike: num(m.strike) / SCALE, isUp: m.is_up, dq: num(m.quantity) / USDC });
  }
  for (const r of reds as any[]) {
    if (r.oracle_id !== oid || r.is_settled) continue;
    evs.push({ ts: r.checkpoint_timestamp_ms, key: `${r.strike}|${r.is_up}`, strike: num(r.strike) / SCALE, isUp: r.is_up, dq: -num(r.quantity) / USDC });
  }
  evs.sort((a, b) => a.ts - b.ts);
  const unhedged = premium - payout;
  if (evs.length === 0) return [unhedged, unhedged];

  const book = new Map<string, { strike: number; isUp: boolean; qty: number }>();
  let ei = 0, H = 0, hedgePnL = 0, cost = 0;
  for (let i = 0; i < px.length - 1; i++) {
    const t = px[i].onchain_timestamp;
    while (ei < evs.length && evs[ei].ts <= t) {
      const e = evs[ei++];
      const b = book.get(e.key) ?? { strike: e.strike, isUp: e.isUp, qty: 0 };
      b.qty += e.dq; book.set(e.key, b);
    }
    const fwd = px[i].forward / SCALE, fwdNext = px[i + 1].forward / SCALE;
    if (fwd <= 0) continue;
    const stop = t >= expiry - c.stopMin * 60_000;
    if (i % c.K === 0 && !stop) {
      const s = svi[latestIdx(svi, t)];
      const p = decodeSvi(s);
      let netDelta = 0, notional = 0;
      for (const b of book.values()) {
        if (b.qty <= 0) continue;
        notional += b.qty;
        netDelta += (b.isUp ? -1 : 1) * b.qty * upDelta(p.a, p.b, p.rho, p.m, p.sigma, fwd, b.strike);
      }
      let target = -netDelta;
      const cap = (c.capMult * notional) / fwd; // max BTC hedge = capMult × notional/price
      if (cap > 0) target = Math.max(-cap, Math.min(cap, target));
      cost += Math.abs(target - H) * fwd * (FEE_BPS / 10_000);
      H = target;
    }
    hedgePnL += H * (fwdNext - fwd);
  }
  return [unhedged, unhedged + hedgePnL - cost];
}

function report(label: string, c: Cfg) {
  const rows = sampled.map((o) => simOracle(o, c)).filter((x): x is [number, number] => x !== null);
  const un = rows.map((r) => r[0]), he = rows.map((r) => r[1]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  console.log(`${label.padEnd(34)} total ${fmt(sum(he)).padStart(10)}  std ${fmt(std(he)).padStart(8)}  worst ${fmt(Math.min(...he)).padStart(9)}`);
}

console.log('═══ DELTA-HEDGE SIM (real 15m oracle ticks, ' + sampled.length + ' oracles) ═══');
const rows = sampled.map((o) => simOracle(o, { K: 300, stopMin: 0, capMult: 1e9 })).filter((x): x is [number, number] => x !== null);
console.log(`UNHEDGED baseline                  total ${fmt(rows.reduce((a, r) => a + r[0], 0)).padStart(10)}  std ${fmt(std(rows.map((r) => r[0]))).padStart(8)}  worst ${fmt(Math.min(...rows.map((r) => r[0]))).padStart(9)}\n`);
report('naive hedge (K=300)', { K: 300, stopMin: 0, capMult: 1e9 });
report('hedge, stop last 20min', { K: 300, stopMin: 20, capMult: 1e9 });
report('hedge, stop 20min + cap 1x', { K: 300, stopMin: 20, capMult: 1 });
report('hedge, stop 30min + cap 0.5x', { K: 300, stopMin: 30, capMult: 0.5 });
report('hedge, stop 45min + cap 0.5x', { K: 300, stopMin: 45, capMult: 0.5 });
console.log('\n(15m oracles are ~2h-lived; "stop Nmin" freezes the hedge in the final N minutes to avoid the digital delta spike.)');
