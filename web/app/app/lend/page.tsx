"use client";

import { useState } from "react";
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
import { LendDepositWithdraw } from "@/components/app/lend-deposit-withdraw";
import {
  LEND_ASSETS,
  type LendAsset,
  useLendVaultState,
  useMarginPool,
  useLendShareBalance,
  useLendReferral,
} from "@/lib/lend";
import { fromUnits, formatNumber, formatPercent } from "@/lib/format";
import { explorerObject } from "@/lib/config";

function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

function computeApy(pool: {
  totalSupply: bigint;
  totalBorrow: bigint;
  baseRate: number;
  baseSlope: number;
  excessSlope: number;
  optimalUtilization: number;
  protocolSpread: number;
}): { util: number; supplyApy: number } {
  if (pool.totalSupply === 0n) return { util: 0, supplyApy: 0 };
  const util = Number(pool.totalBorrow) / Number(pool.totalSupply);
  let borrowRate: number;
  if (util <= pool.optimalUtilization) {
    borrowRate = pool.baseRate + pool.baseSlope * util;
  } else {
    borrowRate =
      pool.baseRate +
      pool.baseSlope * pool.optimalUtilization +
      pool.excessSlope * (util - pool.optimalUtilization);
  }
  const supplyApy = borrowRate * util * (1 - pool.protocolSpread);
  return { util, supplyApy };
}

function AssetToggle({
  value,
  onChange,
}: {
  value: "sui" | "dusdc";
  onChange: (v: "sui" | "dusdc") => void;
}) {
  const base =
    "px-5 py-2 text-sm font-mono tracking-wide transition-colors border border-foreground/10";
  const active = "bg-foreground text-background border-foreground";
  const inactive = "bg-transparent text-muted-foreground hover:text-foreground";
  return (
    <div className="inline-flex">
      <button
        type="button"
        className={`${base} ${value === "sui" ? active : inactive}`}
        onClick={() => onChange("sui")}
      >
        SUI
      </button>
      <button
        type="button"
        className={`${base} ${value === "dusdc" ? active : inactive} border-l-0`}
        onClick={() => onChange("dusdc")}
      >
        DBUSDC
      </button>
    </div>
  );
}

const HOW_IT_WORKS = [
  {
    title: "Lent to margin traders",
    detail:
      "Your asset is deposited into a DeepBook Margin pool where it is borrowed by traders to open leveraged positions.",
  },
  {
    title: "tl shares track your position",
    detail:
      "You receive tl shares on deposit. As interest accrues, each share redeems for more of the underlying asset over time.",
  },
  {
    title: "Variable yield, honest risk",
    detail:
      "Yield depends on borrow demand. If a borrower is not liquidated in time, bad debt can reduce the pool. Withdraw any time subject to pool liquidity.",
  },
];

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

export default function LendPage() {
  const [assetKey, setAssetKey] = useState<"sui" | "dusdc">("sui");
  const asset: LendAsset = LEND_ASSETS[assetKey];

  const account = useCurrentAccount();
  const { pool, isPending: poolPending } = useMarginPool(asset);
  const { state: vaultState, isPending: vaultPending } = useLendVaultState(asset);
  const { balance: shareBalance } = useLendShareBalance(account?.address, asset);
  const { referral } = useLendReferral();
  const cap = referral?.[assetKey];

  const loading = poolPending || vaultPending || !pool;

  const { util, supplyApy } = pool ? computeApy(pool) : { util: 0, supplyApy: 0 };

  // Share coin decimals equal the asset decimals (tlSUI 9dp, tlDBUSDC 6dp).
  const yourShares = fromUnits(shareBalance, asset.decimals);
  const totalShares = vaultState ? vaultState.totalShares : 0n;
  const shareFraction =
    totalShares > 0n ? Number(shareBalance) / Number(totalShares) : 0;
  const principalRaw =
    vaultState && totalShares > 0n
      ? (vaultState.costBasis * shareBalance) / totalShares
      : 0n;
  const yourPrincipal = fromUnits(principalRaw, asset.decimals);

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Lend"
        title={<>Lend, earn yield.</>}
        description="Supply assets to DeepBook Margin lending pools. Yield is variable and paid by borrowers. Numbers are read live from testnet."
      />

      <div className="mb-8">
        <AssetToggle value={assetKey} onChange={setAssetKey} />
      </div>

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
              value={formatPercent(util)}
              sub="Borrowed / supplied"
            />
            <StatCard
              label="Est. supply APY"
              value={formatPercent(supplyApy)}
              sub="Variable, from borrow demand"
            />
            <StatCard
              label="Total supplied"
              value={`${formatNumber(fromUnits(pool.totalSupply, asset.decimals))} ${asset.symbol}`}
              sub="Live from margin pool"
            />
            <StatCard
              label="Total borrowed"
              value={`${formatNumber(fromUnits(pool.totalBorrow, asset.decimals))} ${asset.symbol}`}
              sub="Live from margin pool"
            />
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2 items-start mt-8">
        <LendDepositWithdraw asset={asset} />

        <Panel className="p-6 lg:p-8">
          <Tag>Your position</Tag>
          {account ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <PositionStat
                label="Your shares"
                value={formatNumber(yourShares)}
                sub={`tl${asset.symbol} held`}
              />
              <PositionStat
                label="Ownership"
                value={formatPercent(shareFraction)}
                sub={`of total tl${asset.symbol}`}
              />
              <PositionStat
                label="Your principal"
                value={`${formatNumber(yourPrincipal)} ${asset.symbol}`}
                sub="cost basis of your deposits"
                className="sm:col-span-2"
              />
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState
                title="Connect to view your position"
                description="Connect a Sui wallet on testnet to see your shares and position."
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

      <Panel className="p-6 lg:p-8 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tag>Referral capture</Tag>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <AccentDot active={cap?.active ?? false} />
            {cap?.active ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <PositionStat
            label="Captured (accruing)"
            value={`${formatNumber(cap?.captured ?? 0, 6)} ${asset.symbol}`}
            sub="referral fees claimed + unclaimed"
          />
          <PositionStat
            label="Deposit routing"
            value={cap?.active ? "On" : "Off"}
            sub="through Tethra's SupplyReferral"
          />
          <p className="text-sm text-muted-foreground leading-relaxed self-center">
            Tethra reclaims the 50% referral slice of the DeepBook margin spread the
            protocol would otherwise keep, and compounds it back into the vault —
            extra yield for every depositor.
          </p>
        </div>
        <div className="mt-6">
          <a
            href={explorerObject(asset.referral)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors"
          >
            Referral object
          </a>
        </div>
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
              The lend vault and its tl{asset.symbol} share coin live on Sui testnet. Liquidity
              is supplied to a DeepBook Margin pool. Open any of these on the explorer
              to verify the live state.
            </p>
            <div className="mt-6 flex flex-col gap-3 text-sm">
              <a
                href={explorerObject(asset.vault)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Lend vault object
              </a>
              <a
                href={explorerObject(asset.package)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Move package
              </a>
              <a
                href={explorerObject(asset.marginPool)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                DeepBook Margin pool
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
