import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC } from './config.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const VAULT_BUILD = resolve(__dir, '../../contracts/vault/build/plp_vault/bytecode_modules');

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
    loadModuleBytecode(`${VAULT_BUILD}/vault.mv`),
  ];

  // Full transitive dependency closure for plp_vault:
  //   plp_vault -> deepbook_predict, dusdc, MoveStdlib, Sui
  //   deepbook_predict -> deepbook, MoveStdlib, Sui
  //   deepbook -> token, MoveStdlib, Sui
  //   dusdc -> MoveStdlib, Sui
  // Match the exact dependency list from the original successful publish (digest 14CrPWS...).
  // deepbook must be at 0x74cd56... (v19 on testnet) not the source-level 0xfb28c4... (v1).
  // predict was compiled against the v19 deepbook, so the validator enforces it here.
  const dependencies = [
    '0x0000000000000000000000000000000000000000000000000000000000000001', // MoveStdlib
    '0x0000000000000000000000000000000000000000000000000000000000000002', // Sui framework
    '0x74cd5657843c627f3d80f713b71e9f895bbbeb470956d8a8e1185badf6cc77c8', // deepbook (v19 on testnet)
    '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138', // deepbook_predict
    '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a', // dusdc
    '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8', // token
  ];

  const kp = loadKeypair();
  console.log('Sender:', kp.toSuiAddress());

  const tx = new Transaction();
  tx.setSender(kp.toSuiAddress());
  tx.setGasBudget(200_000_000);

  const [upgradeCap] = tx.publish({ modules, dependencies });
  tx.transferObjects([upgradeCap], kp.toSuiAddress());

  const result = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
    requestType: 'WaitForLocalExecution',
  });

  console.log('\nPublish digest:', result.digest);
  console.log('Status:', result.effects?.status.status);
  if (result.effects?.status.status !== 'success') {
    console.error('Error:', JSON.stringify(result.effects?.status, null, 2));
    process.exit(1);
  }

  const created = result.objectChanges?.filter((c) => c.type === 'created') ?? [];
  const pkg = result.objectChanges?.find((c) => c.type === 'published');
  const pkgId = (pkg as any)?.packageId ?? 'unknown';
  console.log('\nPackage ID:', pkgId);

  for (const obj of created) {
    const o = obj as any;
    console.log(`  created: ${o.objectId}  type: ${o.objectType}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
