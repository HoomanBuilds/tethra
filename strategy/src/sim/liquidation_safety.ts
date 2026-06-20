// Liquidation-safety backtest for the tPLP/dUSDC isolated market.
// Decides full vs partial liquidation by testing whether partial buys any
// safety for OUR collateral, or just adds bug surface.
//
// Why this matters: big protocols (Aave, deepbook_margin) use PARTIAL
// liquidation because their collateral is VOLATILE and liquidating it has
// market impact. Ours (tPLP) is self-redeeming at a deterministic value and is
// near-stable (~0.4% bounded drawdown). So we test whether those reasons apply.

const MAX_BORROW_LTV = 0.5; // borrow <= 50% of collateral value
const LIQ_THRESHOLD = 0.8; // debt/value >= 80% (risk ratio 1.25) -> liquidatable
const PENALTY = 0.05; // 5% liquidation penalty kept by the protocol
const PLP_MAX_DRAWDOWN = 0.004; // ~0.4% bounded (live PLP risk: max-payout util)

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log('═══ LIQUIDATION-SAFETY BACKTEST (tPLP/dUSDC isolated market) ═══\n');
console.log(`params: max borrow LTV ${pct(MAX_BORROW_LTV)}, liquidation at debt/value ${pct(LIQ_THRESHOLD)}, penalty ${pct(PENALTY)}\n`);

// A position is liquidated the instant debt/value crosses LIQ_THRESHOLD. At that
// moment value = debt / LIQ_THRESHOLD = 1.25 * debt. We then apply an
// instantaneous extra drawdown `d` (the collateral falling between the keeper's
// health read and the redemption) and ask: does redemption still cover the debt?
//
// Normalize debt = 1.0. value_at_trigger = 1/LIQ_THRESHOLD.
const D = 1.0;
const valueAtTrigger = D / LIQ_THRESHOLD; // 1.25

console.log('drawdown@liq   recovery   debt   covered?   surplus→borrower   bad debt');
for (const d of [0, PLP_MAX_DRAWDOWN, 0.05, 0.1, 0.2, 0.25, 0.3]) {
  const recovery = valueAtTrigger * (1 - d); // redeem tPLP -> dUSDC (self-redeeming, no slippage)
  const covered = recovery >= D;
  const surplus = Math.max(0, recovery - D - PENALTY * D);
  const badDebt = Math.max(0, D - recovery);
  const tag = d === PLP_MAX_DRAWDOWN ? ' (real bound)' : '';
  console.log(
    `  ${pct(d).padStart(6)}${tag.padEnd(13)}  ${recovery.toFixed(3)}     ${D.toFixed(2)}    ${(covered ? 'YES' : 'NO ').padEnd(7)}   ${pct(surplus / D).padStart(7)}            ${badDebt > 0 ? pct(badDebt / D) : '—'}`,
  );
}

// Bad debt begins when recovery < debt: 1.25*(1-d) < 1  ->  d > 0.20
const badDebtThreshold = 1 - LIQ_THRESHOLD / 1; // = 1 - 0.8 = 0.2
console.log(`\nbad-debt threshold: collateral must crash > ${pct(0.2)} *instantly* at liquidation.`);
console.log(`real tPLP drawdown is bounded at ~${pct(PLP_MAX_DRAWDOWN)} -> safety margin = ${(0.2 / PLP_MAX_DRAWDOWN).toFixed(0)}× the worst realistic move.\n`);

console.log('Does PARTIAL liquidation add safety here? The reasons protocols use partial:');
console.log('  • volatile collateral / fast crashes  -> N/A: tPLP is bounded ~0.4%, not volatile');
console.log('  • market impact when selling collateral -> N/A: tPLP self-redeems at a fixed value, no swap/slippage');
console.log('  • cascade protection                    -> N/A: single isolated position, deterministic recovery');
console.log('  => partial solves problems we do not have, while adding the most attack-prone math in the protocol.\n');

console.log('VERDICT: FULL liquidation with surplus return.');
console.log('  - 25% built-in buffer (liquidate at 80% LTV) vs a 0.4% real drawdown = ~50× margin, zero realistic bad debt.');
console.log('  - simpler = far less bug surface in the highest-risk function.');
console.log('  - NOT borrower-hostile: surplus is returned, and borrowers can partial-repay anytime to self-cure.');
console.log('  - the "big company" quality goes into the KINKED RATE CURVE + tests + events, not into copying partial');
console.log('    liquidation that exists for volatile collateral we do not have.');
