"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import {
  PageHeader,
  StatCard,
  EmptyState,
  Panel,
  AccentDot,
} from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { useShareBalance, useVaultState, useCoins } from "@/lib/vault";
import { buildWithdrawTx, simulateDeltas } from "@/lib/tx";
import {
  fromShares,
  fromDusdc,
  formatNumber,
  formatUsd,
  formatPercent,
} from "@/lib/format";
import { SHARE_TYPE } from "@/lib/config";

export default function PortfolioPage() {
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

  if (!account) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <EmptyState
          title="Connect to see your portfolio"
          description="Connect a Sui wallet on testnet to view your shares, principal, and current redeemable value."
          image="/images/tree.png"
          action={
            <ConnectWallet
              className="rounded-full bg-foreground text-background hover:bg-foreground/90 h-11 px-6"
              label="Connect wallet"
              showAccount={false}
            />
          }
        />
      </div>
    );
  }

  if (shareBalance <= 0n) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <EmptyState
          title="No position yet"
          description="Deposit dUSDC to receive tPLP shares."
          image="/images/tree.png"
          action={
            <Button
              asChild
              className="rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              <Link href="/app/deposit">Deposit dUSDC</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const totalShares = state?.totalShares ?? 0n;
  const costBasis = state?.costBasis ?? 0n;

  // bigint math for share-of proportions, to avoid float precision loss.
  const ownershipFraction =
    totalShares > 0n ? Number(shareBalance) / Number(totalShares) : 0;
  const principalRaw =
    totalShares > 0n ? (costBasis * shareBalance) / totalShares : 0n;

  const redeemableRaw = redeemable?.ok ? redeemable.dusdc : 0n;
  const unrealizedRaw = redeemableRaw - principalRaw;
  const unrealizedPositive = unrealizedRaw >= 0n;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader label="Portfolio" title="Your position." />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Your shares"
          value={formatNumber(fromShares(shareBalance))}
        />
        <StatCard
          label="Ownership"
          value={formatPercent(ownershipFraction)}
          sub="of the pool"
        />
        <StatCard
          label="Cost-basis principal"
          value={formatUsd(fromDusdc(principalRaw))}
          sub="your share of aggregate principal"
        />
        <StatCard
          label="Current redeemable, live"
          value={
            redeemableLoading ? (
              <Skeleton className="h-10 w-28" />
            ) : redeemable?.ok ? (
              formatUsd(fromDusdc(redeemableRaw))
            ) : (
              <span className="text-muted-foreground">unavailable</span>
            )
          }
          sub="net of profit-only fee"
        />
      </div>

      <Panel className="mt-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Unrealized
            </span>
            <div className="mt-3 flex items-baseline gap-3">
              {redeemableLoading ? (
                <Skeleton className="h-10 w-32" />
              ) : redeemable?.ok ? (
                <span
                  className="text-4xl lg:text-5xl font-display tracking-tight leading-none"
                  style={unrealizedPositive ? { color: "#eca8d6" } : undefined}
                >
                  <span className={unrealizedPositive ? "" : "text-muted-foreground"}>
                    {unrealizedPositive ? "+" : ""}
                    {formatUsd(fromDusdc(unrealizedRaw))}
                  </span>
                </span>
              ) : (
                <span className="text-4xl font-display tracking-tight text-muted-foreground">
                  unavailable
                </span>
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground max-w-md leading-relaxed">
              Current redeemable value minus your cost-basis principal. Updates
              live from an on-chain dry-run.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <AccentDot active={redeemable?.ok ?? false} />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {redeemableLoading
                ? "Pricing"
                : redeemable?.ok
                  ? "Live"
                  : "Offline"}
            </span>
          </div>
        </div>
      </Panel>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Button
          asChild
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          <Link href="/app/deposit">Deposit more</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="rounded-full border-foreground/15"
        >
          <Link href="/app/deposit#withdraw">Withdraw</Link>
        </Button>
      </div>
    </div>
  );
}
