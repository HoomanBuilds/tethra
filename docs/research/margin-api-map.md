# DeepBook Margin API Map

Source: `MystenLabs/deepbookv3` at `daa5a9514908968f11be1d0388f673e0ee1a5059`

## Full Type Paths

| Type | Full Path |
|------|-----------|
| `MarginPool<Asset>` | `deepbook_margin::margin_pool::MarginPool<Asset>` |
| `MarginRegistry` | `deepbook_margin::margin_registry::MarginRegistry` |
| `SupplierCap` | `deepbook_margin::margin_pool::SupplierCap` |

Abilities: `MarginPool<Asset> has key, store`. `SupplierCap has key, store`. `MarginRegistry has key`.

## Public Signatures

### mint_supplier_cap
```move
public fun mint_supplier_cap(
    registry: &MarginRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
): SupplierCap
```
No sender gate. Anyone can mint. Returns a `SupplierCap` (key+store object transferred to caller by convention, but the function just returns it -- caller must transfer or store).

### supply
```move
public fun supply<Asset>(
    self: &mut MarginPool<Asset>,
    registry: &MarginRegistry,
    supplier_cap: &SupplierCap,
    coin: Coin<Asset>,
    referral: Option<ID>,
    clock: &Clock,
): u64
```
Returns new supply shares for this cap. No owner check on `supplier_cap` -- the cap ID is used as the position key; any holder can supply under any cap.

### withdraw
```move
public fun withdraw<Asset>(
    self: &mut MarginPool<Asset>,
    registry: &MarginRegistry,
    supplier_cap: &SupplierCap,
    amount: Option<u64>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Asset>
```
Pass `option::none()` to withdraw all. Returns the coin. Rate-limiter gate (`ERateLimitExceeded`). No direct ownership check -- position keyed on `supplier_cap.id`.

## Per-SupplierCap Shares Getter (PUBLIC)

```move
public fun user_supply_shares<Asset>(
    self: &MarginPool<Asset>,
    supplier_cap_id: ID,
): u64
```
Pass `object::id(&supplier_cap)` to get shares. Returns 0 if no position exists.

## Shares-to-Amount Converter (PUBLIC)

```move
public fun user_supply_amount<Asset>(
    self: &MarginPool<Asset>,
    supplier_cap_id: ID,
    clock: &Clock,
): u64
```
Returns the current asset amount (including accrued interest) for the given cap's shares. This is the correct function to use when sizing a withdrawal.

The underlying `margin_state::supply_shares_to_amount` is `public(package)` only and not directly callable by external packages. The `user_supply_amount` wrapper on `MarginPool` is the correct external entry point.

## Available-Liquidity Getter (PUBLIC)

```move
public fun vault_balance<Asset>(self: &MarginPool<Asset>): u64
```
Raw vault balance (uninvested cash in pool). For withdrawal planning also use:

```move
public fun get_available_withdrawal<Asset>(self: &MarginPool<Asset>, clock: &Clock): u64
```
Returns the rate-limiter bucket's current allowed withdrawal amount. A vault must check this before calling `withdraw` to avoid `ERateLimitExceeded`.

## Other Useful View Functions

```move
public fun total_supply_with_interest<Asset>(self: &MarginPool<Asset>, clock: &Clock): u64
public fun supply_cap<Asset>(self: &MarginPool<Asset>): u64
public fun interest_rate<Asset>(self: &MarginPool<Asset>): u64
public fun max_utilization_rate<Asset>(self: &MarginPool<Asset>): u64
```

## Getter Availability Summary

| Needed getter | Public? | Function |
|---|---|---|
| Per-cap supply shares | YES | `margin_pool::user_supply_shares` |
| Shares-to-amount | YES (via pool wrapper) | `margin_pool::user_supply_amount` |
| Available liquidity | YES | `margin_pool::vault_balance` + `get_available_withdrawal` |
| Rate-limit headroom | YES | `margin_pool::get_available_withdrawal` |

No missing getters. The withdraw design can be built entirely from public API without any `public(package)` workarounds.

## Testnet Deployed Addresses

| Package | published-at |
|---------|-------------|
| `deepbook_margin` | `0xe52c1dece2bb5d5645689d6da8b8debe8347e3446011704a4fcb386746876580` |
| `deepbook` | `0x74cd5657843c627f3d80f713b71e9f895bbbeb470956d8a8e1185badf6cc77c8` |
| `token` | `0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8` |
| `Pyth` | `0xabf837e98c26087cba0883c0a7a28326b1fa3c5e1e2c5abdb486f9e8f594c837` |
| `Wormhole` | `0x21473617f3565d704aa67be73ea41243e9e34a42d434c31f8182c67ba01ccf49` |

## MarginRegistry (shared object)
`0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75`

## Live MarginPool<SUI>
`0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea`
