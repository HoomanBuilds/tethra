import { NextResponse } from "next/server";
import { PREDICT_INDEXER } from "@/lib/config";

// Live PLP NAV series. Each supply event embeds the share price at that moment
// (amount / shares_minted); the sequence of those is the PLP pool's NAV curve
// (the house's cumulative return). Read-only from the public indexer.
export const dynamic = "force-dynamic";

type Supply = { checkpoint_timestamp_ms: number; amount: number; shares_minted: number };

export async function GET() {
  try {
    const res = await fetch(`${PREDICT_INDEXER}/lp/supplies?limit=4000`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `indexer ${res.status}` }, { status: 502 });
    }
    const rows: Supply[] = await res.json();

    const pts = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        t: Number(r.checkpoint_timestamp_ms),
        p: r.shares_minted > 0 ? r.amount / r.shares_minted : 0,
      }))
      // drop dust-rounding outliers; real PLP share price sits near 1.0
      .filter((x) => x.t > 0 && x.p >= 0.95 && x.p <= 1.5)
      .sort((a, b) => a.t - b.t);

    if (!pts.length) {
      return NextResponse.json({ series: [], current: null, changePct: 0, count: 0 });
    }

    const base = pts[0].p;
    const MAX = 90;
    const step = Math.max(1, Math.floor(pts.length / MAX));
    const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);

    const series = sampled.map((x) => ({
      t: new Date(x.t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      v: (x.p / base) * 100,
    }));

    const last = pts[pts.length - 1].p;
    return NextResponse.json({
      series,
      current: last,
      changePct: (last / base - 1) * 100,
      count: pts.length,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 }
    );
  }
}
