// SVI implied-vol surface math, ported from strategy/src/svi/pricing.ts (the
// engine validated against the protocol's on-chain ask to a median ~1e-5).
// On-chain oracle::SVIParams are 1e9-scaled; rho and m are signed i64
// {is_negative, magnitude}. k = ln(strike / forward).

export const SCALE = 1_000_000_000;
export const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// Abramowitz & Stegun 7.1.26 erf, matches the Move normal_cdf to ~1e-7.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

// SVI total implied variance w(k).
export function totalVariance(s: SviParams, k: number): number {
  return s.a + s.b * (s.rho * (k - s.m) + Math.sqrt((k - s.m) ** 2 + s.sigma ** 2));
}

// Fair UP (cash-or-nothing digital call) = N(d2): the protocol's mark, in [0,1].
export function upPrice(s: SviParams, forward: number, strike: number): number {
  if (forward <= 0 || strike <= 0) return 0;
  const k = Math.log(strike / forward);
  const w = totalVariance(s, k);
  if (w <= 0) return 0;
  const d2 = -((k + w / 2) / Math.sqrt(w));
  return normCdf(d2);
}

function i64(field: unknown): number {
  const f = (field as { fields?: { is_negative?: boolean; magnitude?: unknown } })?.fields;
  return (f?.is_negative ? -1 : 1) * Number(f?.magnitude ?? 0);
}

// Decode an on-chain oracle::SVIParams move struct (showContent fields) to floats.
export function decodeSvi(svi: unknown): SviParams {
  const f = (svi as { fields?: Record<string, unknown> })?.fields ?? {};
  return {
    a: Number(f.a) / SCALE,
    b: Number(f.b) / SCALE,
    sigma: Number(f.sigma) / SCALE,
    rho: i64(f.rho) / SCALE,
    m: i64(f.m) / SCALE,
  };
}

export const K_MIN = -0.06;
export const K_MAX = 0.06;
export const K_STEPS = 40;

// A shared strike grid (±10% around a reference spot) so every expiry's smile
// is sampled on the same x-axis and overlays cleanly.
export function strikeGrid(spot: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= K_STEPS; i++) {
    const k = K_MIN + ((K_MAX - K_MIN) * i) / K_STEPS;
    out.push(spot * Math.exp(k));
  }
  return out;
}

export interface SmilePoint {
  strike: number;
  k: number;
  iv: number;
  up: number;
}
export interface OracleSmile {
  oracleId: string;
  expiryMs: number;
  tYears: number;
  forward: number;
  spot: number;
  svi: SviParams;
  atmIv: number;
  atmVar: number;
  skew: number; // iv(-5%) - iv(+5%), in vol fraction (downside richness)
  smile: SmilePoint[];
  butterflyOk: boolean;
}

// Build one expiry's smile across a common strike grid. Flags a butterfly
// (vertical-spread) arbitrage if the UP price is not monotonically
// non-increasing in strike, which a no-arbitrage digital surface must be.
export function buildSmile(
  oracleId: string,
  fields: Record<string, unknown>,
  now: number,
  strikes: number[],
): OracleSmile | null {
  const prices = (fields?.prices as { fields?: { forward?: unknown; spot?: unknown } })?.fields;
  if (!fields?.svi || !prices) return null;
  const svi = decodeSvi(fields.svi);
  const forward = Number(prices.forward) / SCALE;
  const spot = Number(prices.spot) / SCALE;
  const expiryMs = Number(fields.expiry);
  if (!(forward > 0) || !(expiryMs > now)) return null;
  const tYears = (expiryMs - now) / YEAR_MS;

  const ivAt = (k: number) => {
    const w = totalVariance(svi, k);
    return w > 0 ? Math.sqrt(w / tYears) : 0;
  };

  let butterflyOk = true;
  let prevUp = Infinity;
  const smile: SmilePoint[] = strikes.map((strike) => {
    const k = Math.log(strike / forward);
    const up = upPrice(svi, forward, strike);
    if (up > prevUp + 1e-6) butterflyOk = false;
    prevUp = up;
    return { strike, k, iv: ivAt(k), up };
  });

  return {
    oracleId,
    expiryMs,
    tYears,
    forward,
    spot,
    svi,
    atmIv: ivAt(0),
    atmVar: totalVariance(svi, 0),
    skew: ivAt(-0.05) - ivAt(0.05),
    smile,
    butterflyOk,
  };
}
