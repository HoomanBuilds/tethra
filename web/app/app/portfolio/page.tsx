"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { PageHeader, Panel, Tag, EmptyState } from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { PlpPositionPanel } from "@/components/app/plp-position";
import { PositionStat, healthLabel } from "@/components/app/market-shared";
import {
  LEND_ASSETS,
  useLendVaultState,
  useLendShareBalance,
} from "@/lib/lend";
import {
  useMarketState,
  marketMetrics,
  useTpusdcBalance,
  usePosition,
  previewUnsupply,
  TPUSDC_DECIMALS,
  DUSDC_DECIMALS,
  TPLP_DECIMALS,
  BPS,
} from "@/lib/borrow";
import { fromUnits, formatNumber, formatPercent } from "@/lib/format";

const linkCls =
  "font-mono text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors";

function SectionPanel({
  tag,
  href,
  hasPosition,
  emptyText,
  children,
}: {
  tag: string;
  href: string;
  hasPosition: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <Panel className="p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <Tag>{tag}</Tag>
        <Link href={href} className={linkCls}>
          Open
        </Link>
      </div>
      {hasPosition ? (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">{children}</div>
      ) : (
        <p className="mt-6 text-muted-foreground leading-relaxed max-w-lg">
          {emptyText}
        </p>
      )}
    </Panel>
  );
}

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const addr = account?.address;

  // Tier 2: margin lending (SUI + DBUSDC)
  const sui = LEND_ASSETS.sui;
  const dbusdc = LEND_ASSETS.dusdc;
  const { state: suiVault } = useLendVaultState(sui);
  const { state: dbusdcVault } = useLendVaultState(dbusdc);
  const { balance: suiShares } = useLendShareBalance(addr, sui);
  const { balance: dbusdcShares } = useLendShareBalance(addr, dbusdc);

  // Tier 3: supply + borrow
  const { state: market } = useMarketState();
  const { balance: tpusdc } = useTpusdcBalance(addr);
  const { position } = usePosition(addr);

  if (!account) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <EmptyState
          title="Connect to see your portfolio"
          description="Connect a Sui wallet on testnet to view every position: PLP liquidity, margin lending, supply, and borrow."
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

  const lend = [
    { asset: sui, shares: suiShares, vault: suiVault },
    { asset: dbusdc, shares: dbusdcShares, vault: dbusdcVault },
  ]
    .map(({ asset, shares, vault }) => {
      const totalShares = vault?.totalShares ?? 0n;
      const ownership = totalShares > 0n ? Number(shares) / Number(totalShares) : 0;
      const principalRaw =
        vault && totalShares > 0n ? (vault.costBasis * shares) / totalShares : 0n;
      return {
        asset,
        shares,
        ownership,
        sharesDisp: fromUnits(shares, asset.decimals),
        principal: fromUnits(principalRaw, asset.decimals),
      };
    })
    .filter((p) => p.shares > 0n);

  const metrics = market ? marketMetrics(market) : null;
  const hasSupply = tpusdc > 0n;
  const supplyValue =
    market && metrics
      ? previewUnsupply(tpusdc, market.supplyTotal, metrics.totalAssets)
      : 0n;
  const supplyShareOfPool =
    market && market.supplyTotal > 0n ? Number(tpusdc) / Number(market.supplyTotal) : 0;

  const hasBorrow = !!position && (position.collateral > 0n || position.debt > 0n);
  const health = position
    ? healthLabel(position.ltvBps, market?.liqThresholdBps ?? 8000)
    : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Portfolio"
        title="Everything you hold."
        description="Every Tethra position for this wallet, read live from testnet: PLP liquidity, margin lending, supply, and borrow."
      />

      <div className="grid gap-6">
        {/* Tier 1: PLP liquidity */}
        <PlpPositionPanel tag="PLP liquidity" manageHref="/app/deposit" />

        {/* Tier 2: margin lending */}
        <SectionPanel
          tag="Margin lending"
          href="/app/lend"
          hasPosition={lend.length > 0}
          emptyText="No lend position. Supply SUI or DBUSDC on the Lend page to earn margin interest."
        >
          {lend.map((p) => (
            <PositionStat
              key={p.asset.key}
              label={`${p.asset.symbol} supplied`}
              value={`${formatNumber(p.principal)} ${p.asset.symbol}`}
              sub={`${formatNumber(p.sharesDisp)} tl${p.asset.symbol}, ${formatPercent(p.ownership)} of vault`}
            />
          ))}
        </SectionPanel>

        {/* Tier 3: supply */}
        <SectionPanel
          tag="dUSDC supply"
          href="/app/supply"
          hasPosition={hasSupply}
          emptyText="No supply position. Supply dUSDC on the Supply page to earn interest from borrowers."
        >
          <PositionStat
            label="tpUSDC held"
            value={formatNumber(fromUnits(tpusdc, TPUSDC_DECIMALS))}
            sub="your supplier shares"
          />
          <PositionStat
            label="Redeemable"
            value={`${formatNumber(fromUnits(supplyValue, DUSDC_DECIMALS))} dUSDC`}
            sub={`${formatPercent(supplyShareOfPool)} of the pool`}
          />
        </SectionPanel>

        {/* Tier 3: borrow */}
        <SectionPanel
          tag="Borrow"
          href="/app/borrow"
          hasPosition={hasBorrow}
          emptyText="No borrow position. Lock tPLP as collateral on the Borrow page to draw dUSDC."
        >
          {position && (
            <>
              <PositionStat
                label="Collateral"
                value={formatNumber(fromUnits(position.collateral, TPLP_DECIMALS))}
                sub="tPLP locked"
              />
              <PositionStat
                label="Debt"
                value={`${formatNumber(fromUnits(position.debt, DUSDC_DECIMALS))} dUSDC`}
                sub="owed"
              />
              <PositionStat
                label="Current LTV"
                value={formatPercent(position.ltvBps / BPS)}
                sub={`${formatPercent((market?.maxLtvBps ?? 5000) / BPS)} max, ${formatPercent((market?.liqThresholdBps ?? 8000) / BPS)} liq`}
              />
              <PositionStat
                label="Status"
                value={health?.text ?? "n/a"}
                sub="distance to liquidation"
              />
            </>
          )}
        </SectionPanel>
      </div>
    </div>
  );
}
