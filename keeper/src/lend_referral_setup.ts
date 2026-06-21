import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { RPC } from './config.ts';

// One-shot Tier-2 referral setup after a fresh lend redeploy:
//   1. initialize both vaults (mint their SupplierCap)
//   2. mint a SupplyReferral on each margin pool (owner = deployer)
//   3. set_referral on each vault so deposits route through our referral
// Run after lend_dbusdc_publish.ts; pass the new ids via env.

// New deployment (from the publish output):
const PKG = need('NEW_PKG');
const SUI_VAULT = need('SUI_VAULT');
const SUI_ADMINCAP = need('SUI_ADMINCAP');
const DBUSDC_VAULT = need('DBUSDC_VAULT');
const DBUSDC_ADMINCAP = need('DBUSDC_ADMINCAP');

// External, unchanged.
const MARGIN = '0xb8620c24c9ea1a4a41e79613d2b3d1d93648d1bb6f6b789a7c8f261c94110e4b';
const REGISTRY = '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75';
const SUI_POOL = '0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea';
const DBUSDC_POOL = '0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d';
const SUI_TYPE = '0x2::sui::SUI';
const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';
const CLOCK = '0x6';

const client = new SuiClient({ url: RPC });

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k} env var (from the publish output)`);
  return v;
}

function loadKeypair(): Ed25519Keypair {
  const k = process.env.KEEPER_KEY;
  if (!k) throw new Error('set KEEPER_KEY env var');
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(k).secretKey);
}

async function run(kp: Ed25519Keypair, tx: Transaction, label: string) {
  tx.setSender(kp.toSuiAddress());
  const dry = await client.dryRunTransactionBlock({ transactionBlock: await tx.build({ client }) });
  if (dry.effects.status.status !== 'success') {
    console.error(`${label} dry-run failed:`, dry.effects.status.error);
    process.exit(1);
  }
  const res = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
    requestType: 'WaitForLocalExecution',
  });
  console.log(`${label}:`, res.digest, res.effects?.status.status);
  if (res.effects?.status.status !== 'success') process.exit(1);
  return res;
}

async function main() {
  const kp = loadKeypair();
  console.log('Sender:', kp.toSuiAddress());

  // 1 + 2: initialize both vaults and mint a referral on each pool, one tx.
  const tx1 = new Transaction();
  tx1.moveCall({
    package: PKG, module: 'lend_vault', function: 'initialize',
    arguments: [tx1.object(SUI_ADMINCAP), tx1.object(SUI_VAULT), tx1.object(REGISTRY), tx1.object(CLOCK)],
  });
  tx1.moveCall({
    package: PKG, module: 'lend_vault_dbusdc', function: 'initialize',
    arguments: [tx1.object(DBUSDC_ADMINCAP), tx1.object(DBUSDC_VAULT), tx1.object(REGISTRY), tx1.object(CLOCK)],
  });
  tx1.moveCall({
    package: MARGIN, module: 'margin_pool', function: 'mint_supply_referral',
    typeArguments: [SUI_TYPE],
    arguments: [tx1.object(SUI_POOL), tx1.object(REGISTRY), tx1.object(CLOCK)],
  });
  tx1.moveCall({
    package: MARGIN, module: 'margin_pool', function: 'mint_supply_referral',
    typeArguments: [DBUSDC_TYPE],
    arguments: [tx1.object(DBUSDC_POOL), tx1.object(REGISTRY), tx1.object(CLOCK)],
  });
  const r1 = await run(kp, tx1, 'init + mint referrals');

  // Map each pool to its freshly minted SupplyReferral id via the emitted event.
  const referralByPool: Record<string, string> = {};
  for (const ev of r1.events ?? []) {
    if (ev.type.endsWith('::margin_pool::SupplyReferralMinted')) {
      const j = ev.parsedJson as { margin_pool_id: string; supply_referral_id: string };
      referralByPool[j.margin_pool_id] = j.supply_referral_id;
    }
  }
  const suiReferral = referralByPool[SUI_POOL];
  const dbusdcReferral = referralByPool[DBUSDC_POOL];
  if (!suiReferral || !dbusdcReferral) {
    console.error('could not read referral ids from events:', referralByPool);
    process.exit(1);
  }

  // 3: point each vault at its referral.
  const tx2 = new Transaction();
  tx2.moveCall({
    package: PKG, module: 'lend_vault', function: 'set_referral',
    arguments: [tx2.object(SUI_ADMINCAP), tx2.object(SUI_VAULT), tx2.pure.id(suiReferral)],
  });
  tx2.moveCall({
    package: PKG, module: 'lend_vault_dbusdc', function: 'set_referral',
    arguments: [tx2.object(DBUSDC_ADMINCAP), tx2.object(DBUSDC_VAULT), tx2.pure.id(dbusdcReferral)],
  });
  await run(kp, tx2, 'set referrals');

  console.log('\n=== referral setup complete ===');
  console.log(JSON.stringify({ suiReferral, dbusdcReferral }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
