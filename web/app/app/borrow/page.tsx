"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  PageHeader,
  Panel,
  StatCard,
  Tag,
  EmptyState,
  AccentDot,
} from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { SupplyCard, BorrowCard } from "@/components/app/borrow-actions";
import {
  BORROW_MARKET,
  DUSDC_DECIMALS,
  TPLP_DECIMALS,
  BPS,
  useMarketState,
  marketMetrics,
  usePosition,
} from "@/lib/borrow";
import { useVaultState } from "@/lib/vault";
import { fromUnits, formatNumber, formatPercent } from "@/lib/format";
import { explorerObject, VAULT_ID } from "@/lib/config";

function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

function PositionStat({
  label,
  value,
  sub,
  className = "",
}: {
  label: string;
  value: string;
  sub: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="mt-2 block text-3xl lg:text-4xl font-display tracking-tight leading-none">
        {value}
      </span>
      <span className="mt-2 block text-sm text-muted-foreground">{sub}</span>
    </div>
  );
}

const HOW_IT_WORKS = [
  {
    title: "Supply dUSDC, earn interest",
    detail:
      "Deposit dUSDC and receive tpUSDC. Borrowers pay a variable rate set by a kinked utilization curve; tpUSDC redeems for more dUSDC as interest accrues.",
  },
  {
    title: "Borrow against tPLP",
    detail:
      "Lock your Tethra vault shares (tPLP) as collateral and borrow dUSDC up to 50% LTV. Collateral is valued at the conservative vault cost-basis floor, no oracle.",
  },
  {
    title: "Self-redeeming liquidation",
    detail:
      "Past 80% LTV, anyone can liquidate: the market redeems the borrower's tPLP through the Tethra vault, repays the debt, keeps a 5% penalty, and returns the surplus. No swaps, no liquidator capital.",
  },
];

function healthLabel(ltvBps: number, liqBps: number): { text: string; tone: string } {
  if (ltvBps === 0) return { text: "No debt", tone: "text-muted-foreground" };
  if (ltvBps >= liqBps) return { text: "Liquidatable", tone: "text-[#c2410c]" };
  if (ltvBps >= liqBps * 0.85) return { text: "At risk", tone: "text-[#c2410c]" };
  if (ltvBps >= liqBps * 0.6) return { text: "Caution", tone: "text-foreground" };
  return { text: "Healthy", tone: "text-foreground" };
}

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
        title={<>Borrow against your vault shares.</>}
        description="An open, isolated market: supply dUSDC to earn, or lock tPLP and borrow dUSDC. Liquidations self-redeem through the Tethra vault, so no oracle or external liquidity is needed. Numbers are read live from testnet."
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
              label="Utilization"
              value={formatPercent(metrics.util)}
              sub="Borrowed / supplied"
            />
            <StatCard
              label="Est. borrow APR"
              value={formatPercent(metrics.borrowRate)}
              sub="Kinked utilization curve"
            />
            <StatCard
              label="Est. supply APY"
              value={formatPercent(metrics.supplyApy)}
              sub="Paid to dUSDC suppliers"
            />
            <StatCard
              label="Available reserve"
              value={`${formatNumber(fromUnits(market.reserve, DUSDC_DECIMALS))} dUSDC`}
              sub={`${formatNumber(fromUnits(metrics.totalDebt, DUSDC_DECIMALS))} dUSDC borrowed`}
            />
          </>
        )}
      </div>

      {!loading && (
        <div className="grid gap-8 lg:grid-cols-2 items-start mt-8">
          <SupplyCard market={market} totalAssets={metrics.totalAssets} />
          <BorrowCard market={market} vault={vault} position={position} />
        </div>
      )}

      <Panel className="p-6 lg:p-8 mt-8">
        <Tag>Your position</Tag>
        {account ? (
          hasPosition && position ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
              No open position. Supply dUSDC to earn interest, or lock tPLP as collateral
              and borrow dUSDC on the cards above.
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

      <Panel className="relative overflow-hidden p-6 lg:p-8 mt-6">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/whale.png"
            alt=""
            aria-hidden="true"
            className="h-2/3 w-1/3 object-contain object-right opacity-[0.10]"
          />
        </div>
        <div className="relative z-10">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            How it works
          </span>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {HOW_IT_WORKS.map((point) => (
              <div key={point.title} className="flex items-start gap-4">
                <div className="pt-2">
                  <AccentDot />
                </div>
                <div>
                  <h3 className="font-medium">{point.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {point.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel className="p-6 lg:p-8 mt-6 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center">
          <div>
            <Tag>Protocol</Tag>
            <p className="mt-4 text-muted-foreground leading-relaxed max-w-lg">
              The market and its tpUSDC share coin live on Sui testnet. Collateral is the
              Tethra vault share; liquidations redeem through the same vault. Open any of
              these on the explorer to verify the live state.
            </p>
            <div className="mt-6 flex flex-col gap-3 text-sm">
              <a
                href={explorerObject(BORROW_MARKET.market)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Market object
              </a>
              <a
                href={explorerObject(BORROW_MARKET.package)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Move package
              </a>
              <a
                href={explorerObject(VAULT_ID)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Tethra vault (collateral)
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
