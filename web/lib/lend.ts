"use client";

import { useSuiClientQuery } from "@mysten/dapp-kit";

export const MARGIN_REGISTRY =
  "0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75";

export const GAS_RESERVE = 100_000_000n;

export const LEND_SHARE_DECIMALS = 9;

export interface LendAsset {
  key: "sui" | "dusdc";
  package: string;
  vault: string;
  module: string;
  shareType: string;
  marginPool: string;
  assetType: string;
  decimals: number;
  symbol: string;
  isGasToken: boolean;
}

export const LEND_ASSETS: Record<"sui" | "dusdc", LendAsset> = {
  sui: {
    key: "sui",
    package: "0xc61b07b4d84e93be8d8c033f8a52c35d594bbeb486f832d67744d0b83a357d6d",
    vault: "0xea490c338eb9709147b913fdcdf44c1b928f79c01419f8fbc50f9254e71e3cd8",
    module: "lend_vault",
    shareType:
      "0xc61b07b4d84e93be8d8c033f8a52c35d594bbeb486f832d67744d0b83a357d6d::lend_vault::LEND_VAULT",
    marginPool:
      "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea",
    assetType: "0x2::sui::SUI",
    decimals: 9,
    symbol: "SUI",
    isGasToken: true,
  },
  dusdc: {
    key: "dusdc",
    package: "0xc61b07b4d84e93be8d8c033f8a52c35d594bbeb486f832d67744d0b83a357d6d",
    vault: "0xfa7a4c5653ea73c48b2d6376cd660e67a995b7e12a5e419e4ae0fafd9455ea4f",
    module: "lend_vault_dbusdc",
    shareType:
      "0xc61b07b4d84e93be8d8c033f8a52c35d594bbeb486f832d67744d0b83a357d6d::lend_vault_dbusdc::LEND_VAULT_DBUSDC",
    marginPool:
      "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d",
    assetType:
      "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    decimals: 6,
    symbol: "DBUSDC",
    isGasToken: false,
  },
};

export interface LendVaultState {
  costBasis: bigint;
  feeBps: number;
  depositCap: bigint;
  totalShares: bigint;
}

export interface MarginPoolState {
  totalSupply: bigint;
  totalBorrow: bigint;
  baseRate: number;
  baseSlope: number;
  excessSlope: number;
  optimalUtilization: number;
  protocolSpread: number;
}

export function useLendVaultState(asset: LendAsset) {
  const q = useSuiClientQuery(
    "getObject",
    { id: asset.vault, options: { showContent: true } },
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

export function useAssetBalance(address: string | undefined, asset: LendAsset) {
  const q = useSuiClientQuery(
    "getBalance",
    { owner: address as string, coinType: asset.assetType },
    { enabled: !!address, refetchInterval: 15_000 },
  );
  return { ...q, balance: q.data ? BigInt(q.data.totalBalance) : 0n };
}

export function useLendShareBalance(address: string | undefined, asset: LendAsset) {
  const q = useSuiClientQuery(
    "getBalance",
    { owner: address as string, coinType: asset.shareType },
    { enabled: !!address, refetchInterval: 15_000 },
  );
  return { ...q, balance: q.data ? BigInt(q.data.totalBalance) : 0n };
}

export function useLendShares(address: string | undefined, asset: LendAsset) {
  const q = useSuiClientQuery(
    "getCoins",
    { owner: address as string, coinType: asset.shareType },
    { enabled: !!address },
  );
  const coins = (q.data?.data ?? []) as { coinObjectId: string; balance: string }[];
  return { ...q, coins };
}

export function useMarginPool(asset: LendAsset) {
  const q = useSuiClientQuery(
    "getObject",
    { id: asset.marginPool, options: { showContent: true } },
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
      const SCALE = 1e9;
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
