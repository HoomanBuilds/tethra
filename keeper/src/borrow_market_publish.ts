import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC } from './config.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(
  __dir,
  '../../contracts/borrow_market/build/tethra_borrow_market/bytecode_modules',
);

const client = new SuiClient({ url: RPC });

function loadModuleBytecode(path: string): number[] {
  return Array.from(readFileSync(path));
}

function loadKeypair(): Ed25519Keypair {
  const k = process.env.KEEPER_KEY;
  if (!k) throw new Error('set KEEPER_KEY env var');
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
}

async function main() {
  const modules = [loadModuleBytecode(`${BUILD}/market.mv`)];

  // Transitive dependency closure for tethra_borrow_market:
  //   borrow_market -> plp_vault, deepbook_predict, dusdc
  //   plp_vault     -> deepbook_predict, dusdc
  //   deepbook_predict -> deepbook, token
  // Same closure as the vault publish, plus plp_vault. deepbook is the v19
  // object (0x74cd56...) predict was compiled against, not the source 0xfb28c4.
  const dependencies = [
    '0x0000000000000000000000000000000000000000000000000000000000000001', // MoveStdlib
    '0x0000000000000000000000000000000000000000000000000000000000000002', // Sui framework
    '0x74cd5657843c627f3d80f713b71e9f895bbbeb470956d8a8e1185badf6cc77c8', // deepbook v19
    '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138', // deepbook_predict
    '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a', // dusdc
    '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8', // token
    '0x2765b4a30258ef4660ec7d24fef8b0b32a700633c6dc1a57a80f988de6bc1d9e', // plp_vault
  ];

  const dryOnly = process.env.DRY_RUN === '1';
  const kp = dryOnly ? null : loadKeypair();
  const sender = dryOnly ? (process.env.SENDER as string) : kp!.toSuiAddress();
  console.log('Sender:', sender, dryOnly ? '(dry-run only)' : '');

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(300_000_000);

  const [upgradeCap] = tx.publish({ modules, dependencies });
  tx.transferObjects([upgradeCap], sender);

  const dry = await client.dryRunTransactionBlock({
    transactionBlock: await tx.build({ client }),
  });
  console.log('Dry-run status:', dry.effects.status.status);
  if (dry.effects.status.status !== 'success') {
    console.error('Dry-run error:', dry.effects.status.error);
    process.exit(1);
  }
  if (dryOnly) { console.log('Dry-run OK — ready to publish (run without DRY_RUN to sign).'); return; }

  const result = await client.signAndExecuteTransaction({
    signer: kp!,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
    requestType: 'WaitForLocalExecution',
  });

  console.log('\nPublish digest:', result.digest);
  console.log('Status:', result.effects?.status.status);

  const pkgId =
    (result.objectChanges?.find((c) => c.type === 'published') as any)?.packageId ?? 'unknown';
  console.log('\nPackage ID:', pkgId);
  const created = result.objectChanges?.filter((c) => c.type === 'created') ?? [];
  for (const obj of created) {
    const o = obj as any;
    console.log(`  created: ${o.objectId}  type: ${o.objectType}`);
  }

  const market = created.find((c) => (c as any).objectType?.endsWith('::market::Market')) as any;
  const adminCap = created.find((c) => (c as any).objectType?.endsWith('::market::AdminCap')) as any;
  if (!market || !adminCap) {
    console.error('Could not find Market / AdminCap in object changes.');
    return;
  }

  // Link the market to the live Tethra Predict vault (sets vault_id).
  const VAULT_ID = '0x21528665ba5731f9ffa2a7fe3024f87b77b86660a615118e2e3d1d150299aeb0';
  const initTx = new Transaction();
  initTx.setSender(sender);
  initTx.moveCall({
    target: `${pkgId}::market::initialize`,
    arguments: [
      initTx.object(adminCap.objectId),
      initTx.object(market.objectId),
      initTx.object(VAULT_ID),
    ],
  });
  const initRes = await client.signAndExecuteTransaction({
    signer: kp!,
    transaction: initTx,
    options: { showEffects: true },
    requestType: 'WaitForLocalExecution',
  });
  console.log('\nInitialize digest:', initRes.digest, '|', initRes.effects?.status.status);

  console.log('\n=== RECORD THESE ===');
  console.log('package   :', pkgId);
  console.log('market    :', market.objectId);
  console.log('adminCap  :', adminCap.objectId);
  console.log('tpUSDCType :', `${pkgId}::market::MARKET`);
}

main().catch((e) => { console.error(e); process.exit(1); });
