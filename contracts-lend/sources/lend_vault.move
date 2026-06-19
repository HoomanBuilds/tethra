module tethra_lend::lend_vault;

use deepbook_margin::margin_pool::{MarginPool, SupplierCap};
use deepbook_margin::margin_registry::MarginRegistry;
use sui::sui::SUI;

public struct LendVault has key {
    id: UID,
}

public fun touch(_p: &MarginPool<SUI>, _r: &MarginRegistry) {}
