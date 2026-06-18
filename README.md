# PLP Vault — DeepBook Predict (Sui Overflow 2026)

A trustless, fee-earning, **risk-managed PLP vault** on DeepBook Predict. One deposit: the vault supplies PLP liquidity to underwrite BTC binary markets, auto-compounds, caps exposure to limit drawdown, and a keeper redeems settled positions. Depositors earn net-of-fee yield; the vault takes a high-water-marked performance fee.

Positioning is honest and evidence-based: this is the safe, automated way to provide PLP and a cold-start solution for the protocol — **not** a high-yield alpha fund. The backtest shows the house edge is thin and tail-dominated, spot delta-hedging of binaries is counterproductive, and the real tail is a rally (not a crash); risk is controlled by exposure limits, and the business scales with trading volume.

## Layout

- `docs/` — plan, verification report, strategy/economics spec, backtest results (local)
- `strategy/` — TypeScript: validated SVI pricing engine + backtests, risk overlays, hedge sim, economics, stress test
- `packages/vault/` — Move vault contract (deposit/withdraw + shares; fee/caps in progress)
- `keeper/`, `frontend/` — redeem keeper and risk terminal (planned)

## Reproduce the analysis

```
cd strategy
npm install
npm run backtest    # passive PLP house PnL on real testnet flow
npm run verify      # risk-adjusted verification (bootstrap, out-of-sample)
npm run stress      # BTC crash-regime stress test
npm run econ        # fee economics and yield scaling
```

Base datasets are committed under `data/`. Per-oracle SVI/price histories (for `validate` and `hedge`) are pulled from the testnet indexer and are gitignored.

## Vault contract

```
cd packages/vault
sui move test
```

Pricing engine is validated against real on-chain `ask` to a median error of 1e-5 (`strategy/src/svi/validate.ts`).
