import { NextResponse } from "next/server";
import { PREDICT_INDEXER, PREDICT_OBJECT, RPC_URL } from "@/lib/config";
import { buildSmile, strikeGrid, SCALE, type OracleSmile } from "@/lib/svi";

// Live SVI volatility surface: the active DeepBook Predict oracles (OracleSVI),
// read straight from chain and priced with the same engine the protocol uses.
// Server-side so the browser is not blocked by CORS and the numbers stay real.
export const dynamic = "force-dynamic";

// How many of the nearest live expiries to plot (keeps the surface legible).
const N_EXPIRIES = 8;
// Skip markets about to settle: with seconds left, implied vol diverges
// (iv = sqrt(w/T), T -> 0) and would dominate the scale. 5 minutes is a clean floor.
const MIN_TTL_MS = 5 * 60 * 1000;

type IndexerOracle = { oracle_id: string; status: string; expiry: string | number };

export async function GET() {
  try {
    const listRes = await fetch(
      `${PREDICT_INDEXER}/predicts/${PREDICT_OBJECT}/oracles?limit=2000`,
      { cache: "no-store" },
    );
    if (!listRes.ok) {
      return NextResponse.json({ error: `indexer ${listRes.status}` }, { status: 502 });
    }
    const list = (await listRes.json()) as IndexerOracle[];
    const now = Date.now();

    const live = (Array.isArray(list) ? list : []).filter(
      (o) => o.status === "active" && Number(o.expiry) > now + MIN_TTL_MS,
    );
    const nearest = [...live]
      .sort((a, b) => Number(a.expiry) - Number(b.expiry))
      .slice(0, N_EXPIRIES);

    if (nearest.length === 0) {
      return NextResponse.json({
        oracles: [],
        spot: null,
        underlying: "BTC",
        liveCount: live.length,
        fetchedAt: now,
      });
    }

    const ids = nearest.map((o) => o.oracle_id);
    const objRes = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_multiGetObjects",
        params: [ids, { showContent: true }],
      }),
    });
    const objJson = await objRes.json().catch(() => null);
    const results: Array<{ data?: { objectId?: string; content?: { fields?: Record<string, unknown> } } }> =
      objJson?.result ?? [];

    // Parse fields; pick the nearest valid spot as the reference for the shared
    // strike grid so every expiry overlays on the same x-axis.
    const parsed = results
      .map((r) => ({ id: r?.data?.objectId, fields: r?.data?.content?.fields }))
      .filter((r): r is { id: string; fields: Record<string, unknown> } => !!r.id && !!r.fields);

    const refSpot = parsed
      .map((p) => {
        const prices = (p.fields.prices as { fields?: { spot?: unknown } })?.fields;
        return prices ? Number(prices.spot) / SCALE : 0;
      })
      .find((s) => s > 0);

    if (!refSpot) {
      return NextResponse.json({
        oracles: [],
        spot: null,
        underlying: "BTC",
        liveCount: live.length,
        fetchedAt: now,
      });
    }

    const strikes = strikeGrid(refSpot);
    const oracles: OracleSmile[] = [];
    for (const p of parsed) {
      const built = buildSmile(p.id, p.fields, now, strikes);
      if (built) oracles.push(built);
    }
    oracles.sort((a, b) => a.tYears - b.tYears);

    // Calendar no-arbitrage: ATM total variance must be non-decreasing in tenor.
    const withChecks = oracles.map((o, i) => ({
      ...o,
      calendarOk: i === 0 ? true : o.atmVar >= oracles[i - 1].atmVar - 1e-9,
    }));

    return NextResponse.json({
      oracles: withChecks,
      spot: oracles[0]?.spot ?? refSpot,
      underlying: "BTC",
      liveCount: live.length,
      fetchedAt: now,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
