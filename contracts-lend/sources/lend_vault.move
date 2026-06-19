module tethra_lend::lend_vault;

use deepbook_margin::margin_pool::{Self, MarginPool, SupplierCap};
use deepbook_margin::margin_registry::MarginRegistry;
use sui::clock::Clock;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::sui::SUI;

const VIRTUAL: u64 = 1_000_000;
const BPS: u64 = 10_000;
const MAX_FEE_BPS: u64 = 3_000;
const DEFAULT_FEE_BPS: u64 = 1_500;

const EZeroAmount: u64 = 0;
const EZeroShares: u64 = 1;
const EDepositCapExceeded: u64 = 2;
const EBadFee: u64 = 3;
const ENotInitialized: u64 = 4;
const EAlreadyInitialized: u64 = 5;

public struct LEND_VAULT has drop {}

public struct AdminCap has key, store { id: UID }

public struct LendVault has key {
    id: UID,
    supplier_cap: Option<SupplierCap>,
    shares: TreasuryCap<LEND_VAULT>,
    cost_basis: u64,
    fee_bps: u64,
    fee_treasury: address,
    deposit_cap: u64,
}

fun init(witness: LEND_VAULT, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        9,
        b"tlSUI",
        b"Tethra Lend SUI Share",
        b"Redeemable share of the Tethra Lend SUI Vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(LendVault {
        id: object::new(ctx),
        supplier_cap: option::none(),
        shares: treasury,
        cost_basis: 0,
        fee_bps: DEFAULT_FEE_BPS,
        fee_treasury: ctx.sender(),
        deposit_cap: 0,
    });
}

public fun initialize(
    _: &AdminCap,
    vault: &mut LendVault,
    registry: &MarginRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(vault.supplier_cap.is_none(), EAlreadyInitialized);
    let cap = margin_pool::mint_supplier_cap(registry, clock, ctx);
    vault.supplier_cap.fill(cap);
}

public fun deposit(
    vault: &mut LendVault,
    pool: &mut MarginPool<SUI>,
    registry: &MarginRegistry,
    coin: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<LEND_VAULT> {
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
    margin_pool::supply<SUI>(
        pool,
        registry,
        vault.supplier_cap.borrow(),
        coin,
        option::none(),
        clock,
    );
    let shares = preview_deposit(before, total_shares, amount);
    assert!(shares > 0, EZeroShares);
    vault.cost_basis = vault.cost_basis + amount;
    coin::mint(&mut vault.shares, shares, ctx)
}

public fun withdraw(
    vault: &mut LendVault,
    pool: &mut MarginPool<SUI>,
    registry: &MarginRegistry,
    share: Coin<LEND_VAULT>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI> {
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
    let mut proceeds = margin_pool::withdraw<SUI>(
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

public fun set_fee_bps(_: &AdminCap, vault: &mut LendVault, bps: u64) {
    assert!(bps <= MAX_FEE_BPS, EBadFee);
    vault.fee_bps = bps;
}

public fun set_fee_treasury(_: &AdminCap, vault: &mut LendVault, who: address) {
    vault.fee_treasury = who;
}

public fun set_deposit_cap(_: &AdminCap, vault: &mut LendVault, cap: u64) {
    vault.deposit_cap = cap;
}

public fun preview_deposit(total_underlying: u64, total_shares: u64, amount_in: u64): u64 {
    mul_div(amount_in, total_shares + VIRTUAL, total_underlying + VIRTUAL)
}

public fun preview_withdraw(total_underlying: u64, total_shares: u64, shares: u64): u64 {
    mul_div(shares, total_underlying + VIRTUAL, total_shares + VIRTUAL)
}

public fun perf_fee(proceeds: u64, principal: u64, fee_bps: u64): u64 {
    if (proceeds > principal) mul_div(proceeds - principal, fee_bps, BPS) else 0
}

public fun cost_basis(vault: &LendVault): u64 { vault.cost_basis }

public fun total_shares(vault: &LendVault): u64 { coin::total_supply(&vault.shares) }

public fun fee_bps(vault: &LendVault): u64 { vault.fee_bps }

public fun deposit_cap(vault: &LendVault): u64 { vault.deposit_cap }

public fun is_initialized(vault: &LendVault): bool { vault.supplier_cap.is_some() }

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}
