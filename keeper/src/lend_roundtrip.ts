import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { RPC } from './config.ts';

const LEND_PKG = '0xc61b07b4d84e93be8d8c033f8a52c35d594bbeb486f832d67744d0b83a357d6d';
const LEND_VAULT = '0xea490c338eb9709147b913fdcdf44c1b928f79c01419f8fbc50f9254e71e3cd8';
const SUI_POOL = '0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea';
const REGISTRY = '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75';
const CLOCK = '0x6';
const DEPOSIT_MIST = 100_000_000n; // 0.1 SUI

const client = new SuiClient({ url: RPC });

const k = process.env.KEEPER_KEY;
if (!k) throw new Error('set KEEPER_KEY env var');
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
const sender = kp.toSuiAddress();

const tx = new Transaction();
tx.setSender(sender);

const [coinIn] = tx.splitCoins(tx.gas, [tx.pure.u64(DEPOSIT_MIST)]);

const [shareToken] = tx.moveCall({
  target: `${LEND_PKG}::lend_vault::deposit`,
  typeArguments: [],
  arguments: [
    tx.object(LEND_VAULT),
    tx.object(SUI_POOL),
    tx.object(REGISTRY),
    coinIn,
    tx.object(CLOCK),
  ],
});

tx.transferObjects([shareToken], sender);

const built = await tx.build({ client });

const dryResult = await client.dryRunTransactionBlock({
  transactionBlock: built,
});

console.log('Deposit dry-run status:', dryResult.effects.status.status);
if (dryResult.effects.status.status !== 'success') {
  console.error('Error:', dryResult.effects.status.error);
  process.exit(1);
}

const created = dryResult.objectChanges?.filter((c) => c.type === 'created') ?? [];
for (const obj of created) {
  const o = obj as any;
  if (o.objectType?.includes('LEND_VAULT')) {
    console.log('tlSUI share token would be created:', o.objectId, 'type:', o.objectType);
  }
}

const mutated = dryResult.objectChanges?.filter((c) => c.type === 'mutated') ?? [];
const vaultMutation = mutated.find((m) => (m as any).objectId === LEND_VAULT);
if (vaultMutation) {
  console.log('LendVault mutated - deposit accepted');
}

console.log('\nDeposit dry-run PASSED: 0.1 SUI -> tlSUI shares');
