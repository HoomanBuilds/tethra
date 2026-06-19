module plp_vault::vault;

use deepbook_predict::plp::PLP;
use deepbook_predict::predict::{Self, Predict};
use dusdc::dusdc::DUSDC;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin, TreasuryCap};

const VIRTUAL: u64 = 1_000_000;
const BPS: u64 = 10_000;
const MAX_FEE_BPS: u64 = 3_000;
const DEFAULT_FEE_BPS: u64 = 1_500;

const EZeroAmount: u64 = 0;
const EZeroShares: u64 = 1;
const EDepositCapExceeded: u64 = 2;
const EBadFee: u64 = 3;

public struct VAULT has drop {}

public struct AdminCap has key, store { id: UID }

public struct Vault has key {
    id: UID,
    plp: Balance<PLP>,
    shares: TreasuryCap<VAULT>,
    cost_basis: u64,
    fee_bps: u64,
    fee_treasury: address,
    deposit_cap: u64,
}

fun init(witness: VAULT, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        9,
        b"plpVAULT",
        b"PLP Ladder Vault Share",
        b"Redeemable share of the PLP Ladder Vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Vault {
        id: object::new(ctx),
        plp: balance::zero(),
        shares: treasury,
        cost_basis: 0,
        fee_bps: DEFAULT_FEE_BPS,
        fee_treasury: ctx.sender(),
        deposit_cap: 0,
    });
}

public fun deposit(
    vault: &mut Vault,
    predict: &mut Predict,
    coin: Coin<DUSDC>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<VAULT> {
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    assert!(vault.deposit_cap == 0 || vault.cost_basis + amount <= vault.deposit_cap, EDepositCapExceeded);
    let total_plp = vault.plp.value();
    let total_shares = coin::total_supply(&vault.shares);
    let plp_coin = predict::supply<DUSDC>(predict, coin, clock, ctx);
    let plp_in = plp_coin.value();
    vault.plp.join(plp_coin.into_balance());
    let shares = preview_deposit(total_plp, total_shares, plp_in);
    assert!(shares > 0, EZeroShares);
    vault.cost_basis = vault.cost_basis + amount;
    coin::mint(&mut vault.shares, shares, ctx)
}

public fun withdraw(
    vault: &mut Vault,
    predict: &mut Predict,
    share: Coin<VAULT>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<DUSDC> {
    let s = share.value();
    assert!(s > 0, EZeroShares);
    let total_shares = coin::total_supply(&vault.shares);
    let plp_out = preview_withdraw(vault.plp.value(), total_shares, s);
    let principal = mul_div(s, vault.cost_basis, total_shares);
    coin::burn(&mut vault.shares, share);
    vault.cost_basis = vault.cost_basis - principal;
    let plp_coin = coin::from_balance(vault.plp.split(plp_out), ctx);
    let mut proceeds = predict::withdraw<DUSDC>(predict, plp_coin, clock, ctx);
    let fee = perf_fee(proceeds.value(), principal, vault.fee_bps);
    if (fee > 0) {
        transfer::public_transfer(proceeds.split(fee, ctx), vault.fee_treasury);
    };
    proceeds
}

public fun set_fee_bps(_: &AdminCap, vault: &mut Vault, bps: u64) {
    assert!(bps <= MAX_FEE_BPS, EBadFee);
    vault.fee_bps = bps;
}

public fun set_fee_treasury(_: &AdminCap, vault: &mut Vault, who: address) {
    vault.fee_treasury = who;
}

public fun set_deposit_cap(_: &AdminCap, vault: &mut Vault, cap: u64) {
    vault.deposit_cap = cap;
}

public fun preview_deposit(total_plp: u64, total_shares: u64, plp_in: u64): u64 {
    mul_div(plp_in, total_shares + VIRTUAL, total_plp + VIRTUAL)
}

public fun preview_withdraw(total_plp: u64, total_shares: u64, shares: u64): u64 {
    mul_div(shares, total_plp + VIRTUAL, total_shares + VIRTUAL)
}

public fun perf_fee(proceeds: u64, principal: u64, fee_bps: u64): u64 {
    if (proceeds > principal) mul_div(proceeds - principal, fee_bps, BPS) else 0
}

public fun total_plp(vault: &Vault): u64 { vault.plp.value() }

public fun total_shares(vault: &Vault): u64 { coin::total_supply(&vault.shares) }

public fun cost_basis(vault: &Vault): u64 { vault.cost_basis }

public fun fee_bps(vault: &Vault): u64 { vault.fee_bps }

public fun deposit_cap(vault: &Vault): u64 { vault.deposit_cap }

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}
