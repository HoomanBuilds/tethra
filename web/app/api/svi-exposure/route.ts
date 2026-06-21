import { NextResponse } from "next/server";
import { PREDICT_INDEXER, PREDICT_OBJECT, RPC_URL } from "@/lib/config";
import { decodeSvi, upPrice, SCALE, type SviParams } from "@/lib/svi";

// Per-oracle PLP exposure: nets the public minted/redeemed position events into
// open positions, groups them by oracle (the house's book), and prices each with
// the on-chain SVI. Server-side; reconciled against the vault summary's
// total_max_payout (exposure) — the SVI engine drives the stress what-if client-side.
export const dynamic = "force-dynamic";

const num = (x: unknown) => Number(x ?? 0);
// Same identity the keeper uses to net positions.
const keyOf = (e: { manager_id: string; oracle_id: string; expiry: unknown; strike: unknown; is_up: unknown }) =>
  `${e.manager_id}|${e.oracle_id}|${num(e.expiry)}|${num(e.strike)}|${e.is_up}`;

async function getJ(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function multiGetObjects(ids: string[]) {
  const out: Array<{ data?: { objectId?: string; content?: { fields?: Record<string, unknown> } } }> = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_multiGetObjects",
        params: [ids.slice(i, i + 50), { showContent: true }],
      }),
    });
    const j = await r.json();
    out.push(...(j?.result ?? []));
  }
  return out;
}

type Position = { oracleId: string; strike: number; isUp: boolean; qty: number };
type Market = {
  oracleId: string;
  expiryMs: number;
  live: boolean;
  forward: number;
  svi: SviParams | null;
  maxPayout: number;
  nPos: number;
  nUp: number;
  expLiability: number;
};

export async function GET() {
  try {
    const [minted, redeemed, oracles, summary] = await Promise.all([
      getJ(`${PREDICT_INDEXER}/positions/minted?limit=100000`),
      getJ(`${PREDICT_INDEXER}/positions/redeemed?limit=100000`),
      getJ(`${PREDICT_INDEXER}/predicts/${PREDICT_OBJECT}/oracles?limit=100000`),
      getJ(`${PREDICT_INDEXER}/predicts/${PREDICT_OBJECT}/vault/summary`),
    ]);
    const now = Date.now();
    type Ora = { oracle_id: string; status?: string; expiry?: unknown };
    const oraById = new Map<string, Ora>(
      (Array.isArray(oracles) ? oracles : []).map(
        (o: Ora): [string, Ora] => [o.oracle_id, o],
      ),
    );

    // Net minted - redeemed into open positions, keep those on active oracles.
    const net = new Map<string, Position>();
    for (const m of Array.isArray(minted) ? minted : []) {
      const k = keyOf(m);
      const c = net.get(k) ?? { oracleId: m.oracle_id, strike: num(m.strike) / SCALE, isUp: m.is_up === true, qty: 0 };
      c.qty += num(m.quantity);
      net.set(k, c);
    }
    for (const r of Array.isArray(redeemed) ? redeemed : []) {
      const c = net.get(keyOf(r));
      if (c) c.qty -= num(r.quantity);
    }
    const open = [...net.values()].filter(
      (p) => p.qty > 0 && oraById.get(p.oracleId)?.status === "active",
    );

    // Pull SVI + forward for every oracle that carries exposure.
    const oracleIds = [...new Set(open.map((p) => p.oracleId))];
    const objs = await multiGetObjects(oracleIds);
    const sviById = new Map<string, { svi: SviParams; forward: number }>();
    for (const o of objs) {
      const f = o?.data?.content?.fields;
      const pr = (f?.prices as { fields?: { forward?: unknown } })?.fields;
      if (o?.data?.objectId && f?.svi && pr) {
        sviById.set(o.data.objectId, { svi: decodeSvi(f.svi), forward: num(pr.forward) / SCALE });
      }
    }

    // Aggregate per oracle and accumulate an SVI-fair expected liability.
    const mkts = new Map<string, Market>();
    for (const p of open) {
      const e = oraById.get(p.oracleId)!;
      const d = sviById.get(p.oracleId);
      const m =
        mkts.get(p.oracleId) ??
        {
          oracleId: p.oracleId,
          expiryMs: num(e.expiry),
          live: num(e.expiry) > now,
          forward: d?.forward ?? 0,
          svi: d?.svi ?? null,
          maxPayout: 0,
          nPos: 0,
          nUp: 0,
          expLiability: 0,
        };
      m.maxPayout += p.qty;
      m.nPos += 1;
      if (p.isUp) m.nUp += 1;
      if (d) {
        const u = upPrice(d.svi, d.forward, p.strike);
        m.expLiability += (p.isUp ? u : 1 - u) * p.qty;
      }
      mkts.set(p.oracleId, m);
    }
    const markets = [...mkts.values()].sort((a, b) => b.maxPayout - a.maxPayout);

    // Compact open positions on live oracles, for the client-side stress what-if.
    const positions = open
      .filter((p) => mkts.get(p.oracleId)?.live && sviById.has(p.oracleId))
      .map((p) => ({ o: p.oracleId, k: p.strike, up: p.isUp, q: p.qty }));

    const reconstructedMaxPayout = open.reduce((a, p) => a + p.qty, 0);
    const liveMaxPayout = markets.filter((m) => m.live).reduce((a, m) => a + m.maxPayout, 0);

    return NextResponse.json({
      markets,
      positions,
      baseline: {
        vaultValue: num(summary.vault_value),
        totalMaxPayout: num(summary.total_max_payout),
        totalMtm: num(summary.total_mtm),
        reconstructedMaxPayout,
        liveMaxPayout,
        spot: markets.find((m) => m.live)?.forward ?? null,
        openCount: open.length,
        marketCount: markets.length,
      },
      fetchedAt: now,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
