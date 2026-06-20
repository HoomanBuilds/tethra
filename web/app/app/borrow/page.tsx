"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { PageHeader, Panel, StatCard, Tag, EmptyState } from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { BorrowCard } from "@/components/app/borrow-actions";
import {
  StatSkeleton,
  PositionStat,
  healthLabel,
  HowItWorks,
  ProtocolLinksPanel,
} from "@/components/app/market-shared";
import {
  DUSDC_DECIMALS,
  TPLP_DECIMALS,
  BPS,
  useMarketState,
  marketMetrics,
  usePosition,
} from "@/lib/borrow";
import { useVaultState } from "@/lib/vault";
import { fromUnits, formatNumber, formatPercent } from "@/lib/format";

const HOW_IT_WORKS = [
  {
    title: "Lock tPLP as collateral",
    detail:
      "Deposit your Tethra vault shares (tPLP). They are valued at the conservative vault cost-basis floor, with no oracle.",
  },
  {
    title: "Borrow dUSDC up to 50% LTV",
    detail:
      "Draw dUSDC against your collateral up to the max LTV. Repay any time; interest accrues on a kinked utilization curve.",
  },
  {
    title: "Self-redeeming liquidation",
    detail:
      "Past 80% LTV, anyone can liquidate: the market redeems your tPLP through the Tethra vault, repays the debt, keeps a 5% penalty, and returns the surplus.",
  },
];

export default function BorrowPage() {
  const account = useCurrentAccount();
  const { state: market, isPending } = useMarketState();
  const { state: vault } = useVaultState();
  const { position } = usePosition(account?.address);

  const metrics = market ? marketMetrics(market) : null;
  const loading = isPending || !market || !metrics;

  const hasPosition = !!position && (position.collateral > 0n || position.debt > 0n);
  const health = position
    ? healthLabel(position.ltvBps, market?.liqThresholdBps ?? 8000)
    : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Borrow"
        title={<>Borrow against your tPLP.</>}
        description="Lock tPLP from the Tethra vault and borrow dUSDC against it, up to 50% LTV. Liquidations self-redeem through the vault, so no oracle or external liquidity is needed. Numbers are read live from testnet."
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
              label="Est. borrow APR"
              value={formatPercent(metrics.borrowRate)}
              sub="Kinked utilization curve"
            />
            <StatCard
              label="Max LTV"
              value={formatPercent(market.maxLtvBps / BPS)}
              sub={`Liquidation at ${formatPercent(market.liqThresholdBps / BPS)}`}
            />
            <StatCard
              label="Available to borrow"
              value={`${formatNumber(fromUnits(market.reserve, DUSDC_DECIMALS))} dUSDC`}
              sub="Idle reserve"
            />
            <StatCard
              label="Utilization"
              value={formatPercent(metrics.util)}
              sub="Borrowed / supplied"
            />
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2 items-start mt-8">
        {!loading && <BorrowCard market={market} vault={vault} position={position} />}

        <Panel className="p-6 lg:p-8">
          <Tag>Your position</Tag>
          {account ? (
            hasPosition && position ? (
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <PositionStat
                  label="Collateral"
                  value={formatNumber(fromUnits(position.collateral, TPLP_DECIMALS))}
                  sub="tPLP locked"
                />
                <PositionStat
                  label="Debt"
                  value={`${formatNumber(fromUnits(position.debt, DUSDC_DECIMALS))}`}
                  sub="dUSDC owed"
                />
                <PositionStat
                  label="Current LTV"
                  value={formatPercent(position.ltvBps / BPS)}
                  sub={`${formatPercent((market?.maxLtvBps ?? 5000) / BPS)} max, ${formatPercent((market?.liqThresholdBps ?? 8000) / BPS)} liq`}
                />
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Status
                  </span>
                  <span className={`mt-2 block text-3xl lg:text-4xl font-display tracking-tight leading-none ${health?.tone}`}>
                    {health?.text}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    Distance to liquidation
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg">
                No open position. Add tPLP as collateral and borrow dUSDC against it on the
                card to the left.
              </p>
            )
          ) : (
            <div className="mt-6">
              <EmptyState
                title="Connect to view your position"
                description="Connect a Sui wallet on testnet to see your collateral, debt, and LTV."
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

      <ProtocolLinksPanel blurb="You borrow dUSDC against tPLP in an isolated market. Collateral is the Tethra vault share; liquidations redeem through the same vault. Open any of these on the explorer to verify the live state." />
    </div>
  );
}
