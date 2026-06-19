import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC } from './config.ts';

const dep = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../deployments/testnet.json'), 'utf8'),
);
const VPKG = dep.plpVault.package as string;
const VAULT = dep.plpVault.vault as string;
const PREDICT = dep.linkedProtocol.predictObject as string;
const DUSDC = dep.linkedProtocol.dusdcType as string;
const CLOCK = '0x6';

const client = new SuiClient({ url: RPC });
const usd = (raw: bigint | number) => `$${(Number(raw) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 })}`;

async function vaultState() {
  const o = await client.getObject({ id: VAULT, options: { showContent: true } });
  const f = (o.data?.content as any)?.fields ?? {};
  const plp = f.plp ?? '0';
  const supply = f.shares?.fields?.total_supply?.fields?.value ?? f.shares?.fields?.total_supply ?? '?';
  console.log(`vault ${VAULT}`);
  console.log(`  plp held: ${plp}  shares: ${supply}  cost_basis: ${usd(Number(f.cost_basis ?? 0))}  fee_bps: ${f.fee_bps}  deposit_cap: ${f.deposit_cap}`);
}

async function main() {
  console.log(`=== Tethra Predict vault round-trip (testnet) ===`);
  console.log(`package ${VPKG}`);
  await vaultState();

  const key = process.env.DEPLOYER_KEY;
  if (!key) {
    console.log('\nread-only: set DEPLOYER_KEY=<suiprivkey> and fund the wallet with DUSDC to execute deposit/withdraw.');
    return;
  }
  const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
  const addr = kp.getPublicKey().toSuiAddress();
  const coins = await client.getCoins({ owner: addr, coinType: DUSDC });
  const total = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
  console.log(`\ndeployer ${addr}  DUSDC ${usd(total)}`);
  if (total === 0n) {
    console.log('no DUSDC yet — request from the Tally faucet, then re-run.');
    return;
  }
  const DEPOSIT = 50_000_000n; // 50 DUSDC (6 decimals)
  const amount = total >= DEPOSIT ? DEPOSIT : total;

  const dtx = new Transaction();
  const src = coins.data[0].coinObjectId;
  const [dcoin] = dtx.splitCoins(dtx.object(src), [amount]);
  const shares = dtx.moveCall({ target: `${VPKG}::vault::deposit`, arguments: [dtx.object(VAULT), dtx.object(PREDICT), dcoin, dtx.object(CLOCK)] });
  dtx.transferObjects([shares], addr);
  const dr = await client.signAndExecuteTransaction({ signer: kp, transaction: dtx, options: { showEffects: true, showBalanceChanges: true } });
  if (dr.effects?.status.status !== 'success') throw new Error(`deposit failed: ${dr.effects?.status.error}`);
  console.log(`deposit ${usd(amount)} → ${dr.digest}`);
  await vaultState();

  const shareCoins = await client.getCoins({ owner: addr, coinType: `${VPKG}::vault::VAULT` });
  const shareTotal = shareCoins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
  console.log(`shares held: ${shareTotal}`);

  const wtx = new Transaction();
  const sc = shareCoins.data[0].coinObjectId;
  const out = wtx.moveCall({ target: `${VPKG}::vault::withdraw`, arguments: [wtx.object(VAULT), wtx.object(PREDICT), wtx.object(sc), wtx.object(CLOCK)] });
  wtx.transferObjects([out], addr);
  const wr = await client.signAndExecuteTransaction({ signer: kp, transaction: wtx, options: { showEffects: true, showBalanceChanges: true } });
  if (wr.effects?.status.status !== 'success') throw new Error(`withdraw failed: ${wr.effects?.status.error}`);
  console.log(`withdraw all shares → ${wr.digest}`);
  const back = (wr.balanceChanges ?? []).find((b) => b.coinType === DUSDC);
  console.log(`DUSDC returned: ${back ? usd(BigInt(back.amount)) : '?'}`);
  await vaultState();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
