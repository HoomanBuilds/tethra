import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { RPC } from './config.ts';

const PKG = '0x267106787142584a4d9ce16c461b2f525a880634198fb8bb73eb63e252489b93';
const ADMIN_CAP = '0x164a48b3094f79bae3fe786d2dba5dcb1f218c18ce7197356b821acdbdc13100';
const VAULT = '0xccc2def235d38953bfaadc8c5420221149c42d131fb4ae148e7a7dd229f24856';
const REGISTRY = '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75';
const CLOCK = '0x6';

const client = new SuiClient({ url: RPC });

function loadKeypair(): Ed25519Keypair {
  const k = process.env.KEEPER_KEY;
  if (!k) throw new Error('set KEEPER_KEY env var');
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
}

async function main() {
  const kp = loadKeypair();
  console.log('Sender:', kp.toSuiAddress());

  const tx = new Transaction();
  tx.setSender(kp.toSuiAddress());

  tx.moveCall({
    package: PKG,
    module: 'lend_vault_dbusdc',
    function: 'initialize',
    arguments: [
      tx.object(ADMIN_CAP),
      tx.object(VAULT),
      tx.object(REGISTRY),
      tx.object(CLOCK),
    ],
  });

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

  console.log('\nInitialize digest:', result.digest);
  console.log('Status:', result.effects?.status.status);

  if (result.effects?.status.status !== 'success') {
    console.error('Error:', result.effects?.status.error);
    process.exit(1);
  }

  console.log('DBUSDC vault initialized successfully');
}

main().catch((e) => { console.error(e); process.exit(1); });
