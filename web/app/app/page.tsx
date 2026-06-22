"use client";

import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  PageHeader,
  Panel,
  StatCard,
  EmptyState,
  Tag,
} from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { TethraChart } from "@/components/app/chart";
import { CHART } from "@/lib/chart-theme";
import { usePlpNav } from "@/lib/plp-risk";
import { useVaultState, useShareBalance } from "@/lib/vault";
import { fromDusdc, fromShares, formatUsd, formatNumber, formatPercent } from "@/lib/format";
import {
  PACKAGE,
  VAULT_ID,
  PREDICT_OBJECT,
  explorerObject,
} from "@/lib/config";

function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

export default function VaultOverview() {
  const { state, isPending } = useVaultState();
  const account = useCurrentAccount();
  const { balance: shareBalance } = useShareBalance(account?.address);

  const loading = isPending || !state;

  const { nav: navData } = usePlpNav();
  const navSeries = navData?.series ?? [];
  const navOption = {
    grid: { left: 8, right: 18, top: 18, bottom: 24, containLabel: true },
    xAxis: {
      type: "category",
      data: navSeries.map((p) => p.t),
      boundaryGap: false,
    },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "none",
        data: navSeries.map((p) => p.v),
        lineStyle: { color: CHART.accent, width: 2 },
        areaStyle: { color: CHART.accentSoft },
      },
    ],
  };

  // NAV change since inception, with a sign, sensible precision (the pool moves
  // in tiny amounts, so 2 decimals would always read 0.00), and no "+-".
  const changePct = navData?.changePct ?? null;
  const changeUp = (changePct ?? 0) > 0;
  const changeStr = (() => {
    if (changePct == null) return null;
    const d = Math.abs(changePct) >= 0.1 ? 2 : 3;
    const r = Number(changePct.toFixed(d));
    const sign = r > 0 ? "+" : r < 0 ? "-" : "";
    return `${sign}${Math.abs(r).toFixed(d)}% since inception`;
  })();

  const yourShares = fromShares(shareBalance);
  const shareFraction =
    state && state.totalShares > 0n
      ? Number(shareBalance) / Number(state.totalShares)
      : 0;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Vault overview"
        title={
          <>
            The vault,
            <br />
            at a glance.
          </>
        }
        description="A one-deposit dUSDC vault that supplies risk-managed PLP liquidity on DeepBook Predict. Numbers below are read live from the testnet contract."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Principal"
              value={formatUsd(fromDusdc(state.costBasis))}
              sub="Aggregate cost basis, live"
            />
            <StatCard
              label="Total shares"
              value={formatNumber(fromShares(state.totalShares))}
              sub="tPLP supply"
            />
            <StatCard
              label="Performance fee"
              value={`${state.feeBps / 100}%`}
              sub="90% stays with depositors"
            />
            <StatCard
              label="Deposit cap"
              value={
                state.depositCap === 0n
                  ? "Uncapped"
                  : `${formatPercent(Number(state.costBasis) / Number(state.depositCap))} used`
              }
              sub={state.depositCap === 0n ? "No cap on deposits" : "Of the configured cap"}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 mt-6">
        <Panel className="lg:col-span-2 p-6 lg:p-8 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <Tag>PLP pool NAV, live from DeepBook Predict</Tag>
            {navSeries.length > 0 && changeStr && (
              <span className={`font-mono text-sm ${changeUp ? "text-[#eca8d6]" : "text-muted-foreground"}`}>
                {changeStr}
              </span>
            )}
          </div>
          {navSeries.length > 0 ? (
            <div className="flex-1 min-h-[320px]">
              <TethraChart option={navOption} height="100%" />
            </div>
          ) : (
            <div className="flex-1 min-h-[320px] flex items-center justify-center text-sm text-muted-foreground font-mono">
              Loading live NAV…
            </div>
          )}
        </Panel>

        <Panel className="p-6 lg:p-8 flex flex-col">
          <Tag>Your position</Tag>
          {account ? (
            <div className="mt-6 flex flex-col gap-6 flex-1">
              <div>
                <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Your shares
                </span>
                <span className="mt-2 block text-3xl lg:text-4xl font-display tracking-tight leading-none">
                  {formatNumber(yourShares)}
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">tPLP held</span>
              </div>
              <div>
                <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Share of vault
                </span>
                <span className="mt-2 block text-3xl lg:text-4xl font-display tracking-tight leading-none">
                  {formatPercent(shareFraction)}
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  Of total shares outstanding
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex-1">
              <EmptyState
                title="Connect to view your position"
                description="Connect a Sui wallet on testnet to see your vault shares and value."
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
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Link
          href="/app/deposit"
          className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-8 h-12 text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          Deposit dUSDC
        </Link>
      </div>

      <Panel className="p-6 lg:p-8 mt-6 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center">
          <div>
            <Tag>Protocol</Tag>
            <p className="mt-4 text-muted-foreground leading-relaxed max-w-lg">
              The vault and its share coin live on Sui testnet. Liquidity is supplied to a
              DeepBook Predict pool object. Open any of these on the explorer to verify the
              live state for yourself.
            </p>
            <div className="mt-6 flex flex-col gap-3 text-sm">
              <a
                href={explorerObject(VAULT_ID)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Vault object
              </a>
              <a
                href={explorerObject(PACKAGE)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Move package
              </a>
              <a
                href={explorerObject(PREDICT_OBJECT)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                DeepBook Predict object
              </a>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/connection.png"
            alt=""
            aria-hidden="true"
            className="hidden lg:block w-56 h-56 object-contain opacity-70 justify-self-end"
          />
        </div>
      </Panel>
    </div>
  );
}
