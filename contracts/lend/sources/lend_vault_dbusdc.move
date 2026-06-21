module tethra_lend::lend_vault_dbusdc;

use dbusdc::DBUSDC::DBUSDC;
use deepbook_margin::margin_pool::{Self, MarginPool, SupplierCap};
use deepbook_margin::margin_registry::MarginRegistry;
use sui::clock::Clock;
use sui::coin::{Self, Coin, TreasuryCap};
use tethra_lend::lend_vault::{preview_deposit, preview_withdraw, perf_fee};

const MAX_FEE_BPS: u64 = 3_000;
const DEFAULT_FEE_BPS: u64 = 1_500;

const EZeroAmount: u64 = 0;
const EZeroShares: u64 = 1;
const EDepositCapExceeded: u64 = 2;
const EBadFee: u64 = 3;
const ENotInitialized: u64 = 4;
const EAlreadyInitialized: u64 = 5;

public struct LEND_VAULT_DBUSDC has drop {}

public struct AdminCap has key, store { id: UID }

public struct LendVaultDbusdc has key {
    id: UID,
    supplier_cap: Option<SupplierCap>,
    shares: TreasuryCap<LEND_VAULT_DBUSDC>,
    cost_basis: u64,
    fee_bps: u64,
    fee_treasury: address,
    deposit_cap: u64,
    // ID of our deepbook_margin SupplyReferral, so the vault's supply earns the
    // referral share of the pool spread instead of forfeiting it to the default.
    referral: Option<ID>,
}

fun init(witness: LEND_VAULT_DBUSDC, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        6,
        b"tldUSDC",
        b"Tethra Lend dUSDC Share",
        b"Redeemable share of the Tethra Lend DBUSDC Vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(LendVaultDbusdc {
        id: object::new(ctx),
        supplier_cap: option::none(),
        shares: treasury,
        cost_basis: 0,
        fee_bps: DEFAULT_FEE_BPS,
        fee_treasury: ctx.sender(),
        deposit_cap: 0,
        referral: option::none(),
    });
}

public fun initialize(
    _: &AdminCap,
    vault: &mut LendVaultDbusdc,
    registry: &MarginRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(vault.supplier_cap.is_none(), EAlreadyInitialized);
    let cap = margin_pool::mint_supplier_cap(registry, clock, ctx);
    vault.supplier_cap.fill(cap);
}

public fun deposit(
    vault: &mut LendVaultDbusdc,
    pool: &mut MarginPool<DBUSDC>,
    registry: &MarginRegistry,
    coin: Coin<DBUSDC>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<LEND_VAULT_DBUSDC> {
    assert!(vault.supplier_cap.is_some(), ENotInitialized);
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    assert!(
        vault.deposit_cap == 0 || vault.cost_basis + amount <= vault.deposit_cap,
        EDepositCapExceeded,
    );
    let total_shares = coin::total_supply(&vault.shares);
    let before = margin_pool::user_supply_amount(
        pool,
        object::id(vault.supplier_cap.borrow()),
        clock,
    );
    margin_pool::supply<DBUSDC>(
        pool,
        registry,
        vault.supplier_cap.borrow(),
        coin,
        vault.referral,
        clock,
    );
    let shares = preview_deposit(before, total_shares, amount);
    assert!(shares > 0, EZeroShares);
    vault.cost_basis = vault.cost_basis + amount;
    coin::mint(&mut vault.shares, shares, ctx)
}

public fun withdraw(
    vault: &mut LendVaultDbusdc,
    pool: &mut MarginPool<DBUSDC>,
    registry: &MarginRegistry,
    share: Coin<LEND_VAULT_DBUSDC>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<DBUSDC> {
    assert!(vault.supplier_cap.is_some(), ENotInitialized);
    let s = share.value();
    assert!(s > 0, EZeroShares);
    let total_shares = coin::total_supply(&vault.shares);
    let position = margin_pool::user_supply_amount(
        pool,
        object::id(vault.supplier_cap.borrow()),
        clock,
    );
    let amount_out = preview_withdraw(position, total_shares, s);
    let principal = mul_div(s, vault.cost_basis, total_shares);
    coin::burn(&mut vault.shares, share);
    vault.cost_basis = vault.cost_basis - principal;
    let mut proceeds = margin_pool::withdraw<DBUSDC>(
        pool,
        registry,
        vault.supplier_cap.borrow(),
        option::some(amount_out),
        clock,
        ctx,
    );
    let fee = perf_fee(proceeds.value(), principal, vault.fee_bps);
    if (fee > 0) {
        transfer::public_transfer(proceeds.split(fee, ctx), vault.fee_treasury);
    };
    proceeds
}

public fun set_fee_bps(_: &AdminCap, vault: &mut LendVaultDbusdc, bps: u64) {
    assert!(bps <= MAX_FEE_BPS, EBadFee);
    vault.fee_bps = bps;
}

public fun set_fee_treasury(_: &AdminCap, vault: &mut LendVaultDbusdc, who: address) {
    vault.fee_treasury = who;
}

public fun set_deposit_cap(_: &AdminCap, vault: &mut LendVaultDbusdc, cap: u64) {
    vault.deposit_cap = cap;
}

public fun set_referral(_: &AdminCap, vault: &mut LendVaultDbusdc, id: ID) {
    vault.referral = option::some(id);
}

/// Supply external yield (e.g. claimed margin referral fees) into the vault's
/// position without minting shares, so NAV per share rises for every holder.
public fun compound(
    vault: &mut LendVaultDbusdc,
    pool: &mut MarginPool<DBUSDC>,
    registry: &MarginRegistry,
    coin: Coin<DBUSDC>,
    clock: &Clock,
) {
    assert!(vault.supplier_cap.is_some(), ENotInitialized);
    assert!(coin.value() > 0, EZeroAmount);
    margin_pool::supply<DBUSDC>(
        pool,
        registry,
        vault.supplier_cap.borrow(),
        coin,
        vault.referral,
        clock,
    );
}

public fun cost_basis(vault: &LendVaultDbusdc): u64 { vault.cost_basis }

public fun total_shares(vault: &LendVaultDbusdc): u64 { coin::total_supply(&vault.shares) }

public fun fee_bps(vault: &LendVaultDbusdc): u64 { vault.fee_bps }

public fun deposit_cap(vault: &LendVaultDbusdc): u64 { vault.deposit_cap }

public fun referral(vault: &LendVaultDbusdc): Option<ID> { vault.referral }

public fun is_initialized(vault: &LendVaultDbusdc): bool { vault.supplier_cap.is_some() }

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}
