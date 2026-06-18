import { openSettledPositions, type OpenPosition } from './indexer.ts';
import { POLL_MS, MAX_REDEEMS_PER_TICK } from './config.ts';

const DRY = process.argv.includes('--dry');
const ONCE = process.argv.includes('--once');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (raw: number) => `$${(raw / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const price = (raw: number) => `$${(raw / 1e9).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

async function tick(): Promise<void> {
  const open = await openSettledPositions();
  const winners = open.filter((p) => p.isWinner);
  const owed = winners.reduce((a, p) => a + p.qty, 0);
  console.log(`[${new Date().toISOString()}] settled-open positions: ${open.length} | winners ${winners.length} owed ${usd(owed)}`);

  if (DRY) {
    for (const p of [...winners].sort((a, b) => b.qty - a.qty).slice(0, 10)) {
      console.log(`  WIN  ${p.isUp ? 'UP ' : 'DN '} strike ${price(p.strike)} settle ${price(p.settlement)} qty ${usd(p.qty)} mgr ${p.managerId.slice(0, 10)}…`);
    }
    return;
  }

  const { loadKeypair, redeem } = await import('./redeem.ts');
  const kp = loadKeypair();
  const targets: OpenPosition[] = [...winners, ...open.filter((p) => !p.isWinner)].slice(0, MAX_REDEEMS_PER_TICK);
  let done = 0;
  for (const p of targets) {
    try {
      const digest = await redeem(kp, p);
      done++;
      console.log(`  redeemed ${p.isUp ? 'UP' : 'DN'} ${price(p.strike)} qty ${usd(p.qty)} → ${digest}`);
    } catch (e) {
      console.warn(`  skip ${p.oracleId.slice(0, 10)}…: ${(e as Error).message}`);
    }
  }
  console.log(`  redeemed ${done}/${targets.length} this tick`);
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
