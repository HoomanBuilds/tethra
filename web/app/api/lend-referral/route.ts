import { NextResponse } from "next/server";
import { RPC_URL } from "@/lib/config";

// Referral fees the Tier-2 vaults have captured from their DeepBook margin pools.
// For each pool: read protocol_fees (fees_per_share + the referrals table), then
// our referral's ReferralTracker, and compute accrued = unclaimed + shares *
// (fees_per_share - last_fees_per_share) / 1e9 (deepbook fixed-point). Server-side.
export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v ?? 0);
const SCALE = 1e9;

const ASSETS = [
  {
    key: "sui",
    symbol: "SUI",
    decimals: 9,
    marginPool: "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea",
    referral: "0xc4f4e9991dd61539a78dc17a76da86a3cdd35195ca6508736b7f0ebc8ceb0203",
  },
  {
    key: "dusdc",
    symbol: "DBUSDC",
    decimals: 6,
    marginPool: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d",
    referral: "0xe229d2ca1819d6039d0e191f05865f4751d2220a66b1e6f72365e5cecbd84955",
  },
] as const;

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
}

async function captureFor(asset: (typeof ASSETS)[number]) {
  const fallback = { active: false, captured: 0, symbol: asset.symbol };
  const poolRes = await rpc("sui_getObject", [asset.marginPool, { showContent: true }]);
  const pf = poolRes?.result?.data?.content?.fields?.protocol_fees?.fields;
  const tableId = pf?.referrals?.fields?.id?.id;
  if (!pf || !tableId) return fallback;
  const feesPerShare = num(pf.fees_per_share);

  const dfRes = await rpc("suix_getDynamicFieldObject", [
    tableId,
    { type: "0x2::object::ID", value: asset.referral },
  ]);
  const t = dfRes?.result?.data?.content?.fields?.value?.fields;
  if (!t) return fallback;

  const shares = num(t.current_shares);
  const last = num(t.last_fees_per_share);
  const unclaimed = num(t.unclaimed_fees);
  const accruedRaw = unclaimed + Math.floor((shares * Math.max(feesPerShare - last, 0)) / SCALE);
  return { active: true, captured: accruedRaw / 10 ** asset.decimals, symbol: asset.symbol };
}

export async function GET() {
  try {
    const [sui, dusdc] = await Promise.all([captureFor(ASSETS[0]), captureFor(ASSETS[1])]);
    return NextResponse.json({ sui, dusdc, fetchedAt: Date.now() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
