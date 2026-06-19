import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC } from './config.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const LEND_BUILD = resolve(__dir, '../../contracts/lend/build/tethra_lend/bytecode_modules');

const client = new SuiClient({ url: RPC });

function loadModuleBytecode(path: string): number[] {
  const buf = readFileSync(path);
  return Array.from(buf);
}

function loadKeypair(): Ed25519Keypair {
  const k = process.env.KEEPER_KEY;
  if (!k) throw new Error('set KEEPER_KEY env var');
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
}

async function main() {
  const modules = [
    loadModuleBytecode(`${LEND_BUILD}/lend_vault.mv`),
  ];

  // Full transitive dependency closure required by the Sui validator.
  // lend_vault links to deepbook_margin v1 (original-id) so the registry version
  // check passes: v1's margin_version()=1 is in allowed_versions=["1"].
  // deepbook_margin v1 links to: deepbook v17, token v1, Pyth v1, Wormhole v1
  const dependencies = [
    '0x0000000000000000000000000000000000000000000000000000000000000001', // MoveStdlib
    '0x0000000000000000000000000000000000000000000000000000000000000002', // Sui framework
    '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8', // token v1
    '0xabf837e98c26087cba0883c0a7a28326b1fa3c5e1e2c5abdb486f9e8f594c837', // Pyth testnet v1
    '0xf47329f4344f3bf0f8e436e2f7b485466cff300f12a166563995d3888c296a94', // Wormhole testnet v1
    '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c', // deepbook v17
    '0xb8620c24c9ea1a4a41e79613d2b3d1d93648d1bb6f6b789a7c8f261c94110e4b', // deepbook_margin v1 (original)
  ];

  const kp = loadKeypair();
  console.log('Sender:', kp.toSuiAddress());

  const tx = new Transaction();
  tx.setSender(kp.toSuiAddress());

  const [upgradeCap] = tx.publish({ modules, dependencies });
  tx.transferObjects([upgradeCap], kp.toSuiAddress());

  const dryResult = await client.dryRunTransactionBlock({
    transactionBlock: await tx.build({ client }),
  });

  console.log('Dry-run status:', dryResult.effects.status.status);
  if (dryResult.effects.status.status !== 'success') {
    console.error('Dry-run error:', dryResult.effects.status.error);
    process.exit(1);
  }

  const result = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
    requestType: 'WaitForLocalExecution',
  });

  console.log('\nPublish digest:', result.digest);
  console.log('Status:', result.effects?.status.status);

  const created = result.objectChanges?.filter((c) => c.type === 'created') ?? [];
  const pkg = created.find((c) => c.type === 'created' && (c as any).objectType === 'package');
  const pkgId = (pkg as any)?.objectId ?? 'unknown';
  console.log('\nPackage ID:', pkgId);

  for (const obj of created) {
    const o = obj as any;
    console.log(`  created: ${o.objectId}  type: ${o.objectType}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
