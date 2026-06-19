# Tethra — DeepBook Predict liquidity vault (Sui Overflow 2026)

**Tethra** is a trustless, fee-earning, **risk-managed PLP vault** on DeepBook Predict. One deposit: the vault supplies PLP liquidity to underwrite BTC binary markets, auto-compounds, caps exposure to limit drawdown, and a keeper redeems settled positions. Depositors earn net-of-fee yield; the vault takes a high-water-marked performance fee.

Positioning is honest and evidence-based: this is the safe, automated way to provide PLP and a cold-start solution for the protocol — **not** a high-yield alpha fund. The backtest shows the house edge is thin and tail-dominated, spot delta-hedging of binaries is counterproductive, and the real tail is a rally (not a crash); risk is controlled by exposure limits, and the business scales with trading volume.

## Structure

- `contracts/vault/` — Tier 1 Move vault package (deposit/withdraw, shares, performance fee, exposure cap), deployed to testnet
- `contracts/lend/` — Tier 2 margin-lending vault package on DeepBook Margin (SUI)
- `strategy/` — TypeScript: validated SVI pricing engine, backtests, risk overlays, hedge sim, economics, stress test
- `web/` — Tethra landing site (Next.js, npm)
- `keeper/` — redeem keeper bot (live on testnet)
- `data/` — testnet datasets + BTC price history

The Move contract pulls DeepBook Predict via a git dependency (no vendored source).

## Contract

```
cd contracts/vault
sui move test
```

**Deployed on Sui testnet** (`deployments/testnet.json`): package `0xc5af7e1c3bf297aa38acc3804b3935cdb440e8955c4eb3d4ec153c21b4890db8`, shared `Vault` `0x5ed0b38cd386fd9e7503dc4bea482087e24c3e86c0599baa196b6be0fecf9f86`, linking the live DeepBook Predict protocol (`0xf5ea…5138`). Deposit/withdraw round-trip pending DUSDC test tokens.

## Reproduce the analysis

```
cd strategy
npm install
npm run backtest    # passive PLP house PnL on real testnet flow
npm run verify      # risk-adjusted verification (bootstrap, out-of-sample)
npm run stress      # BTC crash-regime stress test
npm run econ        # fee economics and yield scaling
```

Base datasets are committed under `data/`. Per-oracle SVI/price histories (for `validate` and `hedge`) are pulled from the testnet indexer and are gitignored. Pricing engine is validated against real on-chain `ask` to a median error of 1e-5.
