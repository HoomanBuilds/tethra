#[test_only]
module tethra_lend::lend_vault_tests;

use tethra_lend::lend_vault::{preview_deposit, preview_withdraw, perf_fee};

#[test]
fun test_first_deposit_one_to_one() {
    // With virtual offset, first deposit of 1_000_000 into empty vault
    // preview_deposit(0, 0, 1_000_000) = 1_000_000 * (0+1_000_000) / (0+1_000_000) = 1_000_000
    let shares = preview_deposit(0, 0, 1_000_000);
    assert!(shares == 1_000_000, 0);
}

#[test]
fun test_second_deposit_proportional() {
    // After first deposit: total_underlying=1_000_000, total_shares=1_000_000
    // Second deposit of 500_000:
    // shares = 500_000 * (1_000_000 + 1_000_000) / (1_000_000 + 1_000_000) = 500_000
    let shares = preview_deposit(1_000_000, 1_000_000, 500_000);
    assert!(shares == 500_000, 0);
}

#[test]
fun test_second_deposit_with_accrued_interest() {
    // Pool has accrued interest: underlying=1_100_000, shares=1_000_000
    // New deposit of 110_000:
    // shares = 110_000 * (1_000_000 + 1_000_000) / (1_100_000 + 1_000_000)
    //        = 110_000 * 2_000_000 / 2_100_000
    //        = 220_000_000_000 / 2_100_000 = 104_761 (floor)
    let shares = preview_deposit(1_100_000, 1_000_000, 110_000);
    assert!(shares == 104_761, 0);
}

#[test]
fun test_perf_fee_with_profit() {
    // proceeds=110, principal=100, fee_bps=1500
    // fee = (110-100) * 1500 / 10000 = 10 * 1500 / 10000 = 1 (floor)
    let fee = perf_fee(110, 100, 1500);
    assert!(fee == 1, 0);
}

#[test]
fun test_perf_fee_no_profit() {
    // proceeds=90, principal=100, no fee
    let fee = perf_fee(90, 100, 1500);
    assert!(fee == 0, 0);
}

#[test]
fun test_perf_fee_break_even() {
    let fee = perf_fee(100, 100, 1500);
    assert!(fee == 0, 0);
}

#[test]
fun test_preview_withdraw_roundtrip() {
    // Deposit 1_000_000 into empty vault -> 1_000_000 shares
    // Then withdraw all 1_000_000 shares:
    // amount = 1_000_000 * (1_000_000 + 1_000_000) / (1_000_000 + 1_000_000) = 1_000_000
    let amount = preview_withdraw(1_000_000, 1_000_000, 1_000_000);
    assert!(amount == 1_000_000, 0);
}

#[test]
fun test_preview_withdraw_partial() {
    // total_underlying=2_000_000, total_shares=1_000_000, redeem 250_000 shares
    // amount = 250_000 * (2_000_000 + 1_000_000) / (1_000_000 + 1_000_000)
    //        = 250_000 * 3_000_000 / 2_000_000 = 375_000
    let amount = preview_withdraw(2_000_000, 1_000_000, 250_000);
    assert!(amount == 375_000, 0);
}
