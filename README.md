# Tethra: trustless DeepBook vaults on Sui (Sui Overflow 2026)

**Tethra** is a set of trustless, fee-earning, one-deposit vaults on DeepBook. Everything is fully on-chain with no trusted operator, and the positioning is honest and evidence-based rather than a high-yield promise.

- **Tier 1, Predict PLP vault.** Supplies risk-managed PLP liquidity to underwrite BTC binary markets on DeepBook Predict, auto-compounds, caps exposure to limit drawdown, and a keeper redeems settled positions. Depositors earn net-of-fee yield; the vault takes a profit-only performance fee.
- **Tier 2, Margin lending vault.** Supplies SUI or dUSDC to DeepBook Margin lending pools and earns borrow interest plus liquidation rewards, paid by margin traders. Same trustless wrapper (shares, profit-only fee, deposit cap), a real money-market yield, and no keeper needed.

The backtest behind Tier 1 shows the house edge is thin and tail-dominated, spot delta-hedging of binaries is counterproductive, and the real tail is a rally rather than a crash; risk is controlled by exposure limits, and the business scales with trading volume. Tier 2 was added only after verifying on-chain that DeepBook Margin's supply and withdraw are capability-based, so a shared vault can integrate them trustlessly, and after research showed an active prediction strategy is not realizable on the current Predict protocol.

## Structure

- `contracts/vault/`: Tier 1 Move vault (deposit/withdraw, shares, profit-only fee, exposure cap), deployed to testnet
- `contracts/lend/`: Tier 2 margin-lending vaults on DeepBook Margin, SUI (`lend_vault`) and dUSDC (`lend_vault_dbusdc`), deployed to testnet
- `strategy/`: TypeScript validated SVI pricing engine, backtests, risk overlays, economics, stress test, and the Tier 2 active-strategy research
- `web/`: Tethra app and landing (Next.js, npm) with wallet connect, the Predict vault, and the lending vault with a SUI / dUSDC toggle
- `keeper/`: redeem keeper bot (live on testnet) plus deposit/withdraw round-trip scripts
- `data/`: testnet datasets and BTC price history

Each Move package pulls its DeepBook dependency via git (no vendored source). Tier 1 links DeepBook Predict; Tier 2 links DeepBook Margin.

## Contracts

```
cd contracts/vault && sui move test    # Tier 1 (Predict PLP vault)
cd contracts/lend  && sui move test    # Tier 2 (lending vaults)
```

Deployed on Sui testnet (`deployments/testnet.json`):

- **Tier 1 Predict vault:** package `0x2765b4a3…`, shared Vault `0x21528665…`, share coin `tPLP` ("Tethra Predict Vault Share"), linking live DeepBook Predict (`0xf5ea…5138`). The deposit/withdraw round-trip script lives in `keeper/`.
- **Tier 2 SUI lending vault:** shared vault `0x66fbffc2…`, supplying the live DeepBook Margin SUI pool. A deposit dry-run through the vault succeeds on testnet.
- **Tier 2 dUSDC lending vault:** shared vault `0xccc2def2…` (package `0x267106…`), supplying the live DeepBook Margin dUSDC pool.

Both Tier 2 vaults link to the DeepBook Margin v1 package, because the protocol's latest testnet version is currently version-disabled. The vault holds a single `SupplierCap` and calls `supply`/`withdraw` inside the user's own transaction, so it is trustless and keeperless.

## Reproduce the analysis

```
cd strategy
npm install
npm run backtest    # passive PLP house PnL on real testnet flow
npm run verify      # risk-adjusted verification (bootstrap, out-of-sample)
npm run stress      # BTC crash-regime stress test
npm run econ        # fee economics and yield scaling
```

Base datasets are committed under `data/`. Per-oracle SVI and price histories are pulled from the testnet indexer and are gitignored. The pricing engine is validated against real on-chain `ask` to a median error of 1e-5. The Tier 2 active-strategy research (timing and position-level backtests, plus the literature scan) concluded that no active strategy beats passive on the current Predict protocol, which is why Tier 2 is a lending vault rather than a betting strategy.
