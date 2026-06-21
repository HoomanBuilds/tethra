// Reproducible exporter: derives the web analytics JSON from REAL committed
// testnet flow, reusing the same per-oracle realized-PnL computation as
// backtest.ts / data.ts and the same pricing replica as svi/validate.ts.
// Output: web/lib/data/backtest.json (shape enforced by web/lib/backtest-data.ts).
//
// Every series traces to committed files in repo-root data/:
//   btc_1d.json, positions_minted.json, positions_redeemed.json, oracles.json,
//   svi_*.json, prices_*.json. No synthetic numbers.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, perOracle, USDC, num, won, type OAgg } from './data.ts';
import { upPrice, quoteSpread, decodeSvi, SCALE, type RawSvi } from '../svi/pricing.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '../../../data');
const OUT = resolve(HERE, '../../../web/lib/data/backtest.json');

// Configured pool TVL used across the strategy sims (econ.ts ~1.015M, stress.ts 1M).
// We use the round $1M figure that backtest/stress.ts use for TVL-relative numbers.
const TVL = 1_000_000;
const FEE = 0.1; // performance fee to vault; 90% to depositors.
const EXPOSURE_CAP = 1000; // $/oracle worst-direction cap studied in stress.ts.

const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(DATA, f), 'utf8')) as T;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const round = (x: number, d = 4): number => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

// ── BTC daily closes (real) ────────────────────────────────────────────────
// Binance kline row: [openTime, open, high, low, close, ...]; close at index 4.
const btcRaw = read<unknown[][]>('btc_1d.json');
const btcAll = btcRaw
  .map((r) => ({ t: isoDay(Number(r[0])), v: round(Number(r[4]), 2) }))
  .filter((p) => Number.isFinite(p.v) && p.v > 0);
// Downsample to ~150 points, keeping real timestamps + last point.
const targetBtc = 150;
const step = Math.max(1, Math.floor(btcAll.length / targetBtc));
const btc: { t: string; v: number }[] = [];
for (let i = 0; i < btcAll.length; i += step) btc.push(btcAll[i]);
if (btc.length && btc[btc.length - 1].t !== btcAll[btcAll.length - 1].t) btc.push(btcAll[btcAll.length - 1]);

// ── House-PnL backtest over settled oracles (real, chronological) ──────────
const L = loadAll();
const os: OAgg[] = perOracle(L); // sorted by settlement time, prem > 0 only.
const nPositions = L.reds.length; // real redemption count.

// NAV compounds realized house PnL per settled oracle against the pool TVL.
// drawdown = running peak-to-trough % of NAV. feeYield = cumulative 10% fee on
// positive NAV increments (high-water-marked: fee only on new profit).
let navVal = 100;
let peak = 100;
let cumFee = 0;
let hwm = 100; // high-water mark for performance fee.
const nav: { t: string; v: number }[] = [];
const drawdown: { t: string; v: number }[] = [];
const feeYield: { t: string; v: number }[] = [];

for (const o of os) {
  const day = isoDay(o.t);
  const prev = navVal;
  navVal = prev * (1 + o.pnl / TVL); // realized PnL as fraction of pool.
  if (navVal > hwm) {
    cumFee += FEE * (navVal - hwm); // fee charged only above the high-water mark.
    hwm = navVal;
  }
  peak = Math.max(peak, navVal);
  nav.push({ t: day, v: round(navVal, 4) });
  drawdown.push({ t: day, v: round(100 * (navVal / peak - 1), 4) });
  feeYield.push({ t: day, v: round(cumFee, 4) });
}

// Collapse to one point per settlement day (last NAV of the day) so the series
// is readable; keeps every distinct settlement day as a real timestamp.
const collapseLast = (pts: { t: string; v: number }[]) => {
  const m = new Map<string, number>();
  for (const p of pts) m.set(p.t, p.v);
  return [...m.entries()].map(([t, v]) => ({ t, v }));
};
const navD = collapseLast(nav);
const ddD = collapseLast(drawdown);
const feeD = collapseLast(feeYield);

// ── Exposure vs cap: open payout liability per settlement day ──────────────
// For each settled oracle, worst-direction max payout = Σ qty (every UP+DOWN
// leg could in principle pay $1/unit). We aggregate by settlement day and show
// per-oracle average notional against the configured per-oracle cap.
const dayMaxPay = new Map<string, { pay: number; n: number }>();
for (const mt of L.mints) {
  const S = L.settle.get(mt.oracle_id);
  if (S === undefined) continue;
  const t = L.settledAt.get(mt.oracle_id) ?? mt.checkpoint_timestamp_ms;
  const day = isoDay(t);
  const qty = num(mt.quantity) / USDC;
  const cur = dayMaxPay.get(day) ?? { pay: 0, n: 0 };
  cur.pay += qty;
  dayMaxPay.set(day, cur);
}
// count distinct oracles settling each day for a per-oracle average.
const dayOracles = new Map<string, Set<string>>();
for (const o of os) {
  const day = isoDay(o.t);
  const s = dayOracles.get(day) ?? new Set<string>();
  s.add(o.id);
  dayOracles.set(day, s);
}
const exposure = [...dayMaxPay.entries()]
  .map(([day, agg]) => {
    const nOr = dayOracles.get(day)?.size ?? 1;
    return { t: day, v: round(agg.pay / nOr, 2), cap: EXPOSURE_CAP };
  })
  .sort((a, b) => (a.t < b.t ? -1 : 1));

