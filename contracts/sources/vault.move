module plp_vault::vault;

use deepbook_predict::plp::PLP;
use deepbook_predict::predict::{Self, Predict};
use dusdc::dusdc::DUSDC;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin, TreasuryCap};

const VIRTUAL: u64 = 1_000_000;

const EZeroAmount: u64 = 0;
const EZeroShares: u64 = 1;

public struct VAULT has drop {}

public struct Vault has key {
    id: UID,
    plp: Balance<PLP>,
    shares: TreasuryCap<VAULT>,
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
    transfer::share_object(Vault { id: object::new(ctx), plp: balance::zero(), shares: treasury });
}

public fun deposit(
    vault: &mut Vault,
    predict: &mut Predict,
    coin: Coin<DUSDC>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<VAULT> {
    assert!(coin.value() > 0, EZeroAmount);
    let total_plp = vault.plp.value();
    let total_shares = coin::total_supply(&vault.shares);
    let plp_coin = predict::supply<DUSDC>(predict, coin, clock, ctx);
    let plp_in = plp_coin.value();
    vault.plp.join(plp_coin.into_balance());
    let shares = preview_deposit(total_plp, total_shares, plp_in);
    assert!(shares > 0, EZeroShares);
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
    let plp_out = preview_withdraw(vault.plp.value(), coin::total_supply(&vault.shares), s);
    coin::burn(&mut vault.shares, share);
    let plp_coin = coin::from_balance(vault.plp.split(plp_out), ctx);
    predict::withdraw<DUSDC>(predict, plp_coin, clock, ctx)
}

public fun preview_deposit(total_plp: u64, total_shares: u64, plp_in: u64): u64 {
    mul_div(plp_in, total_shares + VIRTUAL, total_plp + VIRTUAL)
}

public fun preview_withdraw(total_plp: u64, total_shares: u64, shares: u64): u64 {
    mul_div(shares, total_plp + VIRTUAL, total_shares + VIRTUAL)
}

public fun total_plp(vault: &Vault): u64 { vault.plp.value() }

public fun total_shares(vault: &Vault): u64 { coin::total_supply(&vault.shares) }

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}
