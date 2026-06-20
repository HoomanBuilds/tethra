module tethra_borrow_market::market;

use plp_vault::vault::{Self, Vault, VAULT};
use deepbook_predict::predict::{Self, Predict};
use dusdc::dusdc::DUSDC;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::table::{Self, Table};
use sui::event;

const SCALE: u64 = 1_000_000_000;
const BPS: u64 = 10_000;
const VIRTUAL: u64 = 1_000_000;
const MS_PER_YEAR: u64 = 31_536_000_000;

const DEFAULT_BASE_RATE: u64 = 45_000_000;
const DEFAULT_BASE_SLOPE: u64 = 80_000_000;
const DEFAULT_EXCESS_SLOPE: u64 = 4_500_000_000;
const DEFAULT_OPTIMAL_UTIL: u64 = 800_000_000;
const DEFAULT_PROTOCOL_SPREAD: u64 = 100_000_000;
const DEFAULT_MAX_LTV_BPS: u64 = 5_000;
const DEFAULT_LIQ_THRESHOLD_BPS: u64 = 8_000;
const DEFAULT_LIQ_PENALTY_BPS: u64 = 500;

const EZeroAmount: u64 = 0;
const EInsufficientLiquidity: u64 = 1;
const EInsufficientReserve: u64 = 2;
const EExceedsLtv: u64 = 3;
const ECannotLiquidate: u64 = 4;
const EWrongVault: u64 = 5;
const ENoPosition: u64 = 6;
const EBadParams: u64 = 7;

public struct MARKET has drop {}

public struct AdminCap has key, store { id: UID }

public struct Position has store {
    collateral: u64,
    borrow_shares: u64,
}

public struct Market has key {
    id: UID,
    vault_id: ID,
    reserve: Balance<DUSDC>,
    collateral: Balance<VAULT>,
    supply_treasury: TreasuryCap<MARKET>,
    positions: Table<address, Position>,
    total_borrow_shares: u64,
    borrow_index: u128,
    last_accrued_ms: u64,
    base_rate: u64,
    base_slope: u64,
    excess_slope: u64,
    optimal_util: u64,
    protocol_spread: u64,
    max_ltv_bps: u64,
    liq_threshold_bps: u64,
    liq_penalty_bps: u64,
    fee_treasury: address,
}

public struct Supplied has copy, drop { supplier: address, amount: u64, shares: u64 }
public struct Unsupplied has copy, drop { supplier: address, amount: u64, shares: u64 }
public struct Borrowed has copy, drop { who: address, amount: u64, debt: u64 }
public struct Repaid has copy, drop { who: address, amount: u64, debt: u64 }
public struct CollateralAdded has copy, drop { who: address, amount: u64 }
public struct CollateralWithdrawn has copy, drop { who: address, amount: u64 }
public struct PositionLiquidated has copy, drop { borrower: address, repaid: u64, surplus: u64 }
public struct BadDebt has copy, drop { borrower: address, shortfall: u64 }

fun init(witness: MARKET, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        9,
        b"tpUSDC",
        b"Tethra tPLP-Market USDC Deposit",
        b"Interest-bearing dUSDC supplied to the Tethra tPLP lending market",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Market {
        id: object::new(ctx),
        vault_id: object::id_from_address(@0x0),
        reserve: balance::zero(),
        collateral: balance::zero(),
        supply_treasury: treasury,
        positions: table::new(ctx),
        total_borrow_shares: 0,
        borrow_index: (SCALE as u128),
        last_accrued_ms: 0,
        base_rate: DEFAULT_BASE_RATE,
        base_slope: DEFAULT_BASE_SLOPE,
        excess_slope: DEFAULT_EXCESS_SLOPE,
        optimal_util: DEFAULT_OPTIMAL_UTIL,
        protocol_spread: DEFAULT_PROTOCOL_SPREAD,
        max_ltv_bps: DEFAULT_MAX_LTV_BPS,
        liq_threshold_bps: DEFAULT_LIQ_THRESHOLD_BPS,
        liq_penalty_bps: DEFAULT_LIQ_PENALTY_BPS,
        fee_treasury: ctx.sender(),
    });
}

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}

public fun borrow_rate(util: u64, base_rate: u64, base_slope: u64, excess_slope: u64, optimal: u64): u64 {
    if (util < optimal) {
        base_rate + mul_div(util, base_slope, SCALE)
    } else {
        base_rate + mul_div(optimal, base_slope, SCALE) + mul_div(util - optimal, excess_slope, SCALE)
    }
}

public fun accrue_index(index: u128, rate: u64, elapsed_ms: u64): u128 {
    let growth = mul_div(rate, elapsed_ms, MS_PER_YEAR);
    index + (index * (growth as u128)) / (SCALE as u128)
}

public fun utilization(reserve: u64, debt: u64): u64 {
    let assets = reserve + debt;
    if (assets == 0) 0 else mul_div(debt, SCALE, assets)
}

public fun debt_of(shares: u64, index: u128): u64 {
    (((shares as u128) * index) / (SCALE as u128)) as u64
}

public fun shares_for_debt(amount: u64, index: u128): u64 {
    (((amount as u128) * (SCALE as u128)) / index) as u64
}

