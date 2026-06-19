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
  LEND_SHARE_DECIMALS,
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
    borrowRate =
      pool.baseRate +
      pool.baseSlope * (util / pool.optimalUtilization);
  } else {
    borrowRate =
      pool.baseRate +
      pool.baseSlope +
      pool.excessSlope *
        ((util - pool.optimalUtilization) / (1 - pool.optimalUtilization));
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
        dUSDC
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

export default function LendPage() {
  const [assetKey, setAssetKey] = useState<"sui" | "dusdc">("sui");
  const asset: LendAsset = LEND_ASSETS[assetKey];

  const account = useCurrentAccount();
  const { pool, isPending: poolPending } = useMarginPool(asset);
  const { state: vaultState, isPending: vaultPending } = useLendVaultState(asset);
  const { balance: shareBalance } = useLendShareBalance(account?.address, asset);

  const loading = poolPending || vaultPending || !pool;

  const { util, supplyApy } = pool ? computeApy(pool) : { util: 0, supplyApy: 0 };

  const yourShares = fromUnits(shareBalance, LEND_SHARE_DECIMALS);
  const totalSharesNum = vaultState ? Number(vaultState.totalShares) : 0;
  const shareFraction =
    totalSharesNum > 0 ? Number(shareBalance) / totalSharesNum : 0;

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
        <div className="max-w-md w-full">
          <LendDepositWithdraw asset={asset} />
        </div>

        <div className="flex flex-col gap-6">
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
                  <span className="mt-2 block text-sm text-muted-foreground">
                    tl{asset.symbol} held
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Share of vault
                  </span>
                  <span className="mt-2 block text-3xl lg:text-4xl font-display tracking-tight leading-none">
                    {formatPercent(shareFraction)}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    Of total tl{asset.symbol} outstanding
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex-1">
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

          <Panel className="relative overflow-hidden p-6 lg:p-8">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-end">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/whale.png"
                alt=""
                aria-hidden="true"
                className="h-3/4 w-3/4 object-contain object-right opacity-[0.12]"
              />
            </div>
            <div className="relative z-10">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                How it works
              </span>
              <div className="mt-6 flex flex-col gap-6">
                {HOW_IT_WORKS.map((point) => (
                  <div key={point.title} className="flex items-start gap-4">
                    <div className="pt-2">
                      <AccentDot />
                    </div>
                    <div>
                      <h3 className="font-medium">{point.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-sm">
                        {point.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>

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
