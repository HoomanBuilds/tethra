# Tier 2 Feasibility Spike Report

## Status: DONE - Build Green

`sui move build` exits 0. All deepbook_margin types resolve and link correctly.

## Build Output

```
INCLUDING DEPENDENCY MoveStdlib
INCLUDING DEPENDENCY Pyth
INCLUDING DEPENDENCY Sui
INCLUDING DEPENDENCY Wormhole
INCLUDING DEPENDENCY deepbook
INCLUDING DEPENDENCY deepbook_margin
INCLUDING DEPENDENCY token
BUILDING tethra_lend
```

## Package Location

`contracts/lend/` at repo root.

## Working Move.toml

```toml
[package]
name = "tethra_lend"
edition = "2024"
version = "0.0.1"

[dependencies]
deepbook_margin = { git = "https://github.com/MystenLabs/deepbookv3.git", subdir = "packages/deepbook_margin", rev = "daa5a9514908968f11be1d0388f673e0ee1a5059" }
deepbook = { git = "https://github.com/MystenLabs/deepbookv3.git", subdir = "packages/deepbook", rev = "daa5a9514908968f11be1d0388f673e0ee1a5059" }
token = { git = "https://github.com/MystenLabs/deepbookv3.git", subdir = "packages/token", rev = "190ab8fd15bca03b20965ab2a7b6911fcdf2bf1f", override = true }
Pyth = { git = "https://github.com/pyth-network/pyth-crosschain.git", subdir = "target_chains/sui/contracts", rev = "3bd1262dcba9518a6901aa6a15f04072799bfb37" }
Wormhole = { git = "https://github.com/wormhole-foundation/wormhole.git", subdir = "sui/wormhole", rev = "b71be5cbb9537c4aac8e23e74371affa3825efcd" }

[addresses]
tethra_lend = "0x0"
```

## Chosen Rev

`daa5a9514908968f11be1d0388f673e0ee1a5059` (deepbookv3 main HEAD at spike time, 2026-06-19)

## Dependency Resolution Notes

The main friction was a diamond conflict on the `token` package. `deepbook_margin` pins token at rev `190ab8fd15bca03b20965ab2a7b6911fcdf2bf1f` and `deepbook` (at the same monorepo HEAD) resolved token at a slightly different rev `5e82e2dd1ea7d47957855ddc66f835585d6fe091`. Both produce identical bytecode (same manifest digest `5745706258F61D6CE210904B3E6AE87A73CE9D31A6F93BE4718C442529332A87`). Resolved by using `override = true` on the token dependency pinned to the deepbook_margin rev.

Pyth and Wormhole resolved cleanly once the exact SHAs from `deepbook_margin`'s checked-in Move.lock were used:
- Pyth: `3bd1262dcba9518a6901aa6a15f04072799bfb37`
- Wormhole: `b71be5cbb9537c4aac8e23e74371affa3825efcd`

## API Map Summary

See `docs/research/margin-api-map.md` for verbatim signatures. Key findings:

### All Needed Getters Exist Publicly

| Getter | Status | Function |
|--------|--------|----------|
| Per-cap supply shares | PUBLIC | `margin_pool::user_supply_shares(pool, supplier_cap_id): u64` |
| Shares-to-amount | PUBLIC (via pool) | `margin_pool::user_supply_amount(pool, supplier_cap_id, clock): u64` |
| Available liquidity | PUBLIC | `margin_pool::vault_balance(pool): u64` |
| Rate-limit headroom | PUBLIC | `margin_pool::get_available_withdrawal(pool, clock): u64` |

Note: `margin_state::supply_shares_to_amount` is `public(package)` only, but `MarginPool::user_supply_amount` wraps it publicly. No workaround needed.

### Core Entrypoints

```move
// No sender gate -- anyone can mint
public fun mint_supplier_cap(registry: &MarginRegistry, clock: &Clock, ctx: &mut TxContext): SupplierCap

// Returns new shares for this cap
public fun supply<Asset>(
    pool: &mut MarginPool<Asset>, registry: &MarginRegistry,
    supplier_cap: &SupplierCap, coin: Coin<Asset>,
    referral: Option<ID>, clock: &Clock,
): u64

// Pass option::none() to withdraw all; rate-limited
public fun withdraw<Asset>(
    pool: &mut MarginPool<Asset>, registry: &MarginRegistry,
    supplier_cap: &SupplierCap, amount: Option<u64>,
    clock: &Clock, ctx: &mut TxContext,
): Coin<Asset>
```

### Vault Design Implications

- `LendVault` will own a `SupplierCap` as a dynamic field (since `SupplierCap has key, store`).
- Withdrawals must check `get_available_withdrawal` before calling `withdraw` to avoid rate-limit abort.
- Shares tracking can use `user_supply_shares` for accounting and `user_supply_amount` for NAV calculation.

## Testnet Deployed Addresses

| Package | published-at |
|---------|-------------|
| `deepbook_margin` | `0xe52c1dece2bb5d5645689d6da8b8debe8347e3446011704a4fcb386746876580` |
| `deepbook` (latest) | `0x74cd5657843c627f3d80f713b71e9f895bbbeb470956d8a8e1185badf6cc77c8` |
| `token` | `0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8` |
| `Pyth` | `0xabf837e98c26087cba0883c0a7a28326b1fa3c5e1e2c5abdb486f9e8f594c837` |
| `Wormhole` | `0x21473617f3565d704aa67be73ea41243e9e34a42d434c31f8182c67ba01ccf49` |

## Feasibility Verdict

FEASIBLE. The deepbook_margin supply/withdraw loop is trustless and capability-gated (no sender check, no whitelist). A `LendVault` shared object can own a `SupplierCap`, call `supply` and `withdraw` directly, and read all share/amount state via public getters. The dependency graph (Pyth + Wormhole) is buildable with exact SHA pinning. No blockers.
