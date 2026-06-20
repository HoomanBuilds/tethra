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

public fun reserve_value(m: &Market): u64 { m.reserve.value() }
public fun total_collateral(m: &Market): u64 { m.collateral.value() }
public fun total_borrow_shares(m: &Market): u64 { m.total_borrow_shares }
public fun borrow_index(m: &Market): u128 { m.borrow_index }
public fun supply_total(m: &Market): u64 { coin::total_supply(&m.supply_treasury) }
