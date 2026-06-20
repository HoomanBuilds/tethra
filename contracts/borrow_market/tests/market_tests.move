#[test_only]
module tethra_borrow_market::market_tests;

use tethra_borrow_market::market;

const SCALE: u64 = 1_000_000_000;

#[test]
fun rate_below_kink_is_base_plus_slope() {
    // util 50%, base 4.5%, base_slope 8%, optimal 80% -> 4.5% + 0.5*8% = 8.5%
    let r = market::borrow_rate(500_000_000, 45_000_000, 80_000_000, 4_500_000_000, 800_000_000);
    assert!(r == 45_000_000 + 40_000_000, 0); // 85_000_000
}

#[test]
fun rate_above_kink_uses_excess_slope() {
    // util 90%: 4.5% + 0.8*8% + 0.1*450% = 4.5% + 6.4% + 45% = 55.9%
    let r = market::borrow_rate(900_000_000, 45_000_000, 80_000_000, 4_500_000_000, 800_000_000);
    assert!(r == 45_000_000 + 64_000_000 + 450_000_000, 0); // 559_000_000
}

#[test]
fun accrue_one_year_at_ten_pct() {
    // index 1e9, rate 10%, one full year -> +10%
    let i = market::accrue_index((SCALE as u128), 100_000_000, 31_536_000_000);
    assert!(i == (1_100_000_000 as u128), 0);
}

#[test]
fun accrue_zero_elapsed_is_noop() {
    let i = market::accrue_index((SCALE as u128), 100_000_000, 0);
    assert!(i == (SCALE as u128), 0);
}

#[test]
fun utilization_basic() {
    assert!(market::utilization(0, 0) == 0, 0);
    assert!(market::utilization(100, 100) == 500_000_000, 1); // 50%
}

#[test]
fun debt_and_shares_roundtrip() {
    let idx = (1_200_000_000 as u128); // index 1.2
    let shares = market::shares_for_debt(120, idx); // 120 / 1.2 = 100
    assert!(shares == 100, 0);
    assert!(market::debt_of(100, idx) == 120, 1);
}

#[test]
fun collateral_value_is_cost_basis_ratio() {
    assert!(market::collateral_value(1000, 1002, 1000) == 1002, 0);
    assert!(market::collateral_value(500, 1002, 1000) == 501, 1);
    assert!(market::collateral_value(1, 0, 0) == 0, 2);
}

#[test]
fun first_supply_is_one_to_one() {
    assert!(market::preview_supply(1_000_000, 0, 0) == 1_000_000, 0);
}

#[test]
fun supply_unsupply_roundtrip() {
    // assets > supply (interest accrued) -> shares worth slightly more
    let shares = market::preview_supply(1_000_000, 2_000_000, 2_200_000);
    let back = market::preview_unsupply(shares, 2_000_000, 2_200_000);
    assert!(back <= 1_000_000 && back >= 999_990, 0);
}

#[test]
fun ltv_bps_basic() {
    assert!(market::ltv_bps(500, 1000) == 5_000, 0); // 50%
    assert!(market::ltv_bps(800, 1000) == 8_000, 1); // 80%
    assert!(market::ltv_bps(1, 0) == 10_001, 2); // zero collateral -> over-cap sentinel
}
