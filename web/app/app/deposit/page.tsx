"use client";

import { PageHeader } from "@/components/app/app-kit";
import { DepositWithdraw } from "@/components/app/deposit-withdraw";
import { PlpPositionPanel } from "@/components/app/plp-position";
import { HowItWorks } from "@/components/app/market-shared";

const POINTS = [
  {
    title: "Shares mint on deposit",
    detail:
      "Your dUSDC supplies risk-managed PLP liquidity. You receive tPLP shares that track your slice of the pool.",
  },
  {
    title: "Shares burn on withdraw",
    detail:
      "Redeem any amount, any time, for your share of the pool in dUSDC, bounded by available on-chain liquidity.",
  },
  {
    title: "Fee charged only on profit",
    detail:
      "A 10% performance fee applies to profit at withdrawal. No management fee, so 90% of yield stays with you.",
  },
];

export default function DepositPage() {
  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Provide PLP liquidity"
        title="Put dUSDC to work."
        description="One deposit supplies risk-managed PLP liquidity. You receive tPLP shares that redeem for your share of the pool, net of a profit-only fee."
      />

      <div className="grid gap-8 lg:grid-cols-2 items-start">
        <DepositWithdraw />

        <PlpPositionPanel />
      </div>

      <HowItWorks points={POINTS} />
    </div>
  );
}
