"use client";

import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import { useSuiClient, useSuiClientQuery } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { VAULT_ID, CLOCK, DUSDC_TYPE, SHARE_TYPE } from "./config";

// Deployed via keeper/src/borrow_market_publish.ts (publish + initialize).
// publish HZMY15iCVmMaFhhh6zFH6WYBrjYXE57CCF1oV86ebgkg
export const BORROW_MARKET = {
  package: "0x2bfa7a256d2dcb170e8d63d211b822874aa701599615afd5ec94c2338b6cfddd",
  market: "0x06f2e438b20f78795eaccedbed96dbd41aeae8bec0feb8e6f6be4def95656145",
  tpusdcType:
    "0x2bfa7a256d2dcb170e8d63d211b822874aa701599615afd5ec94c2338b6cfddd::market::MARKET",
};

export const TPUSDC_DECIMALS = 9; // tpUSDC supplier shares
export const DUSDC_DECIMALS = 6; // dUSDC loan asset
export const TPLP_DECIMALS = 9; // tPLP collateral (the Predict vault share)
export const SCALE = 1_000_000_000;
export const VIRTUAL = 1_000_000n;
export const BPS = 10_000;

export const isBorrowLive = () =>
  BORROW_MARKET.package !== "0x0" && BORROW_MARKET.market !== "0x0";

export interface MarketState {
  reserve: bigint;
  collateral: bigint;
  totalBorrowShares: bigint;
  borrowIndex: bigint; // scaled 1e9
  supplyTotal: bigint; // tpUSDC supply
  baseRate: number;
  baseSlope: number;
  excessSlope: number;
  optimalUtil: number;
  maxLtvBps: number;
  liqThresholdBps: number;
  liqPenaltyBps: number;
}

function num(v: unknown): bigint {
  return BigInt((v as string | number | undefined) ?? 0);
}

export function useMarketState() {
  const q = useSuiClientQuery(
    "getObject",
    { id: BORROW_MARKET.market, options: { showContent: true } },
    { enabled: isBorrowLive(), refetchInterval: 15_000 },
  );
  const f = (q.data?.data?.content as any)?.fields;
  let state: MarketState | undefined;
  if (f) {
    const supply =
      f.supply_treasury?.fields?.total_supply?.fields?.value ??
      f.supply_treasury?.fields?.total_supply ??
      0;
    state = {
      reserve: num(f.reserve),
      collateral: num(f.collateral),
      totalBorrowShares: num(f.total_borrow_shares),
      borrowIndex: num(f.borrow_index),
      supplyTotal: num(supply),
      baseRate: Number(num(f.base_rate)) / SCALE,
      baseSlope: Number(num(f.base_slope)) / SCALE,
      excessSlope: Number(num(f.excess_slope)) / SCALE,
      optimalUtil: Number(num(f.optimal_util)) / SCALE,
      maxLtvBps: Number(num(f.max_ltv_bps)),
      liqThresholdBps: Number(num(f.liq_threshold_bps)),
      liqPenaltyBps: Number(num(f.liq_penalty_bps)),
    };
  }
  return { ...q, state };
}

// Derived market metrics from raw state (mirrors the on-chain kinked curve).
export function marketMetrics(s: MarketState) {
  const totalDebt = (s.totalBorrowShares * s.borrowIndex) / BigInt(SCALE);
  const totalAssets = s.reserve + totalDebt;
  const util = totalAssets > 0n ? Number(totalDebt) / Number(totalAssets) : 0;
  const borrowRate =
    util < s.optimalUtil
      ? s.baseRate + util * s.baseSlope
      : s.baseRate +
        s.optimalUtil * s.baseSlope +
        (util - s.optimalUtil) * s.excessSlope;
  const supplyApy = borrowRate * util;
  const sharePrice =
    s.supplyTotal > 0n
      ? Number(totalAssets + VIRTUAL) / Number(s.supplyTotal + VIRTUAL)
      : 1;
  return { totalDebt, totalAssets, util, borrowRate, supplyApy, sharePrice };
}

