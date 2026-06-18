"use client";

import { useSuiClientQuery } from "@mysten/dapp-kit";
import { VAULT_ID, DUSDC_TYPE, SHARE_TYPE, VIRTUAL } from "./config";

export interface VaultState {
  plp: bigint; // PLP balance held by the vault (raw)
  totalShares: bigint; // total VAULT supply (9 dec)
  costBasis: bigint; // aggregate DUSDC principal (6 dec)
  feeBps: number;
  depositCap: bigint; // DUSDC raw, 0 means uncapped
}

export function useVaultState() {
  const q = useSuiClientQuery(
    "getObject",
    { id: VAULT_ID, options: { showContent: true } },
    { refetchInterval: 15_000 },
  );
  const f = (q.data?.data?.content as any)?.fields;
  let state: VaultState | undefined;
  if (f) {
    const supply =
      f.shares?.fields?.total_supply?.fields?.value ??
      f.shares?.fields?.total_supply ??
      0;
    state = {
      plp: BigInt(f.plp ?? 0),
      totalShares: BigInt(supply),
      costBasis: BigInt(f.cost_basis ?? 0),
      feeBps: Number(f.fee_bps ?? 0),
      depositCap: BigInt(f.deposit_cap ?? 0),
    };
  }
  return { ...q, state };
}

export function useCoinBalance(address: string | undefined, coinType: string) {
  const q = useSuiClientQuery(
    "getBalance",
    { owner: address as string, coinType },
    { enabled: !!address, refetchInterval: 15_000 },
  );
  return { ...q, balance: q.data ? BigInt(q.data.totalBalance) : 0n };
}
export const useDusdcBalance = (address: string | undefined) =>
  useCoinBalance(address, DUSDC_TYPE);
export const useShareBalance = (address: string | undefined) =>
  useCoinBalance(address, SHARE_TYPE);

// Returns the owner's coin objects for a type (for building split/merge txs).
export function useCoins(address: string | undefined, coinType: string) {
  const q = useSuiClientQuery(
    "getCoins",
    { owner: address as string, coinType },
    { enabled: !!address },
  );
  const coins = (q.data?.data ?? []) as { coinObjectId: string; balance: string }[];
  return { ...q, coins };
}

// Pure mirrors of the on-chain share math (PLP-space only). DUSDC-denominated
// previews depend on the predict price and must use a dry-run, see lib/tx.ts.
export function previewDepositShares(
  totalPlp: bigint,
  totalShares: bigint,
  plpIn: bigint,
): bigint {
  return (plpIn * (totalShares + VIRTUAL)) / (totalPlp + VIRTUAL);
}
export function previewWithdrawPlp(
  totalPlp: bigint,
  totalShares: bigint,
  shares: bigint,
): bigint {
  return (shares * (totalPlp + VIRTUAL)) / (totalShares + VIRTUAL);
}
