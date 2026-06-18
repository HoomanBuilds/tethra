import { INDEXER, PREDICT_OBJ } from './config.ts';

const get = async (path: string): Promise<any[]> => {
  const r = await fetch(`${INDEXER}${path}`);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return (await r.json()) as any[];
};
const num = (x: unknown): number => Number(x ?? 0);

export interface OpenPosition {
  managerId: string;
  oracleId: string;
  expiry: number;
  strike: number;
  isUp: boolean;
  qty: number;
  settlement: number;
  isWinner: boolean;
}

interface SettledOracle {
  settlement: number;
  expiry: number;
}

async function settledOracles(): Promise<Map<string, SettledOracle>> {
  const oracles = await get(`/predicts/${PREDICT_OBJ}/oracles?limit=100000`);
  const m = new Map<string, SettledOracle>();
  for (const o of oracles) {
    if (o.status === 'settled' && o.settlement_price != null) {
      m.set(o.oracle_id, { settlement: num(o.settlement_price), expiry: num(o.expiry) });
    }
  }
  return m;
}

const keyOf = (e: any): string => `${e.manager_id}|${e.oracle_id}|${num(e.expiry)}|${num(e.strike)}|${e.is_up}`;

export async function openSettledPositions(): Promise<OpenPosition[]> {
  const [settled, minted, redeemed] = await Promise.all([
    settledOracles(),
    get('/positions/minted?limit=100000'),
    get('/positions/redeemed?limit=100000'),
  ]);

  const net = new Map<string, OpenPosition>();
  for (const m of minted) {
    const s = settled.get(m.oracle_id);
    if (!s) continue;
    const k = keyOf(m);
    const isUp = m.is_up === true;
    const strike = num(m.strike);
    const cur = net.get(k) ?? {
      managerId: m.manager_id,
      oracleId: m.oracle_id,
      expiry: s.expiry,
      strike,
      isUp,
      qty: 0,
      settlement: s.settlement,
      isWinner: isUp ? s.settlement > strike : s.settlement <= strike,
    };
    cur.qty += num(m.quantity);
    net.set(k, cur);
  }
  for (const r of redeemed) {
    const k = keyOf(r);
    const cur = net.get(k);
    if (cur) cur.qty -= num(r.quantity);
  }

  return [...net.values()].filter((p) => p.qty > 0);
}