// On-chain preview mirrors (virtual-offset share math).
export function previewSupply(
  amount: bigint,
  supplyTotal: bigint,
  totalAssets: bigint,
): bigint {
  return (amount * (supplyTotal + VIRTUAL)) / (totalAssets + VIRTUAL);
}
export function previewUnsupply(
  shares: bigint,
  supplyTotal: bigint,
  totalAssets: bigint,
): bigint {
  return (shares * (totalAssets + VIRTUAL)) / (supplyTotal + VIRTUAL);
}

// Cost-basis-floor valuation of tPLP collateral, in dUSDC base units (6dp).
export function collateralValue(
  nTplp: bigint,
  costBasis: bigint,
  totalShares: bigint,
): bigint {
  if (totalShares === 0n) return 0n;
  return (nTplp * costBasis) / totalShares;
}
export function ltvBps(debtValue: bigint, collValue: bigint): number {
  if (collValue === 0n) return debtValue > 0n ? BPS + 1 : 0;
  return Number((debtValue * BigInt(BPS)) / collValue);
}
export function maxBorrowable(
  collValue: bigint,
  maxLtvBps: number,
  debt: bigint,
): bigint {
  const cap = (collValue * BigInt(maxLtvBps)) / BigInt(BPS);
  return cap > debt ? cap - debt : 0n;
}

export function useTpusdcBalance(address: string | undefined) {
  const q = useSuiClientQuery(
    "getBalance",
    { owner: address as string, coinType: BORROW_MARKET.tpusdcType },
    { enabled: !!address && isBorrowLive(), refetchInterval: 15_000 },
  );
  return { ...q, balance: q.data ? BigInt(q.data.totalBalance) : 0n };
}

export function useCoinObjects(address: string | undefined, coinType: string) {
  const q = useSuiClientQuery(
    "getCoins",
    { owner: address as string, coinType },
    { enabled: !!address },
  );
  const coins = (q.data?.data ?? []) as { coinObjectId: string; balance: string }[];
  return { ...q, coins, ids: coins.map((c) => c.coinObjectId) };
}

export interface Position {
  collateral: bigint; // tPLP locked (9dp)
  debt: bigint; // dUSDC owed (6dp)
  ltvBps: number; // current LTV in bps (also the on-chain health figure)
}

// Read a borrower's position via the contract's own view functions (devInspect).
export async function fetchPosition(
  client: SuiClient,
  address: string,
): Promise<Position | null> {
  if (!isBorrowLive()) return null;
  const tx = new Transaction();
  tx.moveCall({
    target: `${BORROW_MARKET.package}::market::position_of`,
    arguments: [tx.object(BORROW_MARKET.market), tx.pure.address(address)],
  });
  tx.moveCall({
    target: `${BORROW_MARKET.package}::market::health_bps`,
    arguments: [
      tx.object(BORROW_MARKET.market),
      tx.object(VAULT_ID),
      tx.pure.address(address),
    ],
  });
  const res = await client.devInspectTransactionBlock({
    sender: address,
    transactionBlock: tx,
  });
  const r = res.results ?? [];
  const leU64 = (bytes?: number[]): bigint => {
    if (!bytes) return 0n;
    let out = 0n;
    for (let i = 0; i < 8 && i < bytes.length; i++) {
      out |= BigInt(bytes[i]) << BigInt(8 * i);
    }
    return out;
  };
  const collateral = leU64(r[0]?.returnValues?.[0]?.[0] as number[] | undefined);
  const debt = leU64(r[0]?.returnValues?.[1]?.[0] as number[] | undefined);
  const health = Number(leU64(r[1]?.returnValues?.[0]?.[0] as number[] | undefined));
  return { collateral, debt, ltvBps: health };
}

