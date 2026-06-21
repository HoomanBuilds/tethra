import raw from "./data/backtest.json";

// Derived series exported from a real run of the strategy backtest over committed
// testnet flow (data/positions_*.json, data/btc_1d.json). Charts that consume this
// must label it as backtest, not live.

export interface Point {
  t: string;
  v: number;
}
export interface ExposurePoint {
  t: string;
  v: number;
  cap: number;
}
export interface PricingPoint {
  model: number;
  actual: number;
}
export interface BacktestSummary {
  houseEdgeBps: number;
  maxDrawdownPct: number;
  pricingMedianErr: number;
  nPositions: number;
  grossYieldPct: number;
  netYieldPct: number;
  feeToDepositorsPct: number;
  feeToVaultPct: number;
  windowLabel: string;
}
export interface Backtest {
  summary: BacktestSummary;
  nav: Point[];
  drawdown: Point[];
  feeYield: Point[];
  exposure: ExposurePoint[];
  btc: Point[];
  pricing: PricingPoint[];
}

const r = raw as Partial<Backtest>;

export const backtest: Backtest = {
  summary: {
    houseEdgeBps: 0,
    maxDrawdownPct: 0,
    pricingMedianErr: 0,
    nPositions: 0,
    grossYieldPct: 0,
    netYieldPct: 0,
    feeToDepositorsPct: 90,
    feeToVaultPct: 10,
    windowLabel: "",
    ...(r.summary ?? {}),
  },
  nav: r.nav ?? [],
  drawdown: r.drawdown ?? [],
  feeYield: r.feeYield ?? [],
  exposure: r.exposure ?? [],
  btc: r.btc ?? [],
  pricing: r.pricing ?? [],
};
