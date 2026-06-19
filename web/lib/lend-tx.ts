import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import { CLOCK } from "./config";
import {
  LEND_PKG,
  LEND_VAULT_ID,
  SUI_MARGIN_POOL,
  MARGIN_REGISTRY,
  LEND_SHARE_TYPE,
  SUI_TYPE,
} from "./lend";

export function buildLendDepositTx(sender: string, amount: bigint): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  // coinWithBalance reserves gas automatically; safe to use for SUI deposits
  const coin = coinWithBalance({ balance: amount });
  const shares = tx.moveCall({
    target: `${LEND_PKG}::lend_vault::deposit`,
    arguments: [
      tx.object(LEND_VAULT_ID),
      tx.object(SUI_MARGIN_POOL),
      tx.object(MARGIN_REGISTRY),
      coin,
      tx.object(CLOCK),
    ],
  });
  tx.transferObjects([shares], sender);
  return tx;
}

export function buildLendWithdrawTx(
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
    target: `${LEND_PKG}::lend_vault::withdraw`,
    arguments: [
      tx.object(LEND_VAULT_ID),
      tx.object(SUI_MARGIN_POOL),
      tx.object(MARGIN_REGISTRY),
      shareCoin,
      tx.object(CLOCK),
    ],
  });
  tx.transferObjects([out], sender);
  return tx;
}

export async function simulateLendDeltas(
  client: SuiClient,
  tx: Transaction,
): Promise<{ sui: bigint; shares: bigint; ok: boolean; error?: string }> {
  try {
    const bytes = await tx.build({ client });
    const res = await client.dryRunTransactionBlock({ transactionBlock: bytes });
    if (res.effects.status.status !== "success") {
      return { sui: 0n, shares: 0n, ok: false, error: res.effects.status.error };
    }
    let sui = 0n;
    let shares = 0n;
    for (const ch of res.balanceChanges ?? []) {
      if (ch.coinType === SUI_TYPE) sui += BigInt(ch.amount);
      if (ch.coinType === LEND_SHARE_TYPE) shares += BigInt(ch.amount);
    }
    return { sui, shares, ok: true };
  } catch (e) {
    return { sui: 0n, shares: 0n, ok: false, error: (e as Error).message };
  }
}
