"use client";

import { useState } from "react";
import {
  PageHeader,
  Panel,
  StatCard,
  Tag,
  AccentDot,
} from "@/components/app/app-kit";
import { usePlpRisk } from "@/lib/plp-risk";
import { formatNumber, formatPercent } from "@/lib/format";
import { explorerObject, PREDICT_OBJECT } from "@/lib/config";

const dusdc = (raw: number) => raw / 1e6;
const fmtDusdc = (raw: number) => `${formatNumber(dusdc(raw), 2)} DUSDC`;

function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

// A horizontal bar showing how much of the protocol exposure cap is used.
function CapBar({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(1, used / cap) : 0;
  return (
    <div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className="h-full rounded-full bg-[#eca8d6]"
          style={{ width: `${Math.max(pct * 100, 0.6)}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs font-mono text-muted-foreground">
        <span>{formatPercent(used)} used</span>
        <span>{formatPercent(cap)} cap</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-foreground/[0.06] last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

export default function RiskPage() {
  const { risk, isPending, isError } = usePlpRisk();
  const [stress, setStress] = useState(1); // share of max payout realized vs the house

  const loading = isPending || !risk;

  const coverage =
    risk && risk.totalMaxPayout > 0
      ? risk.availableLiquidity / risk.totalMaxPayout
      : Infinity;
  const withdrawable =
    risk && risk.vaultBalance > 0
      ? risk.availableWithdrawal / risk.vaultBalance
      : 0;

  const stressedLoss = risk ? risk.totalMaxPayout * stress : 0;
  const stressedValue = risk ? risk.vaultValue - stressedLoss : 0;
  const stressedDrawdown =
    risk && risk.vaultValue > 0 ? stressedLoss / risk.vaultValue : 0;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="PLP risk"
        title={
          <>
            Is PLP <span className="text-muted-foreground">safe?</span>
          </>
        }
        description="Live risk for the DeepBook Predict liquidity pool that the Tethra vault supplies. Every number is read from the on-chain Predict object and the public Predict indexer, refreshed continuously."
      />

      {isError && (
        <Panel className="p-6 mb-6">
          <p className="text-sm text-muted-foreground">
            Could not reach the Predict indexer right now. It refreshes
            automatically.
          </p>
        </Panel>
      )}

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
              label="Pool value"
              value={`${formatNumber(dusdc(risk.vaultValue), 0)}`}
              sub="DUSDC in the PLP vault"
            />
            <StatCard
              label="PLP share price"
              value={formatNumber(risk.plpSharePrice, 4)}
              sub="DUSDC per PLP, net of MTM"
            />
            <StatCard
              label="Utilization"
              value={formatPercent(risk.utilization)}
              sub="open exposure / supplied"
            />
            <StatCard
              label="Max-payout utilization"
              value={formatPercent(risk.maxPayoutUtilization)}
              sub="worst-case payout / vault"
            />
          </>
        )}
      </div>

      {!loading && (
        <>
          <div className="grid gap-6 lg:grid-cols-2 mt-6">
            <Panel className="p-6 lg:p-8">
              <Tag>Exposure &amp; coverage</Tag>
              <div className="mt-6 flex items-baseline gap-3">
                <span className="text-5xl lg:text-6xl font-display tracking-tight leading-none">
                  {coverage === Infinity
                    ? "∞"
                    : `${formatNumber(coverage, coverage > 100 ? 0 : 1)}×`}
                </span>
                <span className="text-sm text-muted-foreground">
                  liquidity covers worst-case payout
                </span>
              </div>
              <div className="mt-8">
                <CapBar
                  used={risk.maxPayoutUtilization}
                  cap={risk.maxTotalExposurePct}
                />
              </div>
              <div className="mt-8">
                <Row label="Open mark-to-market" value={fmtDusdc(risk.totalMtm)} />
                <Row
                  label="Worst-case max payout"
                  value={fmtDusdc(risk.totalMaxPayout)}
                />
                <Row
                  label="Available liquidity"
                  value={fmtDusdc(risk.availableLiquidity)}
                />
              </div>
            </Panel>

            <Panel className="p-6 lg:p-8">
              <Tag>Withdrawals</Tag>
              <div className="mt-6 flex items-baseline gap-3">
                <span className="text-5xl lg:text-6xl font-display tracking-tight leading-none">
                  {formatPercent(withdrawable)}
                </span>
                <span className="text-sm text-muted-foreground">
                  of the pool is withdrawable now
                </span>
              </div>
              <p className="mt-6 text-sm text-muted-foreground leading-relaxed">
                Withdrawals are bounded by max-payout coverage: the house keeps
                enough to cover worst-case open payouts. Predict also has a
                configurable withdrawal limiter (a token bucket), currently
                disabled on testnet.
              </p>
              <div className="mt-8">
                <Row
                  label="Available to withdraw"
                  value={fmtDusdc(risk.availableWithdrawal)}
                />
                <Row label="Vault balance" value={fmtDusdc(risk.vaultBalance)} />
                <Row
                  label="PLP supply"
                  value={`${formatNumber(dusdc(risk.plpTotalSupply), 0)} PLP`}
                />
              </div>
            </Panel>
          </div>

          <Panel className="p-6 lg:p-8 mt-6">
            <Tag>What-if: adverse settlement</Tag>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Drag to assume a share of every open position settles at its
              maximum payout against the house. 100% is a tail beyond any
              realistic BTC move, since payouts are contractually bounded by the
              max-payout figure above.
            </p>

            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={stress * 100}
                  onChange={(e) => setStress(Number(e.target.value) / 100)}
                  className="w-full accent-[#eca8d6]"
                />
                <div className="mt-2 flex justify-between text-xs font-mono text-muted-foreground">
                  <span>0% (calm)</span>
                  <span>{formatPercent(stress)} of max payout</span>
                  <span>100% (tail)</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 lg:gap-12">
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    PLP drawdown
                  </span>
                  <span className="mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none">
                    {formatPercent(stressedDrawdown)}
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Pool value after
                  </span>
                  <span className="mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none">
                    {formatNumber(dusdc(stressedValue), 0)}
                  </span>
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="p-6 lg:p-8 mt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AccentDot />
                <span className="text-sm text-muted-foreground">
                  Live from the DeepBook Predict object and indexer on Sui
                  testnet.
                </span>
              </div>
              <a
                href={explorerObject(PREDICT_OBJECT)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors"
              >
                Predict object
              </a>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
