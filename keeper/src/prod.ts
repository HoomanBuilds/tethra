import { spawn, type ChildProcess } from 'node:child_process';

// Production runner: every long-lived keeper daemon as its own process.
// Redeem keeper (keeps NAV current) + liquidator (Tier-3 safety).
// Excludes tests/roundtrip/publish/init. Children inherit KEEPER_KEY from this
// process, so run via `npm run prod` (which loads .env).
const DAEMONS = [
  { name: 'keeper', script: 'src/keeper.ts' },
  { name: 'liquidator', script: 'src/liquidator.ts' },
];

const children: ChildProcess[] = [];
let stopping = false;

function stopAll(code: number) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500);
}

for (const { name, script } of DAEMONS) {
  // Spawn node with the tsx loader directly (not the `tsx` wrapper), so the
  // daemon IS this process: one SIGTERM stops it, with no orphaned grandchild.
  const child = spawn(process.execPath, ['--import', 'tsx', script], { env: process.env });
  children.push(child);
  const tag = (b: Buffer, out: NodeJS.WriteStream) => {
    for (const line of b.toString().split('\n')) if (line) out.write(`[${name}] ${line}\n`);
  };
  child.stdout?.on('data', (b) => tag(b, process.stdout));
  child.stderr?.on('data', (b) => tag(b, process.stderr));
  child.on('error', (e) => {
    console.error(`[prod] ${name} failed to start: ${e.message}`);
    stopAll(1);
  });
  child.on('exit', (code) => {
    console.error(`[prod] ${name} exited (code ${code}); stopping all daemons`);
    stopAll(code ?? 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
console.log(`[prod] running ${DAEMONS.map((d) => d.name).join(' + ')}. Ctrl-C stops all.`);