export function usePosition(address: string | undefined) {
  const client = useSuiClient();
  const q = useQuery({
    queryKey: ["borrow-position", address, BORROW_MARKET.market],
    enabled: !!address && isBorrowLive(),
    refetchInterval: 15_000,
    queryFn: () => fetchPosition(client as unknown as SuiClient, address as string),
  });
  return { ...q, position: q.data ?? null };
}

// ---- transactions ----

function mergeAndSplit(tx: Transaction, ids: string[], amount: bigint) {
  const primary = tx.object(ids[0]);
  if (ids.length > 1) {
    tx.mergeCoins(primary, ids.slice(1).map((id) => tx.object(id)));
  }
  return tx.splitCoins(primary, [amount]);
}

// supply(market, Coin<DUSDC>, clock): Coin<tpUSDC>
export function buildSupplyTx(sender: string, dusdcIds: string[], amount: bigint) {
  const tx = new Transaction();
  tx.setSender(sender);
  const [coin] = mergeAndSplit(tx, dusdcIds, amount);
  const shares = tx.moveCall({
    target: `${BORROW_MARKET.package}::market::supply`,
    arguments: [tx.object(BORROW_MARKET.market), coin, tx.object(CLOCK)],
  });
  tx.transferObjects([shares], sender);
  return tx;
}

// unsupply(market, Coin<tpUSDC>, clock): Coin<DUSDC>
export function buildUnsupplyTx(sender: string, tpusdcIds: string[], amount: bigint) {
  const tx = new Transaction();
  tx.setSender(sender);
  const [coin] = mergeAndSplit(tx, tpusdcIds, amount);
  const out = tx.moveCall({
    target: `${BORROW_MARKET.package}::market::unsupply`,
    arguments: [tx.object(BORROW_MARKET.market), coin, tx.object(CLOCK)],
  });
  tx.transferObjects([out], sender);
  return tx;
}

// Add tPLP collateral (optional) then borrow dUSDC (optional) in one PTB.
export function buildBorrowTx(
  sender: string,
  tplpIds: string[],
  collateralAmount: bigint,
  borrowAmount: bigint,
) {
  const tx = new Transaction();
  tx.setSender(sender);
  if (collateralAmount > 0n) {
    const [coll] = mergeAndSplit(tx, tplpIds, collateralAmount);
    tx.moveCall({
      target: `${BORROW_MARKET.package}::market::add_collateral`,
      arguments: [tx.object(BORROW_MARKET.market), tx.object(VAULT_ID), coll],
    });
  }
  if (borrowAmount > 0n) {
    const out = tx.moveCall({
      target: `${BORROW_MARKET.package}::market::borrow`,
      arguments: [
        tx.object(BORROW_MARKET.market),
        tx.object(VAULT_ID),
        tx.pure.u64(borrowAmount),
        tx.object(CLOCK),
      ],
    });
    tx.transferObjects([out], sender);
  }
  return tx;
}

// Repay dUSDC (optional) then withdraw tPLP collateral (optional) in one PTB.
export function buildRepayTx(
  sender: string,
  dusdcIds: string[],
  repayAmount: bigint,
  withdrawAmount: bigint,
) {
  const tx = new Transaction();
  tx.setSender(sender);
  if (repayAmount > 0n) {
    const [coin] = mergeAndSplit(tx, dusdcIds, repayAmount);
    const change = tx.moveCall({
      target: `${BORROW_MARKET.package}::market::repay`,
      arguments: [tx.object(BORROW_MARKET.market), coin, tx.object(CLOCK)],
    });
    tx.transferObjects([change], sender);
  }
  if (withdrawAmount > 0n) {
    const out = tx.moveCall({
      target: `${BORROW_MARKET.package}::market::withdraw_collateral`,
      arguments: [
        tx.object(BORROW_MARKET.market),
        tx.object(VAULT_ID),
        tx.pure.u64(withdrawAmount),
        tx.object(CLOCK),
      ],
    });
    tx.transferObjects([out], sender);
  }
  return tx;
}

export const DUSDC = DUSDC_TYPE;
export const TPLP = SHARE_TYPE;