// ── Summary numbers (real) ─────────────────────────────────────────────────
const totalPrem = os.reduce((a, o) => a + o.prem, 0);
const totalPnl = os.reduce((a, o) => a + o.pnl, 0);
const edge = totalPrem > 0 ? totalPnl / totalPrem : 0; // house edge fraction.
const houseEdgeBps = Math.round(10_000 * edge);
const maxDrawdownPct = round(Math.min(...ddD.map((p) => p.v)), 2);
const grossYieldPct = round(100 * (navD[navD.length - 1].v / 100 - 1), 4);
const netYieldPct = round(grossYieldPct * (1 - FEE), 4);

// Window label (no dashes).
const ts = os.map((o) => o.t).filter((x) => x > 0);
const minT = new Date(Math.min(...ts));
const maxT = new Date(Math.max(...ts));
const monthYr = (d: Date) =>
  d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const windowLabel = `${monthYr(minT)} to ${monthYr(maxT)} testnet flow`;

// ── Pricing: modeled ask vs real on-chain ask (real replica) ───────────────
interface SviEv extends RawSvi {
  onchain_timestamp: number;
}
interface PriceEv {
  forward: number;
  spot: number;
  onchain_timestamp: number;
}
interface PMint {
  oracle_id: string;
  strike: string | number;
  is_up: boolean;
  ask_price: string | number;
  checkpoint_timestamp_ms: number;
}
const asc = (a: { onchain_timestamp: number }, b: { onchain_timestamp: number }) =>
  a.onchain_timestamp - b.onchain_timestamp;
const latestAtOrBefore = <T extends { onchain_timestamp: number }>(arr: T[], t: number): T | null => {
  let lo = 0,
    hi = arr.length - 1,
    res: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].onchain_timestamp <= t) {
      res = arr[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return res;
};

const pmints = read<PMint[]>('positions_minted.json');
const sviFiles = readdirSync(DATA).filter((f) => f.startsWith('svi_') && f.endsWith('.json'));
const pricing: { model: number; actual: number }[] = [];
const absErrs: number[] = [];

for (const f of sviFiles) {
  const safe = f.slice(4, -5); // strip 'svi_' and '.json'
  const oid = '0x' + safe;
  let svi: SviEv[];
  let px: PriceEv[];
  try {
    svi = (read<SviEv[]>(`svi_${safe}.json`)).sort(asc);
    px = (read<PriceEv[]>(`prices_${safe}.json`)).sort(asc);
  } catch {
    continue;
  }
  for (const m of pmints) {
    if (m.oracle_id !== oid) continue;
    const t = m.checkpoint_timestamp_ms;
    const s = latestAtOrBefore(svi, t);
    const p = latestAtOrBefore(px, t);
    if (!s || !p || !p.forward) continue;
    const { a, b, rho, m: mm, sigma } = decodeSvi(s);
    let fairUp: number;
    try {
      fairUp = upPrice(a, b, rho, mm, sigma, p.forward, num(m.strike));
    } catch {
      continue;
    }
    const fairSide = m.is_up ? fairUp : 1 - fairUp;
    const spread = quoteSpread(fairUp);
    const modeledAsk = Math.min(fairSide + spread, 1);
    const realAsk = num(m.ask_price) / SCALE;
    if (!(realAsk > 0 && realAsk < 1)) continue;
    absErrs.push(Math.abs(modeledAsk - realAsk));
    pricing.push({ model: round(modeledAsk, 5), actual: round(realAsk, 5) });
  }
}

const absSorted = absErrs.sort((a, b) => a - b);
const pricingMedianErr =
  absSorted.length > 0 ? round(absSorted[Math.floor(0.5 * absSorted.length)], 6) : 0;

// Downsample the scatter to a readable cloud while preserving the real spread.
const targetPricing = 600;
const pStep = Math.max(1, Math.floor(pricing.length / targetPricing));
const pricingDown = pricing.filter((_, i) => i % pStep === 0);

const out = {
  summary: {
    houseEdgeBps,
    maxDrawdownPct,
    pricingMedianErr,
    nPositions,
    grossYieldPct,
    netYieldPct,
    feeToDepositorsPct: 90,
    feeToVaultPct: 10,
    windowLabel,
  },
  nav: navD,
  drawdown: ddD,
  feeYield: feeD,
  exposure,
  btc,
  pricing: pricingDown,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2));

// Auditable summary.
console.log('── export-web summary (all numbers from committed data/) ──');
console.log(`btc:        ${btc.length} pts (downsampled from ${btcAll.length} daily closes, btc_1d.json)`);
console.log(`settled oracles with flow (perOracle): ${os.length}`);
console.log(`nav/drawdown/feeYield: ${navD.length} settlement-day points (positions_minted+oracles)`);
console.log(`exposure:   ${exposure.length} settlement-day points (avg payout notional/oracle vs $${EXPOSURE_CAP} cap)`);
console.log(`pricing:    ${pricing.length} model-vs-ask pairs (svi_*/prices_*/positions_minted), downsampled to ${pricingDown.length}`);
console.log('');
console.log(`summary.houseEdgeBps    = ${houseEdgeBps}  (edge ${(100 * edge).toFixed(2)}% = $${totalPnl.toFixed(0)} PnL / $${totalPrem.toFixed(0)} premium)`);
console.log(`summary.maxDrawdownPct  = ${maxDrawdownPct}`);
console.log(`summary.grossYieldPct   = ${grossYieldPct}  netYieldPct = ${netYieldPct}  (net = gross * (1 - ${FEE}))`);
console.log(`summary.nPositions      = ${nPositions}  (positions_redeemed.json)`);
console.log(`summary.pricingMedianErr= ${pricingMedianErr}  (median |modeled ask - real ask| over ${absErrs.length} mints)`);
console.log(`summary.windowLabel     = "${windowLabel}"`);
console.log('');
console.log(`wrote ${OUT}`);
