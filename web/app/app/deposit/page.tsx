"use client";

import { PageHeader, Panel, AccentDot } from "@/components/app/app-kit";
import { DepositWithdraw } from "@/components/app/deposit-withdraw";

const POINTS = [
  {
    title: "Shares mint on deposit",
    detail:
      "Your dUSDC supplies risk-managed PLP liquidity. You receive plpVAULT shares that track your slice of the pool.",
  },
  {
    title: "Shares burn on withdraw",
    detail:
      "Redeem any amount, any time, for your share of the pool in dUSDC, bounded by available on-chain liquidity.",
  },
  {
    title: "Fee charged only on profit",
    detail:
      "A 15% performance fee applies to profit at withdrawal. No management fee, so 85% of yield stays with you.",
  },
];

export default function DepositPage() {
  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Deposit and withdraw"
        title="Put dUSDC to work."
        description="One deposit supplies risk-managed PLP liquidity. You receive plpVAULT shares that redeem for your share of the pool, net of a profit-only fee."
      />

      <div className="grid gap-8 lg:grid-cols-2 items-start">
        <div className="max-w-md w-full">
          <DepositWithdraw />
        </div>

        <Panel className="relative overflow-hidden p-6 lg:p-8">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/whale.png"
              alt=""
              aria-hidden="true"
              className="h-3/4 w-3/4 object-contain object-right opacity-[0.18]"
            />
          </div>

          <div className="relative z-10">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              How it works
            </span>
            <div className="mt-8 flex flex-col gap-8">
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
  );
}
