import { NextResponse } from "next/server";
import { PREDICT_INDEXER, PREDICT_OBJECT } from "@/lib/config";

// Live BTC spot feed. Each Predict oracle streams a `spot` price (scaled 1e9)
// but only covers a sub-hour window, so we merge the recent BTC oracles into one
// continuous series. Read-only from the public indexer.
export const dynamic = "force-dynamic";

type Oracle = { oracle_id: string; underlying_asset: string; activated_at: number };

export async function GET() {
  try {
    const oRes = await fetch(
      `${PREDICT_INDEXER}/predicts/${PREDICT_OBJECT}/oracles?limit=12`,
      { cache: "no-store" }
    );
    if (!oRes.ok) {
      return NextResponse.json({ error: `oracles ${oRes.status}` }, { status: 502 });
    }
    const oracles: Oracle[] = await oRes.json();
    const ids = (Array.isArray(oracles) ? oracles : [])
      .filter((o) => o.underlying_asset === "BTC")
      .sort((a, b) => (b.activated_at ?? 0) - (a.activated_at ?? 0))
      .slice(0, 8)
      .map((o) => o.oracle_id);

    const lists = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(`${PREDICT_INDEXER}/oracles/${id}/prices?limit=500`, {
            cache: "no-store",
          });
          return r.ok ? await r.json() : [];
        } catch {
          return [];
        }
      })
    );

    const seen = new Set<number>();
    const merged: { t: number; v: number }[] = [];
    for (const list of lists) {
      for (const p of Array.isArray(list) ? list : []) {
        const t = Number(p.checkpoint_timestamp_ms);
        if (!t || p.spot == null || seen.has(t)) continue;
        seen.add(t);
        merged.push({ t, v: Number(p.spot) / 1e9 });
      }
    }
    merged.sort((a, b) => a.t - b.t);

    if (!merged.length) {
      return NextResponse.json({ series: [], current: null, count: 0 });
    }

    const MAX = 120;
    const step = Math.max(1, Math.floor(merged.length / MAX));
    const sampled = merged.filter((_, i) => i % step === 0 || i === merged.length - 1);
    const series = sampled.map((x) => ({
      t: new Date(x.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      v: Math.round(x.v),
    }));

    return NextResponse.json({
      series,
      current: Math.round(merged[merged.length - 1].v),
      count: merged.length,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 }
    );
  }
}
