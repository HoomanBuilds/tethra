"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { Panel, Tag, EmptyState, AccentDot } from "@/components/app/app-kit";
import { PositionStat } from "@/components/app/market-shared";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { useShareBalance, useVaultState, useCoins } from "@/lib/vault";
import { buildWithdrawTx, simulateDeltas } from "@/lib/tx";
import { fromShares, fromDusdc, formatNumber, formatUsd, formatPercent } from "@/lib/format";
import { SHARE_TYPE } from "@/lib/config";

const linkCls =
  "font-mono text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors";

// The connected wallet's Tier-1 (PLP) position: shares, ownership, cost-basis
// principal, live redeemable (on-chain dry-run), and unrealized PnL. Shared by
// the deposit page and the portfolio page.
export function PlpPositionPanel({
  tag = "Your position",
  manageHref,
}: {
  tag?: string;
  manageHref?: string;
}) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { state } = useVaultState();
  const { balance: shareBalance } = useShareBalance(account?.address);
  const { coins: shareCoins } = useCoins(account?.address, SHARE_TYPE);

  const [redeemable, setRedeemable] = useState<{ dusdc: bigint; ok: boolean } | null>(null);
  const [redeemableLoading, setRedeemableLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const coinIds = shareCoins.map((c) => c.coinObjectId);
    if (!account?.address || shareBalance <= 0n || coinIds.length === 0) {
      setRedeemable(null);
      setRedeemableLoading(false);
      return;
    }
    setRedeemableLoading(true);
    (async () => {
      const tx = buildWithdrawTx(account.address, coinIds, shareBalance);
      const result = await simulateDeltas(client, tx);
      if (cancelled) return;
      setRedeemable({ dusdc: result.dusdc, ok: result.ok });
      setRedeemableLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.address, shareBalance, shareCoins, client]);

  const totalShares = state?.totalShares ?? 0n;
  const costBasis = state?.costBasis ?? 0n;
  const ownershipFraction =
    totalShares > 0n ? Number(shareBalance) / Number(totalShares) : 0;
  const principalRaw =
    totalShares > 0n ? (costBasis * shareBalance) / totalShares : 0n;
  const redeemableRaw = redeemable?.ok ? redeemable.dusdc : 0n;
  const unrealizedRaw = redeemableRaw - principalRaw;
  const unrealizedPositive = unrealizedRaw >= 0n;

  return (
    <Panel className="p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <Tag>{tag}</Tag>
        {manageHref && (
          <Link href={manageHref} className={linkCls}>
            Open
          </Link>
        )}
      </div>

      {!account ? (
        <div className="mt-6">
          <EmptyState
            title="Connect to view your position"
            description="Connect a Sui wallet on testnet to see your tPLP, principal, and live redeemable value."
            image="/images/world.png"
            action={
              <ConnectWallet
                className="rounded-full bg-foreground text-background hover:bg-foreground/90 h-11 px-6"
                label="Connect wallet"
                showAccount={false}
              />
            }
          />
        </div>
      ) : shareBalance <= 0n ? (
        <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg">
          No tPLP position yet. Deposit dUSDC to receive tPLP shares that redeem
          for your slice of the pool, net of a profit-only fee.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <PositionStat
              label="Your shares"
              value={formatNumber(fromShares(shareBalance))}
              sub="tPLP held"
            />
            <PositionStat
              label="Ownership"
              value={formatPercent(ownershipFraction)}
              sub="of the pool"
            />
            <PositionStat
              label="Cost-basis principal"
              value={formatUsd(fromDusdc(principalRaw))}
              sub="your share of principal"
            />
            <PositionStat
              label="Redeemable, live"
              value={
                redeemableLoading
                  ? "pricing…"
                  : redeemable?.ok
                    ? formatUsd(fromDusdc(redeemableRaw))
                    : "unavailable"
              }
              sub="net of profit-only fee"
            />
          </div>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-foreground/10 pt-6">
            <div>
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Unrealized
              </span>
              <div className="mt-2 text-2xl lg:text-3xl font-display tracking-tight leading-none">
                {redeemableLoading ? (
                  <span className="text-muted-foreground">pricing…</span>
                ) : redeemable?.ok ? (
                  <span
                    className={unrealizedPositive ? "" : "text-muted-foreground"}
                    style={unrealizedPositive ? { color: "#eca8d6" } : undefined}
                  >
                    {unrealizedPositive ? "+" : ""}
                    {formatUsd(fromDusdc(unrealizedRaw))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">unavailable</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AccentDot active={redeemable?.ok ?? false} />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {redeemableLoading ? "Pricing" : redeemable?.ok ? "Live" : "Offline"}
              </span>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
