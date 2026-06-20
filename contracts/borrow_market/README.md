# Tethra tPLP/dUSDC isolated lending market

An open, isolated (Morpho-Blue-style) lending market: a single collateral (tPLP)
and a single loan asset (dUSDC).

- **Supply (anyone):** deposit dUSDC, receive `tpUSDC` shares, earn interest.
- **Borrow (anyone):** lock tPLP, borrow dUSDC up to 50% LTV, repay any time.
- **Liquidation (permissionless, self-redeeming):** if a position passes the 80%
  LTV threshold, anyone can liquidate it — the contract redeems the borrower's
  tPLP through the Tethra Predict vault (`plp_vault::vault::withdraw`), repays the
  debt, keeps a 5% penalty, and returns the surplus to the borrower. No swaps, no
  external liquidity, no liquidator capital.

Interest follows a kinked utilization curve (mirroring `deepbook_margin`).
Collateral is valued at the conservative cost-basis floor — no oracle. Suppliers
receive all borrow interest; protocol revenue is the liquidation penalty only.

Design + decisions: `docs/specs/2026-06-20-tplp-collateral-market-design.md`.
Plan: `docs/plans/2026-06-20-tplp-collateral-market-plan.md`.
Safety backtests: `strategy/src/sim/liquidation_safety.ts`, `strategy/src/sim/leveraged_plp.ts`.

Deploy (set `published-at`, publish, `initialize` against the Tethra vault, seed
the reserve) and the `/app/borrow` frontend are separate later phases.
