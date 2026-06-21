<h1 align="center">Tethra</h1>

<p align="center">
  <b>Trustless, one-deposit liquidity vaults on DeepBook. Earn, lend, and borrow on Sui, fully on-chain.</b>
</p>

> Deposit dUSDC once into a trustless on-chain vault and Tethra puts it to work on DeepBook: underwriting prediction-market liquidity, lending to margin traders, or, with your vault shares as collateral, borrowing against them. No operator, no custody, a profit-only fee.

Tethra is a set of trustless, one-deposit liquidity vaults built on [DeepBook](https://github.com/MystenLabs/deepbookv3), Sui's on-chain central-limit-order-book DEX. Each vault is a Move smart contract that takes a single dUSDC deposit, mints you a share coin, and supplies that liquidity to a DeepBook venue on your behalf. Everything is on-chain with no trusted operator, and the positioning is deliberately honest and evidence-based rather than a high-yield promise.

There are three products, and they compose:

- **Tier 1, the Predict PLP vault.** Supplies risk-managed PLP (pool-liquidity-provider) liquidity that underwrites BTC binary positions and vertical ranges on DeepBook Predict, and auto-compounds. Exposure is bounded by Predict's protocol-level cap; a keeper redeems settled positions. Depositors earn net-of-fee yield; the vault takes a 10% performance fee on profit only.
- **Tier 2, the Margin lending vault.** Supplies SUI or DBUSDC (DeepBook Margin's stablecoin, distinct from the Predict dUSDC) to DeepBook Margin lending pools and earns variable yield paid by margin traders. The same trustless wrapper as Tier 1 (shares, deposit cap, 10% profit-only fee, no management fee), a real money-market yield, and a captured DeepBook Margin supply-referral fee that is compounded back to depositors.
- **Tier 3, the tPLP/dUSDC borrow market.** An open, isolated lending market (Morpho-Blue style): supply dUSDC to earn, or lock your Tier 1 vault shares (tPLP) as collateral and borrow dUSDC against them. Liquidations are self-redeeming, they redeem the borrower's tPLP back through the Tier 1 vault, so no oracle and no external liquidity are needed.

This repository is the working testnet build, deployed and initialized on **Sui testnet**, submitted for **Sui Overflow 2026 (DeepBook Predict track)**.

---

## Table of Contents

- [What Tethra Does](#what-tethra-does)
- [Why It Exists](#why-it-exists)
- [How It Works](#how-it-works)
  - [Tier 1: The Predict PLP Vault](#tier-1-the-predict-plp-vault)
  - [Tier 2: The Margin Lending Vault](#tier-2-the-margin-lending-vault)
  - [Tier 3: The tPLP Borrow Market](#tier-3-the-tplp-borrow-market)
  - [The Keeper](#the-keeper)
  - [The Strategy Engine](#the-strategy-engine)
  - [The Web App](#the-web-app)
- [Reading the App](#reading-the-app)
- [Deployed Contracts](#deployed-contracts)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [Operational Notes](#operational-notes)
- [For Judges and Reviewers](#for-judges-and-reviewers)

---

## What Tethra Does

Tethra is four parts working as one:

1. **Three on-chain markets (Move).** A Predict PLP vault (`plp_vault`), a Margin lending vault (`tethra_lend`, with separate SUI and DBUSDC vaults), and an isolated tPLP/dUSDC borrow market (`tethra_borrow_market`). Each is a non-custodial contract: you hold a share coin, the contract holds the liquidity, and you redeem at your share price at any time, bounded by on-chain liquidity.

2. **A keeper (TypeScript).** Two always-on bots. The redeem keeper watches DeepBook Predict and clears the vault's settled positions so the vault's net asset value stays current. The liquidation keeper watches the borrow market and liquidates any position past its LTV threshold, using the contract's own health view. Both pay only SUI for gas.

3. **A strategy engine (TypeScript).** A validated SVI options-pricing engine plus reproducible backtests on real historical BTC data. This is the research that justifies the Tier 1 design: it is where the exposure caps, the no-spot-hedge decision, and the economics come from, rather than being asserted.

4. **A web app (Next.js).** A single app and landing page. Connect a Sui wallet to deposit into the Predict vault, lend SUI or DBUSDC on Margin, supply or borrow on the tPLP market, and watch every number read live from the testnet contracts, including a PLP risk dashboard, a live SVI volatility surface, and a per-oracle exposure stress test, all driven by the strategy engine's pricing.

Put together: one dUSDC deposit becomes a share coin in a trustless vault; that liquidity earns on DeepBook; the keeper keeps the on-chain state honest; and the same share coin can itself be used as collateral to borrow. You hold the keys the entire time.

---

## Why It Exists

Providing liquidity on DeepBook Predict is not a passive job. Underwriting these markets (binary positions and vertical ranges) means pricing them, sizing exposure so a bad tail does not wipe you out, supplying and withdrawing PLP liquidity at the right times, and redeeming positions once they settle. Done by hand it is constant, error-prone work, and done naively it is a good way to lose money to the tail.

Tethra wraps that work in a single deposit. You send dUSDC once, the vault supplies risk-managed PLP liquidity (sitting behind Predict's protocol exposure cap), a keeper redeems settled positions for everyone, and your share price reflects the result, net of a fee that is only ever charged on profit. The whole thing is a Move contract with no admin able to touch your principal.

The design is evidence-based, not aspirational. The Tier 1 backtest (in `strategy/`) shows the house edge on these markets is thin and tail-dominated, that spot delta-hedging the binaries is counterproductive, and that the real tail is a rally rather than a crash. So the vault does not promise a fat yield; it controls risk with exposure limits and lets the business scale with trading volume.

Tier 2 was added only after two findings: that DeepBook Margin's supply and withdraw entry points are capability-based, so a shared vault can integrate them trustlessly, and that the strategy research concluded no active prediction strategy beats passive liquidity provision on the current Predict protocol, which is why Tier 2 is a lending vault rather than a betting bot. Tier 3 follows the same instinct: the Tier 1 share coin (tPLP) is a real asset, so it should be usable as collateral. The borrow market makes vault shares composable without an oracle, by liquidating through the vault that issued them.

---

## How It Works

### Tier 1: The Predict PLP Vault

`plp_vault::vault` is the flagship. You call `deposit` with a `Coin<DUSDC>` and receive `Coin<VAULT>` shares, the `tPLP` coin ("Tethra Predict Vault Share"), that track your slice of the pool; you `withdraw` shares for dUSDC at any time. Internally the vault supplies PLP liquidity to a DeepBook Predict pool; PLP redeems at the protocol's mark-to-market vault NAV (vault balance minus open mark-to-market liability). Share accounting uses a virtual-offset to guard against first-deposit share attacks and overflow-safe math so the ledger never silently rounds. A 10% performance fee (admin-set via `set_fee_bps`, hard-capped at 30% in code) is charged on realized profit at withdrawal, never on principal and never without new gains, so 90% of yield stays with depositors. There is no management fee, deposit fee, or lock-up.

### Tier 2: The Margin Lending Vault

`tethra_lend` is two vaults in one package: `lend_vault` (SUI) and `lend_vault_dbusdc` (DBUSDC, DeepBook Margin's stablecoin, distinct from the Predict dUSDC that Tier 1 and Tier 3 use; the two are siloed on testnet). Each takes the matching deposit, mints a share coin (tlSUI / tlDBUSDC), and supplies the asset to a DeepBook Margin lending pool, where it is borrowed by margin traders. Yield is variable and paid by those borrowers, net of the same 10% profit-only performance fee as Tier 1 (admin-set, capped at 30%); there is no management fee. The vault holds a single `SupplierCap` and calls `supply` / `withdraw` inside the user's own transaction, so it is trustless and needs no keeper. The vaults link DeepBook Margin's v1 entry points, which the testnet MarginRegistry accepts. Each vault also mints a DeepBook Margin **supply referral** and routes its deposits through it, reclaiming the 50% referral slice of the pool spread that would otherwise be forfeited to the protocol's default referral; a small keeper periodically claims those fees and compounds them straight back into the vault position (minting no new shares), so the extra yield lifts NAV for every depositor. The capture shows live on `/app/lend`.

### Tier 3: The tPLP Borrow Market

`tethra_borrow_market::market` is an open, isolated money market with a single collateral (tPLP, the Tier 1 share) and a single loan asset (dUSDC). Anyone can `supply` dUSDC and receive `tpUSDC` shares that earn interest; suppliers receive all of the borrow interest. Anyone can lock tPLP and `borrow` dUSDC against it up to a 50% max LTV, valued at the vault cost-basis floor with no oracle. Interest accrues on a kinked utilization curve. Past an 80% LTV threshold a position is liquidatable, and liquidation is **self-redeeming**: the market pulls the borrower's tPLP, redeems it through `plp_vault::vault::withdraw`, repays the debt, keeps a 5% penalty for the protocol, and returns the surplus to the borrower. No swaps, no external liquidity, and no liquidator capital are required. Because the redemption routes through Predict, a liquidation depends on the Predict vault's available coverage and can revert if the house is at its max-payout limit.

### The Keeper

`keeper/` is a small TypeScript service (Node + tsx, `@mysten/sui`). Two loops:

- **Redeem keeper** (`keeper.ts`): reads the public DeepBook Predict indexer for the vault's settled positions and calls `redeem_permissionless`, clearing winners and losers so the vault NAV is current. This has run real redeem transactions against the live testnet vault.
- **Liquidation keeper** (`liquidator.ts`): enumerates open borrow-market positions, asks the contract's `health_bps` view for each borrower's live LTV (the same figure `liquidate` re-checks on chain), and liquidates anyone at or past the threshold. The 5% penalty accrues to the market's fee treasury, so it is run from that address.

`keeper/src/` also holds the publish/initialize scripts used to deploy each package, and round-trip scripts that exercise deposit and withdraw end to end.

### The Strategy Engine

`strategy/` is the off-chain research, in TypeScript. It contains a validated SVI volatility-surface pricing engine (`src/svi/`) matched against the protocol's real on-chain `ask` to a median error of 1e-5, plus a suite of reproducible simulations in `src/sim/`: the BTC backtest, the economics model, the spot-hedge analysis that killed delta-hedging, exposure overlays, a stress test, the Tier 2 active-strategy research, the leveraged-PLP loop economics, and the borrow-market liquidation-safety backtest. These are not decorative; the vault's risk parameters come from them, and `export-web.ts` feeds the app's risk dashboard. The same SVI engine also powers two live, on-chain-data views: a volatility-surface viewer (`/app/surface`) that renders the Predict oracles' implied-vol smiles with butterfly and calendar no-arbitrage checks, and an exposure dashboard (`/app/exposure`) that breaks the pool's per-oracle liability down (reconciled against the on-chain vault summary) and stress-tests it against a BTC move repriced through the live surface.

### The Web App

`web/` is a Next.js 16 app (React 19, `@mysten/dapp-kit` + `@mysten/sui`) for both the landing page and the dApp at `/app`:

- **Overview** at `/app`, with the live PLP pool NAV chart and your position.
- **Provide PLP liquidity** at `/app/deposit` (the Tier 1 Predict vault).
- **Lend on Margin** at `/app/lend` (the Tier 2 SUI / DBUSDC vaults, with a toggle and a live referral-capture readout).
- **Supply dUSDC** at `/app/supply` and **Borrow against tPLP** at `/app/borrow` (the two sides of the Tier 3 market).
- **Vol Surface** at `/app/surface` (the live SVI volatility smiles from the Predict oracles, with no-arbitrage checks) and **Exposure** at `/app/exposure` (per-oracle PLP exposure with an SVI-driven BTC-move stress test).
- **Portfolio**, **Analytics**, a **PLP Risk** what-if dashboard, and an **Activity** feed.

Every figure is read live from the testnet contracts; addresses live in `web/lib/config.ts` and `web/lib/borrow.ts`.

---

## Reading the App

Every number is read live from the testnet contracts and indexer, except charts marked **backtest** (a historical simulation in `strategy/`). What each page's key figures mean:

- **Overview** (`/app`) — **Principal**: total dUSDC deposited across all users (the pool's cost basis). **Total shares**: all tPLP outstanding. **Performance fee**: 10%, on profit only (90% stays with depositors). **PLP pool NAV** chart with "% since inception". **Your shares / Share of vault**: your holding and ownership %.
- **Provide PLP liquidity** (`/app/deposit`) — the "You receive" previews are live on-chain dry-runs; the withdraw preview is already **net of the 10% profit fee**.
- **Lend on Margin** (`/app/lend`) — **Utilization** (borrowed ÷ supplied), **Est. supply APY** (variable, paid by borrowers), **Total supplied/borrowed** (the DeepBook pool). **Referral capture / Captured (accruing)**: the 50% referral slice Tethra reclaims from DeepBook and compounds back to depositors — bonus yield, not a charge.
- **Supply dUSDC** (`/app/supply`) — **Est. supply APY** (suppliers earn 100% of the borrow interest), **Idle reserve** (withdrawable now), **tpUSDC held / Redeemable / Share of pool**.
- **Borrow against tPLP** (`/app/borrow`) — **Max LTV 50% / liquidation 80%**, **Est. borrow APR**, **Available to borrow**. **Projected vs Current LTV** and a **Status** (Healthy → Caution → At risk → Liquidatable). Collateral is valued at the cost-basis floor, no oracle.
- **Portfolio** (`/app/portfolio`) — **Cost-basis principal** (what you put in, fixed) vs **Current redeemable, live** (what you'd get now, net of fee); **Unrealized** is the difference (your P&L).
- **Analytics** (`/app/analytics`) — **backtest**, except the live BTC chart: **House edge** (bps), **Max drawdown**, **Net yield** (after the 10% fee), **Pricing match** (SVI vs on-chain ask, ~1e-5), plus NAV, drawdown, fee-accrual, exposure-vs-cap, and pricing-accuracy charts.
- **Vol Surface** (`/app/surface`) — **BTC forward**, **Live markets**, **Front ATM vol**, **Front skew**; the smile chart is implied vol vs strike per expiry, with **Butterfly / Calendar** no-arbitrage checks on the live surface.
- **PLP Risk** (`/app/risk`) — **Max-payout utilization** is the key safety gauge (worst-case payout ÷ pool); **coverage "Nx"**; a what-if slider for an adverse settlement.
- **Exposure** (`/app/exposure`) — **Max-payout exposure** (house worst-case, reconciled to chain), **Top concentration**, per-oracle bars, and a **BTC-move stress test** (liability Δ, PLP impact, positions crossing strike).
- **Activity** (`/app/activity`) — deposit/withdraw transactions with explorer links and status.

**Easy to misread:** "principal / cost-basis" is fixed, "redeemable / unrealized" is live; Analytics is a backtest, not a forward return; collateral and principal use a conservative cost-basis floor, not mark-to-market; the 10% fee is profit-only (no profit, no fee); the referral capture is bonus yield, not a charge; APY/APR are variable; supplying to the borrow market is fee-free.

---

## Deployed Contracts

All objects are live on **Sui testnet** (chain id `4c78adac`). Explorer: https://suiscan.xyz/testnet

### Tier 1, Predict PLP vault (`plp_vault`)

| Object | ID |
| ------ | -- |
| Package | `0x2765b4a30258ef4660ec7d24fef8b0b32a700633c6dc1a57a80f988de6bc1d9e` |
| Vault (shared) | `0x21528665ba5731f9ffa2a7fe3024f87b77b86660a615118e2e3d1d150299aeb0` |
| tPLP share type | `<package>::vault::VAULT` |

### Tier 2, Margin lending vault (`tethra_lend`, referral-enabled)

| Object | ID |
| ------ | -- |
| Package | `0xc61b07b4d84e93be8d8c033f8a52c35d594bbeb486f832d67744d0b83a357d6d` |
| SUI vault (shared) | `0xea490c338eb9709147b913fdcdf44c1b928f79c01419f8fbc50f9254e71e3cd8` |
| DBUSDC vault (shared) | `0xfa7a4c5653ea73c48b2d6376cd660e67a995b7e12a5e419e4ae0fafd9455ea4f` |
| SUI / DBUSDC margin pools | `0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea` / `0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d` |
| supply referrals (SUI / DBUSDC) | `0xc4f4e9991dd61539a78dc17a76da86a3cdd35195ca6508736b7f0ebc8ceb0203` / `0xe229d2ca1819d6039d0e191f05865f4751d2220a66b1e6f72365e5cecbd84955` |
| share types | `<package>::lend_vault::LEND_VAULT`, `<package>::lend_vault_dbusdc::LEND_VAULT_DBUSDC` |

The superseded pre-referral deployment (`lendVaultV2`, package `0x26710678…`) is kept in [`deployments/testnet.json`](deployments/testnet.json) for history.

### Tier 3, tPLP/dUSDC borrow market (`tethra_borrow_market`)

| Object | ID |
| ------ | -- |
| Package | `0x2bfa7a256d2dcb170e8d63d211b822874aa701599615afd5ec94c2338b6cfddd` |
| Market (shared) | `0x06f2e438b20f78795eaccedbed96dbd41aeae8bec0feb8e6f6be4def95656145` |
| tpUSDC supplier-share type | `<package>::market::MARKET` |

### Linked DeepBook protocol (testnet)

| Thing | ID |
| ----- | -- |
| DeepBook Predict package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| DeepBook Predict object | `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a` |
| dUSDC (Predict) type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| DeepBook package | `0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982` |
| Margin registry | `0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75` |
| DBUSDC (margin) type | `0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC` |

The full record, including admin caps, upgrade caps, and publish digests, is in [`deployments/testnet.json`](deployments/testnet.json).

---

## Project Structure

```
tethra/  (plp-ladder-vault)
├── contracts/                          Move packages (edition 2024 / 2024.beta)
│   ├── vault/                          plp_vault: Tier 1 Predict PLP vault
│   │   └── sources/vault.move
│   ├── lend/                           tethra_lend: Tier 2 Margin lending
│   │   └── sources/lend_vault.move, lend_vault_dbusdc.move
│   └── borrow_market/                  tethra_borrow_market: Tier 3 isolated market
│       └── sources/market.move
│
├── keeper/                             typescript service (node + tsx, @mysten/sui)
│   └── src/
│       ├── keeper.ts / redeem.ts       redeem keeper (Predict settled positions)
│       ├── liquidator.ts               borrow-market liquidation keeper
│       ├── indexer.ts                  DeepBook Predict indexer reader
│       ├── *_publish.ts / *_init.ts    publish + initialize deploy scripts
│       └── roundtrip.ts / lend_roundtrip.ts   deposit/withdraw round-trips
│
├── strategy/                           off-chain research (typescript)
│   └── src/
│       ├── svi/                        validated SVI pricing engine
│       └── sim/                        backtest, econ, hedge, overlays, stress,
│                                       leveraged_plp, liquidation_safety, active, ...
│
├── web/                               next.js 16 app + landing
│   ├── app/app/                       overview, deposit, lend, supply, borrow,
│   │                                  portfolio, analytics, risk, activity
│   ├── components/                    app UI, landing sections
│   └── lib/                           config, borrow, lend, vault, tx, plp-risk, ...
│
├── deployments/testnet.json           the canonical address record
└── data/                              testnet datasets and BTC price history
```

---

## Quick Start

You need the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install), Node 20+, and npm. The TypeScript folders (`keeper/`, `strategy/`, `web/`) are independent npm projects. Signing transactions needs SUI for gas; exercising the vaults additionally needs testnet dUSDC from the DeepBook faucet.

```bash
git clone https://github.com/HoomanBuilds/tethra && cd tethra

# 1. contracts (already deployed; build/test locally)
cd contracts/vault && sui move test          # and likewise in ../lend, ../borrow_market

# 2. keeper (needs KEEPER_KEY for live runs; SUI gas only)
cd ../../keeper && npm install
npm run dry                                   # redeem keeper, read-only preview
KEEPER_KEY=<suiprivkey...> npm run start      # redeem keeper, live loop
KEEPER_KEY=<suiprivkey...> npm run liquidator # borrow-market liquidation keeper

# 3. strategy (reproduce the research)
cd ../strategy && npm install
npm run backtest                              # passive PLP house PnL on real BTC flow
npm run verify                                # risk-adjusted, out-of-sample
npm run stress                                # BTC crash-regime stress test
npm run econ                                  # fee economics and yield scaling

# 4. web app
cd ../web && npm install && npm run dev        # http://localhost:3000
```

### Environment Variables

The keeper reads its signer and endpoints from the environment (see `keeper/src/config.ts` for defaults):

```
KEEPER_KEY=<suiprivkey1... ; the signing key, never committed>
RPC_URL=https://fullnode.testnet.sui.io:443   # default
POLL_MS=60000                                  # poll interval
```

The web app bakes the testnet addresses at build time (`web/lib/config.ts`, `web/lib/borrow.ts`), so it needs no env to read live state. To host it, deploy `web/` to Vercel with the project Root Directory set to `web` (see `web/vercel.json`).

---

## Tech Stack

| Layer | Tools |
| ----- | ----- |
| Smart contracts | Move (edition 2024 / 2024.beta), Sui, DeepBook v3 (Predict + Margin) |
| Vaults | non-custodial share coins, virtual-offset share math, cost-basis-floor valuation |
| Borrow market | isolated single-collateral market, kinked interest curve, self-redeeming liquidation, no oracle |
| Keeper | TypeScript, Node.js, tsx, `@mysten/sui` |
| Strategy / research | TypeScript, validated SVI pricing, reproducible BTC backtests |
| Frontend | Next.js 16, React 19, `@mysten/dapp-kit` 0.16 + `@mysten/sui` 1.x, ECharts |
| Network | Sui testnet |

---

## Operational Notes

A few honest notes about the live state, learned by running it end to end:

- **Testnet dUSDC is the gate.** The contracts are deployed and initialized, but exercising them needs testnet dUSDC from the DeepBook Predict (Tally) faucet. The Predict vault deposit/withdraw round-trip is pending those tokens; the borrow market is live but unseeded, so supplying needs dUSDC and borrowing additionally needs the Predict vault to hold deposits (so tPLP has collateral value).
- **The redeem keeper is proven.** It has cleared real settled positions on the live testnet vault. It needs only SUI for gas.
- **Liquidation is protocol-run.** The 5% liquidation penalty goes to the market fee treasury, not the caller, so third parties have no incentive to liquidate. Run the liquidation keeper from the fee-treasury address.
- **Keep the keeper funded.** Both keeper loops stop if their address runs out of SUI.
- **Pin the SDK.** `web/` is on `@mysten/sui` v1 and `dapp-kit` 0.16 on purpose; the v2 SDK breaks the keeper and dApp patterns used here.

---

## For Judges and Reviewers

### Network

| Field | Value |
| ----- | ----- |
| Network | Sui testnet |
| Chain ID | `4c78adac` |
| RPC | `https://fullnode.testnet.sui.io:443` |
| Explorer | `https://suiscan.xyz/testnet` |
| Gas token | SUI |

### What to Look For

1. **Three live, trustless markets.** Open the shared objects on the explorer: the Predict vault `0x21528665...`, the Margin vaults, and the borrow market `0x06f2e438...`. Each is a shared Move object with no admin authority over user principal.
2. **A keeper doing real work.** The redeem keeper has submitted real `redeem_permissionless` transactions against the live vault; the liquidation keeper reads each borrower's on-chain `health_bps` before acting.
3. **Composability without an oracle.** The borrow market values tPLP at the vault cost-basis floor and liquidates by redeeming through the vault that issued it. No price feed, no external liquidity.
4. **Honesty over yield.** The Tier 1 risk parameters come from the backtests in `strategy/`, not from a marketing number. The fee is charged only on realized profit (10%, capped at 30% in code), and the SVI pricing is validated against on-chain `ask` to a 1e-5 median error.
5. **The track's idea bank, live on-chain.** `/app/surface` renders the Predict oracles' SVI volatility surface with butterfly and calendar no-arbitrage checks (idea #9); `/app/exposure` breaks the pool's per-oracle liability down and stress-tests it through that surface (idea #10). Tier 2 additionally captures the DeepBook Margin supply-referral fee and compounds it to depositors.

### The One-Line Story

Deposit dUSDC once into a trustless Move vault, earn on DeepBook Predict or Margin, then use the very shares you hold as collateral to borrow, all on-chain, with a keeper that keeps the books honest and a backtest that keeps the risk honest.
