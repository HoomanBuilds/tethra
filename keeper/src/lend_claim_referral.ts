import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { RPC } from './config.ts';

// Tier-2 referral keeper: for each lend pool, claim the accrued margin
// referral fees (owner-gated to the deployer) and compound them straight back
// into the vault's position via `compound` — lifting NAV for every depositor.
// Each pool is dry-run-gated, so pools with nothing to claim are skipped.

const PKG = need('NEW_PKG');
const SUI_VAULT = need('SUI_VAULT');
const DBUSDC_VAULT = need('DBUSDC_VAULT');
const SUI_REFERRAL = need('SUI_REFERRAL');
const DBUSDC_REFERRAL = need('DBUSDC_REFERRAL');

const MARGIN = '0xb8620c24c9ea1a4a41e79613d2b3d1d93648d1bb6f6b789a7c8f261c94110e4b';
const REGISTRY = '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75';
const SUI_POOL = '0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea';
const DBUSDC_POOL = '0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d';
const SUI_TYPE = '0x2::sui::SUI';
const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
const CLOCK = '0x6';

const POOLS = [
  { name: 'SUI', module: 'lend_vault', vault: SUI_VAULT, pool: SUI_POOL, referral: SUI_REFERRAL, type: SUI_TYPE },
  { name: 'DBUSDC', module: 'lend_vault_dbusdc', vault: DBUSDC_VAULT, pool: DBUSDC_POOL, referral: DBUSDC_REFERRAL, type: DBUSDC_TYPE },
];

const client = new SuiClient({ url: RPC });

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k} env var`);
  return v;
}
function loadKeypair(): Ed25519Keypair {
  const k = process.env.KEEPER_KEY;
  if (!k) throw new Error('set KEEPER_KEY env var');
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
}

function buildTx(p: (typeof POOLS)[number]): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    package: MARGIN, module: 'margin_pool', function: 'withdraw_referral_fees',
    typeArguments: [p.type],
    arguments: [tx.object(p.pool), tx.object(REGISTRY), tx.object(p.referral)],
  });
  tx.moveCall({
    package: PKG, module: p.module, function: 'compound',
    arguments: [tx.object(p.vault), tx.object(p.pool), tx.object(REGISTRY), coin, tx.object(CLOCK)],
  });
  return tx;
}

async function main() {
  const kp = loadKeypair();
  console.log('Sender:', kp.toSuiAddress());

  for (const p of POOLS) {
    const tx = buildTx(p);
    tx.setSender(kp.toSuiAddress());
    const dry = await client.dryRunTransactionBlock({ transactionBlock: await tx.build({ client }) });
    if (dry.effects.status.status !== 'success') {
      console.log(`${p.name}: nothing to claim (${dry.effects.status.error ?? 'skip'})`);
      continue;
    }
    const res = await client.signAndExecuteTransaction({
      signer: kp,
      transaction: tx,
      options: { showEffects: true },
      requestType: 'WaitForLocalExecution',
    });
    console.log(`${p.name}: claimed + compounded`, res.digest, res.effects?.status.status);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
