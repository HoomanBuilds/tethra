import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { RPC, PREDICT_PKG, PREDICT_OBJ, DUSDC_TYPE, CLOCK } from './config.ts';
import type { OpenPosition } from './indexer.ts';

export const client = new SuiClient({ url: RPC });

export function loadKeypair(): Ed25519Keypair {
  const k = process.env.KEEPER_KEY;
  if (!k) throw new Error('set KEEPER_KEY (suiprivkey1...) to run live');
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
}

export async function redeem(kp: Ed25519Keypair, p: OpenPosition): Promise<string> {
  const tx = new Transaction();
  const key = tx.moveCall({
    target: `${PREDICT_PKG}::market_key::new`,
    arguments: [tx.pure.id(p.oracleId), tx.pure.u64(p.expiry), tx.pure.u64(p.strike), tx.pure.bool(p.isUp)],
  });
  tx.moveCall({
    target: `${PREDICT_PKG}::predict::redeem_permissionless`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(PREDICT_OBJ), tx.object(p.managerId), tx.object(p.oracleId), key, tx.pure.u64(p.qty), tx.object(CLOCK)],
  });
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } });
  if (res.effects?.status.status !== 'success') throw new Error(res.effects?.status.error ?? 'tx failed');
  return res.digest;
}
