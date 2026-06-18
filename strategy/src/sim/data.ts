import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data');
export const SCALE = 1_000_000_000;
export const USDC = 1_000_000;

export const num = (x: unknown): number => (x == null ? 0 : Number(x));

export interface Mint {
  oracle_id: string;
  strike: string | number;
  is_up: boolean;
  quantity: string | number;
  cost: string | number;
  ask_price: string | number;
  checkpoint_timestamp_ms: number;
}
export interface Oracle {
  oracle_id: string;
  status: string;
  settlement_price?: string | number | null;
  expiry: number;
  activated_at?: number;
  settled_at?: number;
}
export interface Redeem {
  oracle_id: string;
  payout: string | number;
  is_settled: boolean;
}

const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(DATA, f), 'utf8')) as T;

export type Tenor = '15m' | 'daily' | 'weekly' | 'monthly' | 'unknown';
export function classifyTenor(o: Oracle): Tenor {
  const h = o.activated_at ? (o.expiry - o.activated_at) / 3_600_000 : 0;
  return h <= 0 ? 'unknown' : h < 3 ? '15m' : h < 36 ? 'daily' : h < 240 ? 'weekly' : 'monthly';
}

export interface Loaded {
  mints: Mint[];
  oracles: Oracle[];
  reds: Redeem[];
  settle: Map<string, number>;
  settledAt: Map<string, number>;
  tenorOf: Map<string, Tenor>;
}
export function loadAll(): Loaded {
  const mints = read<Mint[]>('positions_minted.json');
  const oracles = read<Oracle[]>('oracles.json');
  const reds = read<Redeem[]>('positions_redeemed.json');
  const settle = new Map<string, number>();
  const settledAt = new Map<string, number>();
  const tenorOf = new Map<string, Tenor>();
  for (const o of oracles) {
    if (o.status === 'settled' && o.settlement_price != null) settle.set(o.oracle_id, num(o.settlement_price));
    if (o.settled_at) settledAt.set(o.oracle_id, num(o.settled_at));
    tenorOf.set(o.oracle_id, classifyTenor(o));
  }
  return { mints, oracles, reds, settle, settledAt, tenorOf };
}

export const won = (isUp: boolean, strike: number, S: number): boolean => (isUp ? S > strike : S <= strike);

export const fmt = (x: number): string => `$${x.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export interface OAgg {
  id: string;
  pnl: number;
  prem: number;
  maxpay: number;
  tenor: Tenor;
  t: number;
}

export function perOracle(l: Loaded): OAgg[] {
  const m = new Map<string, OAgg>();
  for (const mt of l.mints) {
    const S = l.settle.get(mt.oracle_id);
    if (S === undefined) continue;
    const a = m.get(mt.oracle_id) ?? {
      id: mt.oracle_id,
      pnl: 0,
      prem: 0,
      maxpay: 0,
      tenor: l.tenorOf.get(mt.oracle_id) ?? 'unknown',
      t: l.settledAt.get(mt.oracle_id) ?? mt.checkpoint_timestamp_ms,
    };
    const qty = num(mt.quantity) / USDC;
    a.prem += num(mt.cost) / USDC;
    a.maxpay += qty;
    a.pnl += num(mt.cost) / USDC - (won(mt.is_up, num(mt.strike), S) ? qty : 0);
    m.set(mt.oracle_id, a);
  }
  return [...m.values()].filter((o) => o.prem > 0).sort((a, b) => a.t - b.t);
}
