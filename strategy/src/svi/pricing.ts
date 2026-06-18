// SVI binary pricing — exact replica of deepbook_predict::oracle::compute_nd2
// and pricing_config::quote_spread_from_fair_price (verified vs source,
// branch predict-testnet-4-16).
//
// On-chain values use FLOAT_SCALING = 1e9 for prices/percentages.
// SVI params: a,b,sigma unsigned; rho,m signed (raw event carries *_negative).

export const SCALE = 1_000_000_000; // FLOAT_SCALING (1e9)

// pricing-config defaults (constants.move)
export const BASE_SPREAD = 0.02; // default_base_spread 20_000_000
export const MIN_SPREAD = 0.005; // default_min_spread 5_000_000
export const UTIL_MULT = 2.0; // default_utilization_multiplier 2_000_000_000
export const MIN_ASK = 0.01; // default_min_ask_price 10_000_000
export const MAX_ASK = 0.99; // default_max_ask_price 990_000_000

// Abramowitz & Stegun 7.1.26 erf (max abs error 1.5e-7).
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const y = 1 - poly * Math.exp(-ax * ax);
  return sign * y;
}

// Standard normal CDF Φ(x); matches Move normal_cdf to ~1e-7.
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// Standard normal pdf φ(x) — used for digital-option delta.
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// SVI total implied variance w(k); k = ln(strike/forward).
export function totalVariance(a: number, b: number, rho: number, m: number, sigma: number, k: number): number {
  return a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sigma ** 2));
}

// Fair UP (cash-or-nothing digital call) price = N(d2), in [0,1].
// Mirrors compute_nd2: k = ln(strike/forward); w = SVI(k);
// d2 = -((k + w/2)/sqrt(w)); return N(d2).
export function upPrice(
  a: number,
  b: number,
  rho: number,
  m: number,
  sigma: number,
  forward: number,
  strike: number,
): number {
  if (forward <= 0 || strike <= 0) throw new Error('forward and strike must be positive');
  const k = Math.log(strike / forward);
  const w = totalVariance(a, b, rho, m, sigma, k);
  if (w <= 0) throw new Error('non-positive total variance');
  const d2 = -((k + w / 2) / Math.sqrt(w));
  return normCdf(d2);
}

// Digital-call delta dUP/dF (per unit of forward), holding the SVI surface fixed.
// d2 = -(ln(K/F)+w/2)/sqrt(w); dUP/dF = φ(d2) * 1/(F*sqrt(w)).
export function upDelta(
  a: number,
  b: number,
  rho: number,
  m: number,
  sigma: number,
  forward: number,
  strike: number,
): number {
  const k = Math.log(strike / forward);
  const w = totalVariance(a, b, rho, m, sigma, k);
  if (w <= 0) return 0;
  const d2 = -((k + w / 2) / Math.sqrt(w));
  return normPdf(d2) / (forward * Math.sqrt(w));
}

// Per-unit spread; mirrors quote_spread_from_fair_price.
export function quoteSpread(fair: number, liability = 0, balance = 0): number {
  if (!(fair > 0 && fair < 1)) return 0;
  const bernoulli = Math.sqrt(fair * (1 - fair));
  let spread = Math.max(BASE_SPREAD * bernoulli, MIN_SPREAD);
  if (balance > 0 && liability > 0) {
    const util = Math.min(1, liability / balance);
    spread += BASE_SPREAD * UTIL_MULT * util * util;
  }
  return spread;
}

// Post-spread (ask, bid), clamped to [0,1]. Mint also clamps ask to [MIN_ASK, MAX_ASK].
export function askBid(fair: number, liability = 0, balance = 0): [number, number] {
  const s = quoteSpread(fair, liability, balance);
  return [Math.min(fair + s, 1), Math.max(fair - s, 0)];
}

export interface RawSvi {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
  rho_negative?: boolean;
  m_negative?: boolean;
}

// Decode a raw /svi indexer event to floats.
export function decodeSvi(ev: RawSvi): { a: number; b: number; rho: number; m: number; sigma: number } {
  return {
    a: ev.a / SCALE,
    b: ev.b / SCALE,
    sigma: ev.sigma / SCALE,
    rho: ((ev.rho_negative ? -1 : 1) * ev.rho) / SCALE,
    m: ((ev.m_negative ? -1 : 1) * ev.m) / SCALE,
  };
}
