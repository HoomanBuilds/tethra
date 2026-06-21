import { loadAll, perOracle, fmt } from './data.ts';

const os = perOracle(loadAll());
const premium = os.reduce((a, o) => a + o.prem, 0);
const profit = os.reduce((a, o) => a + o.pnl, 0);
const ts = os.map((o) => o.t).filter((x) => x > 0);
const days = (Math.max(...ts) - Math.min(...ts)) / 86_400_000;
const annualPremium = (premium / days) * 365;
const edge = profit / premium;
const poolTVL = 1_015_414;

console.log('═══ VAULT ECONOMICS (grounded in measured house performance) ═══\n');
console.log(`measured: ${days.toFixed(0)}d, premium ${fmt(premium)}, house profit ${fmt(profit)}, edge ${(100 * edge).toFixed(1)}%`);
console.log(`annualized: premium ${fmt(annualPremium)}/yr, profit ${fmt(annualPremium * edge)}/yr on ${fmt(poolTVL)} pool`);
console.log(`current pool yield: ${(100 * (annualPremium * edge) / poolTVL).toFixed(2)}% APR  (flow-limited)\n`);

const FEE = 0.1;
const MGMT = 0.0;
function depositorNet(volMult: number, edgeA: number, tvl: number): number {
  const annualProfit = annualPremium * volMult * edgeA;
  return (1 - FEE) * (annualProfit / tvl) - MGMT;
}
function vaultRev(volMult: number, edgeA: number, ourTVL: number, tvl: number): number {
  const annualProfit = annualPremium * volMult * edgeA;
  return FEE * (annualProfit / tvl) * ourTVL + MGMT * ourTVL;
}

console.log(`split model: ${(100 * FEE).toFixed(0)}% performance fee, ${(100 * MGMT).toFixed(1)}% mgmt fee. Depositor net APR & vault revenue (our TVL = pool):`);
console.log('volume×   edge      depositorNetAPR    vaultRevenue/yr');
for (const vm of [1, 5, 10, 25, 50, 100]) {
  for (const ea of [edge, 0.02]) {
    const dn = depositorNet(vm, ea, poolTVL);
    const vr = vaultRev(vm, ea, poolTVL, poolTVL);
    console.log(`  ${String(vm).padStart(3)}×   ${(100 * ea).toFixed(1)}%      ${(100 * dn).toFixed(2).padStart(7)}% APR      ${fmt(vr).padStart(12)}/yr`);
  }
}

const targets = [0.05, 0.1];
console.log('\nbreakeven flow needed (at measured edge, depositor net target):');
for (const t of targets) {
  const vm = (t / (1 - FEE)) / ((annualPremium * edge) / poolTVL);
  console.log(`  depositor net ${(100 * t).toFixed(0)}% APR  →  needs ~${vm.toFixed(0)}× current volume (utilization)`);
}
console.log('\nkey: yield = spread × volume / TVL. Adding TVL without volume DILUTES yield;');
console.log('the vault must grow flow or stay capacity-capped. Fee revenue scales with volume, not TVL alone.');
