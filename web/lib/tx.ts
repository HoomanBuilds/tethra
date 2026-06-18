import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import {
  PACKAGE,
  VAULT_ID,
  PREDICT_OBJECT,
  CLOCK,
  DUSDC_TYPE,
  SHARE_TYPE,
} from "./config";

// deposit(vault, predict, Coin<DUSDC>, clock): Coin<VAULT>
export function buildDepositTx(
  sender: string,
  dusdcCoinIds: string[],
  amount: bigint,
): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const primary = tx.object(dusdcCoinIds[0]);
  if (dusdcCoinIds.length > 1) {
    tx.mergeCoins(
      primary,
      dusdcCoinIds.slice(1).map((id) => tx.object(id)),
    );
  }
  const [coin] = tx.splitCoins(primary, [amount]);
  const shares = tx.moveCall({
    target: `${PACKAGE}::vault::deposit`,
    arguments: [tx.object(VAULT_ID), tx.object(PREDICT_OBJECT), coin, tx.object(CLOCK)],
  });
  tx.transferObjects([shares], sender);
  return tx;
}

// withdraw(vault, predict, Coin<VAULT>, clock): Coin<DUSDC>
export function buildWithdrawTx(
  sender: string,
  shareCoinIds: string[],
  shares: bigint,
): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const primary = tx.object(shareCoinIds[0]);
  if (shareCoinIds.length > 1) {
    tx.mergeCoins(
      primary,
      shareCoinIds.slice(1).map((id) => tx.object(id)),
    );
  }
  const [shareCoin] = tx.splitCoins(primary, [shares]);
  const out = tx.moveCall({
    target: `${PACKAGE}::vault::withdraw`,
    arguments: [
      tx.object(VAULT_ID),
      tx.object(PREDICT_OBJECT),
      shareCoin,
      tx.object(CLOCK),
    ],
  });
  tx.transferObjects([out], sender);
  return tx;
}

// Dry-runs a built tx and returns the sender's net coin deltas (raw units).
// Use this for accurate previews: shares received on deposit, DUSDC returned on
// withdraw (already net of the performance fee).
export async function simulateDeltas(
  client: SuiClient,
  tx: Transaction,
): Promise<{ dusdc: bigint; shares: bigint; ok: boolean; error?: string }> {
  try {
    const bytes = await tx.build({ client });
    const res = await client.dryRunTransactionBlock({ transactionBlock: bytes });
    if (res.effects.status.status !== "success") {
      return { dusdc: 0n, shares: 0n, ok: false, error: res.effects.status.error };
    }
    let dusdc = 0n;
    let shares = 0n;
    for (const ch of res.balanceChanges ?? []) {
      if (ch.coinType === DUSDC_TYPE) dusdc += BigInt(ch.amount);
      if (ch.coinType === SHARE_TYPE) shares += BigInt(ch.amount);
    }
    return { dusdc, shares, ok: true };
  } catch (e) {
    return { dusdc: 0n, shares: 0n, ok: false, error: (e as Error).message };
  }
}
