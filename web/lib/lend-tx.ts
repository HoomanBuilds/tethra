import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import { CLOCK } from "./config";
import { MARGIN_REGISTRY, type LendAsset } from "./lend";

export function buildLendDepositTx(
  asset: LendAsset,
  sender: string,
  amount: bigint,
): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const coin = asset.isGasToken
    ? coinWithBalance({ balance: amount })
    : coinWithBalance({ balance: amount, type: asset.assetType });
  const shares = tx.moveCall({
    target: `${asset.package}::${asset.module}::deposit`,
    arguments: [
      tx.object(asset.vault),
      tx.object(asset.marginPool),
      tx.object(MARGIN_REGISTRY),
      coin,
      tx.object(CLOCK),
    ],
  });
  tx.transferObjects([shares], sender);
  return tx;
}

export function buildLendWithdrawTx(
  asset: LendAsset,
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
    target: `${asset.package}::${asset.module}::withdraw`,
    arguments: [
      tx.object(asset.vault),
      tx.object(asset.marginPool),
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
  asset: LendAsset,
): Promise<{ asset: bigint; shares: bigint; ok: boolean; error?: string }> {
  try {
    const bytes = await tx.build({ client });
    const res = await client.dryRunTransactionBlock({ transactionBlock: bytes });
    if (res.effects.status.status !== "success") {
      return { asset: 0n, shares: 0n, ok: false, error: res.effects.status.error };
    }
    let assetDelta = 0n;
    let sharesDelta = 0n;
    for (const ch of res.balanceChanges ?? []) {
      if (ch.coinType === asset.assetType) assetDelta += BigInt(ch.amount);
      if (ch.coinType === asset.shareType) sharesDelta += BigInt(ch.amount);
    }
    return { asset: assetDelta, shares: sharesDelta, ok: true };
  } catch (e) {
    return { asset: 0n, shares: 0n, ok: false, error: (e as Error).message };
  }
}
