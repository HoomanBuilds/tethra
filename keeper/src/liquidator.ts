// Borrow-market liquidation keeper.
//
// Polls every open position in the tPLP/dUSDC market, asks the contract for each
// borrower's live LTV (the same `health_bps` figure `liquidate` re-checks on
// chain), and liquidates any position at or past the liquidation threshold
// (default 80% LTV). Liquidation is self-redeeming: the contract pulls the
// borrower's tPLP through the Tethra vault, repays the debt, and sends the 5%
// penalty to the market's `fee_treasury`. Run this from the fee_treasury address
// so the penalty accrues to the operator; third parties have no incentive.
//
//   npm run liquidator        # live loop (needs KEEPER_KEY + SUI gas)
//   npm run liquidator:dry    # read-only, lists who would be liquidated
import { Transaction } from '@mysten/sui/transactions';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { client, loadKeypair } from './redeem.ts';
import { BORROW_PKG, BORROW_MARKET, VAULT_ID, PREDICT_OBJ, CLOCK, POLL_MS } from './config.ts';

const DRY = process.argv.includes('--dry');
const ONCE = process.argv.includes('--once');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';

function tryKeeperAddr(): string | undefined {
  try {
    return loadKeypair().toSuiAddress();
  } catch {
    return undefined;
  }
}
// devInspect needs a well-formed sender; reads do not depend on who it is.
const READ_SENDER = process.env.SENDER ?? tryKeeperAddr() ?? ZERO;

function leU64(bytes?: number[]): bigint {
  if (!bytes) return 0n;
  let r = 0n;
  for (let i = 0; i < 8 && i < bytes.length; i++) r |= BigInt(bytes[i]) << BigInt(8 * i);
  return r;
}

async function readMarket(): Promise<{ liqThreshold: number; positionsTableId: string }> {
  const o = await client.getObject({ id: BORROW_MARKET, options: { showContent: true } });
  const f = (o.data?.content as any)?.fields;
  if (!f) throw new Error(`market ${BORROW_MARKET} not found`);
  return { liqThreshold: Number(f.liq_threshold_bps), positionsTableId: f.positions.fields.id.id };
}

async function listBorrowers(positionsTableId: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await client.getDynamicFields({ parentId: positionsTableId, cursor });
    for (const f of page.data) {
      const v = (f.name as any)?.value;
      if (typeof v === 'string') out.push(v);
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return out;
}

// One devInspect per chunk: health_bps(market, vault, who) -> LTV in bps.
async function healthOf(addrs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const CHUNK = 25;
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const chunk = addrs.slice(i, i + CHUNK);
    const tx = new Transaction();
    for (const a of chunk) {
      tx.moveCall({
        target: `${BORROW_PKG}::market::health_bps`,
        arguments: [tx.object(BORROW_MARKET), tx.object(VAULT_ID), tx.pure.address(a)],
      });
    }
    const res = await client.devInspectTransactionBlock({ sender: READ_SENDER, transactionBlock: tx });
    const results = res.results ?? [];
    chunk.forEach((a, j) => {
      const bytes = results[j]?.returnValues?.[0]?.[0] as number[] | undefined;
      out.set(a, Number(leU64(bytes)));
    });
  }
  return out;
}

async function liquidate(kp: Ed25519Keypair, borrower: string): Promise<string> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${BORROW_PKG}::market::liquidate`,
    arguments: [
      tx.object(BORROW_MARKET),
      tx.pure.address(borrower),
      tx.object(VAULT_ID),
      tx.object(PREDICT_OBJ),
      tx.object(CLOCK),
    ],
  });
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } });
  if (res.effects?.status.status !== 'success') throw new Error(res.effects?.status.error ?? 'tx failed');
  return res.digest;
}

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

async function tick(): Promise<void> {
  const ts = new Date().toISOString();
  const { liqThreshold, positionsTableId } = await readMarket();
  const addrs = await listBorrowers(positionsTableId);
  if (addrs.length === 0) {
    console.log(`[${ts}] borrow market: 0 open positions`);
    return;
  }
  const health = await healthOf(addrs);
  const targets = addrs.filter((a) => (health.get(a) ?? 0) >= liqThreshold);
  console.log(`[${ts}] positions ${addrs.length} | liquidatable ${targets.length} (threshold ${pct(liqThreshold)} LTV)`);

  if (DRY) {
    for (const a of targets) console.log(`  LIQ ${a} — LTV ${pct(health.get(a) ?? 0)}`);
    return;
  }
  if (targets.length === 0) return;

  const kp = loadKeypair();
  let done = 0;
  for (const a of targets) {
    try {
      const digest = await liquidate(kp, a);
      done++;
      console.log(`  liquidated ${a} (LTV ${pct(health.get(a) ?? 0)}) → ${digest}`);
    } catch (e) {
      console.warn(`  skip ${a}: ${(e as Error).message}`);
    }
  }
  console.log(`  liquidated ${done}/${targets.length} this tick`);
}

if (DRY || ONCE) {
  await tick();
} else {
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error(`tick error: ${(e as Error).message}`);
    }
    await sleep(POLL_MS);
  }
}
