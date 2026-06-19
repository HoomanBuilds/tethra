#[test_only]
module plp_vault::vault_tests;

use plp_vault::vault;

#[test]
fun first_deposit_is_one_to_one() {
    assert!(vault::preview_deposit(0, 0, 1_000_000) == 1_000_000, 0);
}

#[test]
fun proportional_deposit() {
    assert!(vault::preview_deposit(1_000_000, 1_000_000, 1_000_000) == 1_000_000, 0);
    assert!(vault::preview_deposit(2_000_000, 2_000_000, 1_000_000) == 1_000_000, 1);
}

#[test]
fun withdraw_round_trip() {
    let shares = vault::preview_deposit(0, 0, 5_000_000);
    let out = vault::preview_withdraw(5_000_000, shares, shares);
    assert!(out == 5_000_000, 0);
}

#[test]
fun first_deposit_attack_is_bounded() {
    let attacker = vault::preview_deposit(0, 0, 1);
    let victim = vault::preview_deposit(1, attacker, 10_000_000);
    assert!(victim > 9_000_000, 0);
}

#[test]
fun fee_only_on_profit() {
    assert!(vault::perf_fee(110_000_000, 100_000_000, 1_500) == 1_500_000, 0);
    assert!(vault::perf_fee(100_000_000, 100_000_000, 1_500) == 0, 1);
    assert!(vault::perf_fee(90_000_000, 100_000_000, 1_500) == 0, 2);
}

#[test]
fun fee_zero_when_disabled() {
    assert!(vault::perf_fee(200_000_000, 100_000_000, 0) == 0, 0);
}
