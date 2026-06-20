"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { PageHeader, Panel, StatCard, Tag, EmptyState } from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { SupplyCard } from "@/components/app/borrow-actions";
import {
  StatSkeleton,
  PositionStat,
  HowItWorks,
  ProtocolLinksPanel,
} from "@/components/app/market-shared";
import {
  DUSDC_DECIMALS,
  TPUSDC_DECIMALS,
  useMarketState,
  marketMetrics,
  useTpusdcBalance,
  previewUnsupply,
} from "@/lib/borrow";
import { fromUnits, formatNumber, formatPercent } from "@/lib/format";

const HOW_IT_WORKS = [
  {
    title: "Supply dUSDC, receive tpUSDC",
    detail:
      "Deposit dUSDC and get tpUSDC shares. Each share redeems for more dUSDC over time as borrowers pay interest into the reserve.",
  },
  {
    title: "Variable interest from borrowers",
    detail:
      "The rate follows a kinked utilization curve: the more of the reserve is borrowed, the higher the yield you earn.",
  },
  {
    title: "Withdraw subject to liquidity",
    detail:
      "Redeem tpUSDC for dUSDC any time there is idle reserve. If utilization is high, wait for repayments or liquidations.",
  },
];

export default function SupplyPage() {
  const account = useCurrentAccount();
  const { state: market, isPending } = useMarketState();
  const { balance: tpusdc } = useTpusdcBalance(account?.address);

  const metrics = market ? marketMetrics(market) : null;
  const loading = isPending || !market || !metrics;

  const hasSupply = tpusdc > 0n;
  const supplyValue =
    market && metrics ? previewUnsupply(tpusdc, market.supplyTotal, metrics.totalAssets) : 0n;
  const shareOfPool =
    market && market.supplyTotal > 0n ? Number(tpusdc) / Number(market.supplyTotal) : 0;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Supply dUSDC"
        title={<>Supply dUSDC, earn interest.</>}
        description="Lend dUSDC into the tPLP borrow market and earn interest paid by borrowers. You receive tpUSDC that redeems for more dUSDC over time. Numbers are read live from testnet."
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
              label="Est. supply APY"
              value={formatPercent(metrics.supplyApy)}
              sub="Paid by borrowers"
            />
            <StatCard
              label="Utilization"
              value={formatPercent(metrics.util)}
              sub="Borrowed / supplied"
            />
            <StatCard
              label="Total supplied"
              value={`${formatNumber(fromUnits(metrics.totalAssets, DUSDC_DECIMALS))} dUSDC`}
              sub="Reserve plus lent out"
            />
            <StatCard
              label="Idle reserve"
              value={`${formatNumber(fromUnits(market.reserve, DUSDC_DECIMALS))} dUSDC`}
              sub="Available to withdraw now"
            />
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2 items-start mt-8">
        {!loading && <SupplyCard market={market} totalAssets={metrics.totalAssets} />}

        <Panel className="p-6 lg:p-8">
          <Tag>Your supply</Tag>
          {account ? (
            hasSupply ? (
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <PositionStat
                  label="tpUSDC held"
                  value={formatNumber(fromUnits(tpusdc, TPUSDC_DECIMALS))}
                  sub="Your supplier shares"
                />
                <PositionStat
                  label="Redeemable"
                  value={`${formatNumber(fromUnits(supplyValue, DUSDC_DECIMALS))}`}
                  sub="dUSDC at current share price"
                />
                <PositionStat
                  label="Share of pool"
                  value={formatPercent(shareOfPool)}
                  sub="of all supplied dUSDC"
                  className="sm:col-span-2"
                />
              </div>
            ) : (
              <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg">
                You have no supply position yet. Supply dUSDC to receive tpUSDC and start
                earning interest from borrowers.
              </p>
            )
          ) : (
            <div className="mt-6">
              <EmptyState
                title="Connect to view your supply"
                description="Connect a Sui wallet on testnet to see your tpUSDC and earnings."
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

      <HowItWorks points={HOW_IT_WORKS} />

      <ProtocolLinksPanel blurb="You supply dUSDC into the isolated tPLP market and receive tpUSDC. Borrowers lock tPLP and draw against it; the interest they pay accrues to your shares. Open any of these on the explorer to verify the live state." />
    </div>
  );
}
