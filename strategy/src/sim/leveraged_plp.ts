// Leveraged-PLP loop simulation (P3 "plan B" feasibility).
// Strategy: deposit collateral -> borrow dUSDC on deepbook_margin -> supply to
// Predict PLP -> repay from PLP redemptions. This models whether the carry pays.
//
// Inputs are measured, not assumed:
//  - r_plp: PLP pool annualized yield, from live /lp/supplies share-price growth
//           (1.000000 -> 1.002040 over 60.4d, measured 2026-06-20).
//  - margin interest model: on-chain ProtocolConfig of the dUSDC MarginPool
//           0xf08568 (deepbook_margin v1 0xb8620c), scaled 1e9.

const R_PLP = 0.0124; // 1.24%/yr, measured (PLP util ~0.15%, flow-limited)

const MARGIN = {
  baseRate: 45_000_000 / 1e9, //  4.5%
  baseSlope: 80_000_000 / 1e9, //  8.0%
  excessSlope: 4_500_000_000 / 1e9, // 450%
  optimalUtil: 900_000_000 / 1e9, // 90%
};

const MAX_PLP_DRAWDOWN = 0.004; // ~0.4% worst-case (max-payout util, live PLP risk)

function borrowRate(util: number): number {
  const { baseRate, baseSlope, excessSlope, optimalUtil } = MARGIN;
  if (util <= optimalUtil) return baseRate + baseSlope * (util / optimalUtil);
  return baseRate + baseSlope + excessSlope * ((util - optimalUtil) / (1 - optimalUtil));
}

// Net APY on equity from levering PLP: r_plp + (k-1)*(r_plp - r_borrow).
function netApy(k: number, rBorrow: number): number {
  return R_PLP + (k - 1) * (R_PLP - rBorrow);
}

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log('═══ LEVERAGED-PLP LOOP — carry simulation (P3 plan B) ═══\n');
console.log(`measured PLP yield  r_plp = ${pct(R_PLP)}/yr  (Predict util ~0.15%, flow-limited)`);
console.log('margin borrow rate by post-borrow utilization (kinked model, on-chain):');
for (const u of [0.01, 0.1, 0.5, 0.9]) {
  console.log(`  util ${String(100 * u).padStart(3)}%  ->  borrow ${pct(borrowRate(u))}/yr`);
}

console.log('\nnet APY on equity vs leverage (carry = r_plp - r_borrow):');
console.log('  borrowRate    1.5×        2×        3×        5×');
for (const u of [0.05, 0.5, 0.9]) {
  const rb = borrowRate(u);
  const row = [1.5, 2, 3, 5].map((k) => pct(netApy(k, rb)).padStart(8)).join('  ');
  console.log(`  ${pct(rb).padStart(7)} (u${String(100 * u).padStart(2)}%)  ${row}`);
}

const rbLow = borrowRate(0.05);
console.log(`\nbreakeven: leverage pays only if r_plp > r_borrow.`);
console.log(`  lowest borrow rate = ${pct(rbLow)}/yr  -> PLP yield must rise ${(rbLow / R_PLP).toFixed(1)}× (to ${pct(rbLow)}) just to break even.`);
console.log(`  current PLP yield  = ${pct(R_PLP)}/yr  -> every extra turn of leverage LOSES ${pct(rbLow - R_PLP)}/yr.`);

console.log('\nliquidation: PLP drawdown is contract-bounded.');
console.log(`  worst-case PLP drawdown ~${pct(MAX_PLP_DRAWDOWN)}; at 5× that is a ${pct(5 * MAX_PLP_DRAWDOWN)} equity hit — not a wipeout.`);
console.log('  so the risk is NOT a liquidation cascade; it is steady negative carry bleeding equity.');

console.log('\nVERDICT: at current testnet rates the loop is negative-carry and leverage amplifies the loss.');
console.log('It only makes sense if Predict utilization rises enough that r_plp > the margin borrow rate.');
console.log('Plus two on-chain blockers on testnet:');
console.log('  1) mint/mint_range are owner-gated -> a trustless vault cannot deploy into Predict RANGES (idea #4 literal).');
console.log('  2) the deepbook_margin USD pool lends DBUSDC (0xf7152c), NOT Predict dUSDC (0xe95040) -> nothing to borrow for the supply leg.');
console.log('Conclusion: do not build P3 now; ship the clean PLP submission. Revisit on mainnet with matching assets + real utilization.');