public fun collateral_value(n_tplp: u64, cost_basis: u64, total_shares: u64): u64 {
    if (total_shares == 0) 0 else mul_div(n_tplp, cost_basis, total_shares)
}

public fun preview_supply(amount: u64, total_supply: u64, total_assets: u64): u64 {
    mul_div(amount, total_supply + VIRTUAL, total_assets + VIRTUAL)
}

public fun preview_unsupply(shares: u64, total_supply: u64, total_assets: u64): u64 {
    mul_div(shares, total_assets + VIRTUAL, total_supply + VIRTUAL)
}

public fun ltv_bps(debt_value: u64, coll_value: u64): u64 {
    if (coll_value == 0) BPS + 1 else mul_div(debt_value, BPS, coll_value)
}

public fun liquidation_split(proceeds: u64, debt: u64, penalty_bps: u64): (u64, u64, u64) {
    let repay = if (proceeds < debt) proceeds else debt;
    let after_repay = proceeds - repay;
    let want_penalty = mul_div(debt, penalty_bps, BPS);
    let penalty = if (want_penalty < after_repay) want_penalty else after_repay;
    let surplus = after_repay - penalty;
    (repay, penalty, surplus)
}

public fun reserve_value(m: &Market): u64 { m.reserve.value() }
public fun total_collateral(m: &Market): u64 { m.collateral.value() }
public fun total_borrow_shares(m: &Market): u64 { m.total_borrow_shares }
public fun borrow_index(m: &Market): u128 { m.borrow_index }
public fun supply_total(m: &Market): u64 { coin::total_supply(&m.supply_treasury) }

public fun total_debt(m: &Market): u64 { debt_of(m.total_borrow_shares, m.borrow_index) }
public fun total_assets(m: &Market): u64 { m.reserve.value() + total_debt(m) }

public fun accrue(m: &mut Market, clock: &Clock) {
    let now = clock.timestamp_ms();
    let elapsed = now - m.last_accrued_ms;
    if (elapsed > 0 && m.total_borrow_shares > 0 && m.last_accrued_ms > 0) {
        let util = utilization(m.reserve.value(), total_debt(m));
        let rate = borrow_rate(util, m.base_rate, m.base_slope, m.excess_slope, m.optimal_util);
        m.borrow_index = accrue_index(m.borrow_index, rate, elapsed);
    };
    m.last_accrued_ms = now;
}

public fun supply(m: &mut Market, coin: Coin<DUSDC>, clock: &Clock, ctx: &mut TxContext): Coin<MARKET> {
    accrue(m, clock);
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    let shares = preview_supply(amount, coin::total_supply(&m.supply_treasury), total_assets(m));
    m.reserve.join(coin.into_balance());
    event::emit(Supplied { supplier: ctx.sender(), amount, shares });
    coin::mint(&mut m.supply_treasury, shares, ctx)
}

public fun unsupply(m: &mut Market, shares: Coin<MARKET>, clock: &Clock, ctx: &mut TxContext): Coin<DUSDC> {
    accrue(m, clock);
    let s = shares.value();
    assert!(s > 0, EZeroAmount);
    let amount = preview_unsupply(s, coin::total_supply(&m.supply_treasury), total_assets(m));
    assert!(amount <= m.reserve.value(), EInsufficientLiquidity);
    coin::burn(&mut m.supply_treasury, shares);
    event::emit(Unsupplied { supplier: ctx.sender(), amount, shares: s });
    coin::from_balance(m.reserve.split(amount), ctx)
}

public fun initialize(_: &AdminCap, m: &mut Market, vault: &Vault) {
    m.vault_id = object::id(vault);
}

public fun seed_reserve(_: &AdminCap, m: &mut Market, coin: Coin<DUSDC>) {
    m.reserve.join(coin.into_balance());
}

public fun withdraw_reserve(_: &AdminCap, m: &mut Market, amount: u64, ctx: &mut TxContext): Coin<DUSDC> {
    assert!(amount <= m.reserve.value(), EInsufficientReserve);
    coin::from_balance(m.reserve.split(amount), ctx)
}

public fun set_risk_params(_: &AdminCap, m: &mut Market, max_ltv_bps: u64, liq_threshold_bps: u64, liq_penalty_bps: u64) {
    assert!(max_ltv_bps < liq_threshold_bps && liq_threshold_bps < BPS && liq_penalty_bps <= 1_000, EBadParams);
    m.max_ltv_bps = max_ltv_bps;
    m.liq_threshold_bps = liq_threshold_bps;
    m.liq_penalty_bps = liq_penalty_bps;
}

public fun set_interest_params(_: &AdminCap, m: &mut Market, base_rate: u64, base_slope: u64, excess_slope: u64, optimal_util: u64, protocol_spread: u64) {
    assert!(optimal_util < SCALE && protocol_spread < SCALE, EBadParams);
    m.base_rate = base_rate;
    m.base_slope = base_slope;
    m.excess_slope = excess_slope;
    m.optimal_util = optimal_util;
    m.protocol_spread = protocol_spread;
}

public fun set_fee_treasury(_: &AdminCap, m: &mut Market, who: address) {
    m.fee_treasury = who;
}
