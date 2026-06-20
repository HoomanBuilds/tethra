import { NextResponse } from "next/server";
import { PREDICT_INDEXER, PREDICT_OBJECT, RPC_URL } from "@/lib/config";

// Live PLP risk read from the public DeepBook Predict indexer (vault summary)
// plus the on-chain Predict object (max total exposure cap). Server-side so the
// browser is not blocked by CORS and the numbers stay real.
export const dynamic = "force-dynamic";

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function GET() {
  try {
    const [summaryRes, objRes] = await Promise.all([
      fetch(`${PREDICT_INDEXER}/predicts/${PREDICT_OBJECT}/vault/summary`, {
        cache: "no-store",
      }),
      fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sui_getObject",
          params: [PREDICT_OBJECT, { showContent: true }],
        }),
      }),
    ]);

    if (!summaryRes.ok) {
      return NextResponse.json(
        { error: `indexer ${summaryRes.status}` },
        { status: 502 }
      );
    }

    const s = await summaryRes.json();
    const obj = await objRes.json().catch(() => null);
    const fields = obj?.result?.data?.content?.fields ?? {};
    // max_total_exposure_pct is scaled by 1e9 on-chain (e.g. 800000000 = 80%).
    const maxTotalExposurePct =
      num(fields?.risk_config?.fields?.max_total_exposure_pct) / 1e9;

    return NextResponse.json({
      vaultBalance: num(s.vault_balance),
      vaultValue: num(s.vault_value),
      totalMtm: num(s.total_mtm),
      totalMaxPayout: num(s.total_max_payout),
      availableLiquidity: num(s.available_liquidity),
      availableWithdrawal: num(s.available_withdrawal),
      plpTotalSupply: num(s.plp_total_supply),
      plpSharePrice: num(s.plp_share_price),
      utilization: num(s.utilization),
      maxPayoutUtilization: num(s.max_payout_utilization),
      netDeposits: num(s.net_deposits),
      totalSupplied: num(s.total_supplied),
      totalWithdrawn: num(s.total_withdrawn),
      maxTotalExposurePct,
      quoteAsset: Array.isArray(s.quote_assets) ? s.quote_assets[0] : null,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 }
    );
  }
}
