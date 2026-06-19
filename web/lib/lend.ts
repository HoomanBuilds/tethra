"use client";

import { useSuiClientQuery } from "@mysten/dapp-kit";

export const LEND_PKG =
  "0x7e721eef3cd64f8073dd3f31cccc55fe1f8df06dc795abdd13739562d26a841d";
export const LEND_VAULT_ID =
  "0x66fbffc2ac715939213fac8ef2cfa2f5aa7180ff72d15c9f7c27c1802fc5c2c3";
export const LEND_SHARE_TYPE = `${LEND_PKG}::lend_vault::LEND_VAULT`;
export const SUI_MARGIN_POOL =
  "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea";
export const MARGIN_REGISTRY =
  "0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75";
export const SUI_TYPE = "0x2::sui::SUI";

export const LEND_SUI_DECIMALS = 9;
export const LEND_SHARE_DECIMALS = 9;
// 0.1 SUI reserve for gas when depositing SUI (which is also the gas token)
export const GAS_RESERVE = 100_000_000n;

export interface LendVaultState {
  costBasis: bigint;
  feeBps: number;
  depositCap: bigint;
  totalShares: bigint;
}

export interface MarginPoolState {
  totalSupply: bigint;
  totalBorrow: bigint;
  // All rate fields are 1e18-scaled fixed-point from the contract
  baseRate: number;
  baseSlope: number;
  excessSlope: number;
  optimalUtilization: number;
  protocolSpread: number;
}

export function useLendVaultState() {
  const q = useSuiClientQuery(
    "getObject",
    { id: LEND_VAULT_ID, options: { showContent: true } },
    { refetchInterval: 15_000 },
  );
  const f = (q.data?.data?.content as any)?.fields;
  let state: LendVaultState | undefined;
  if (f) {
    const supply =
      f.shares?.fields?.total_supply?.fields?.value ??
      f.shares?.fields?.total_supply ??
      f.total_supply ??
      0;
    state = {
      costBasis: BigInt(f.cost_basis ?? 0),
      feeBps: Number(f.fee_bps ?? 0),
      depositCap: BigInt(f.deposit_cap ?? 0),
      totalShares: BigInt(supply),
    };
  }
  return { ...q, state };
}

export function useSuiBalance(address: string | undefined) {
  const q = useSuiClientQuery(
    "getBalance",
    { owner: address as string, coinType: SUI_TYPE },
    { enabled: !!address, refetchInterval: 15_000 },
  );
  return { ...q, balance: q.data ? BigInt(q.data.totalBalance) : 0n };
}

export function useLendShareBalance(address: string | undefined) {
  const q = useSuiClientQuery(
    "getBalance",
    { owner: address as string, coinType: LEND_SHARE_TYPE },
    { enabled: !!address, refetchInterval: 15_000 },
  );
  return { ...q, balance: q.data ? BigInt(q.data.totalBalance) : 0n };
}

export function useLendShares(address: string | undefined) {
  const q = useSuiClientQuery(
    "getCoins",
    { owner: address as string, coinType: LEND_SHARE_TYPE },
    { enabled: !!address },
  );
  const coins = (q.data?.data ?? []) as { coinObjectId: string; balance: string }[];
  return { ...q, coins };
}

export function useSuiMarginPool() {
  const q = useSuiClientQuery(
    "getObject",
    { id: SUI_MARGIN_POOL, options: { showContent: true } },
    { refetchInterval: 30_000 },
  );
  const f = (q.data?.data?.content as any)?.fields;
  let pool: MarginPoolState | undefined;
  if (f) {
    try {
      const state = f.state?.fields ?? f.state ?? f;
      const config = f.config?.fields ?? f.config ?? {};
      const interestCfg =
        config.interest_config?.fields ?? config.interest_config ?? {};
      const poolCfg =
        config.margin_pool_config?.fields ?? config.margin_pool_config ?? {};

      const SCALE = 1e18;
      pool = {
        totalSupply: BigInt(state.total_supply ?? 0),
        totalBorrow: BigInt(state.total_borrow ?? 0),
        baseRate: Number(BigInt(interestCfg.base_rate ?? 0)) / SCALE,
        baseSlope: Number(BigInt(interestCfg.base_slope ?? 0)) / SCALE,
        excessSlope: Number(BigInt(interestCfg.excess_slope ?? 0)) / SCALE,
        optimalUtilization:
          Number(BigInt(interestCfg.optimal_utilization ?? 0)) / SCALE,
        protocolSpread: Number(BigInt(poolCfg.protocol_spread ?? 0)) / SCALE,
      };
    } catch {
      pool = undefined;
    }
  }
  return { ...q, pool };
}
