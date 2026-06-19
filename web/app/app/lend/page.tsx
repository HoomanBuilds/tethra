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
import { LendDepositWithdraw } from "@/components/app/lend-deposit-withdraw";
import {
  useLendVaultState,
  useSuiMarginPool,
  useLendShareBalance,
  LEND_PKG,
  LEND_VAULT_ID,
  SUI_MARGIN_POOL,
  LEND_SHARE_DECIMALS,
  LEND_SUI_DECIMALS,
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

const POINTS = [
  {
    title: "SUI lent to margin traders",
    detail:
      "Your SUI is deposited into a DeepBook Margin pool where it is borrowed by traders to open leveraged positions.",
  },
  {
    title: "tlSUI shares track your position",
    detail:
      "You receive tlSUI shares on deposit. As interest accrues, each share redeems for more SUI over time.",
  },
  {
    title: "Variable yield, honest risk",
    detail:
      "Yield depends on borrow demand. If a borrower is not liquidated in time, bad debt can reduce the pool. Withdraw any time subject to pool liquidity.",
  },
];

export default function LendPage() {
  const account = useCurrentAccount();
  const { pool, isPending: poolPending } = useSuiMarginPool();
  const { state: vaultState, isPending: vaultPending } = useLendVaultState();
  const { balance: shareBalance } = useLendShareBalance(account?.address);

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
        title={
          <>
            Lend SUI,
            <br />
            earn yield.
          </>
        }
        description="Supply SUI to a DeepBook Margin lending pool. Yield is variable and paid by borrowers. Numbers are read live from testnet."
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
              value={`${formatNumber(fromUnits(pool.totalSupply, LEND_SUI_DECIMALS))} SUI`}
              sub="Live from margin pool"
            />
            <StatCard
              label="Total borrowed"
              value={`${formatNumber(fromUnits(pool.totalBorrow, LEND_SUI_DECIMALS))} SUI`}
              sub="Live from margin pool"
            />
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2 items-start mt-8">
        <div className="max-w-md w-full">
          <LendDepositWithdraw />
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
                    tlSUI held
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
                    Of total tlSUI outstanding
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex-1">
                <EmptyState
                  title="Connect to view your position"
                  description="Connect a Sui wallet on testnet to see your tlSUI shares and position."
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
                {POINTS.map((point) => (
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
              The lend vault and its tlSUI share coin live on Sui testnet. Liquidity
              is supplied to a DeepBook Margin pool. Open any of these on the explorer
              to verify the live state.
            </p>
            <div className="mt-6 flex flex-col gap-3 text-sm">
              <a
                href={explorerObject(LEND_VAULT_ID)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Lend vault object
              </a>
              <a
                href={explorerObject(LEND_PKG)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit"
              >
                Move package
              </a>
              <a
                href={explorerObject(SUI_MARGIN_POOL)}
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
