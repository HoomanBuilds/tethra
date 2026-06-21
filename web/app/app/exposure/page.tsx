"use client";

import { useMemo, useState } from "react";
import {
  PageHeader,
  Panel,
  StatCard,
  Tag,
  AccentDot,
} from "@/components/app/app-kit";
import { useSviExposure } from "@/lib/svi-exposure";
import { upPrice } from "@/lib/svi";
import { formatNumber, formatPercent } from "@/lib/format";
import { explorerObject } from "@/lib/config";

// Positions, payouts and vault value are all DUSDC base units (6 decimals).
const D = 1e6;
const dusdc = (raw: number) => raw / D;

function tenorLabel(ms: number): string {
  if (ms <= 0) return "settling";
  const s = ms / 1000;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

export default function ExposurePage() {
  const { exposure, isPending, isError } = useSviExposure();
  const [shock, setShock] = useState(0); // BTC move, percent
  const loading = isPending || !exposure;

  const markets = exposure?.markets ?? [];
  const positions = exposure?.positions ?? [];
  const base = exposure?.baseline;
  const now = exposure?.fetchedAt ?? 0;

  const topPayout = markets[0]?.maxPayout ?? 0;
  const concentration =
    base && base.reconstructedMaxPayout > 0 ? topPayout / base.reconstructedMaxPayout : 0;

  const marketById = useMemo(
    () => new Map(markets.map((m) => [m.oracleId, m])),
    [markets],
  );

  // SVI-driven stress: shock the forward, reprice every live position through the
  // live surface, and sum the change in expected house liability.
  const whatif = useMemo(() => {
    let dLiab = 0;
    let flips = 0;
    const f = 1 + shock / 100;
    for (const p of positions) {
      const m = marketById.get(p.o);
      if (!m?.svi) continue;
      const F = m.forward;
      const F2 = F * f;
      const fairNow = p.up ? upPrice(m.svi, F, p.k) : 1 - upPrice(m.svi, F, p.k);
      const fairShock = p.up ? upPrice(m.svi, F2, p.k) : 1 - upPrice(m.svi, F2, p.k);
      dLiab += p.q * (fairShock - fairNow);
      if (F > p.k !== F2 > p.k) flips += 1;
    }
    return { dLiab, flips };
  }, [positions, marketById, shock]);

  const vaultValue = base?.vaultValue ?? 0;
  const plpImpact = vaultValue > 0 ? -whatif.dLiab / vaultValue : 0;
  const shockedSpot = base?.spot ? base.spot * (1 + shock / 100) : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Exposure & stress"
        title={
          <>
            Where the risk <span className="text-muted-foreground">sits.</span>
          </>
        }
        description="The PLP vault is the house for every open Predict position. This breaks the pool's worst-case payout down per oracle, then stresses it through the live SVI surface. Open positions are netted from the public indexer; exposure reconciles with the on-chain vault summary."
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
              label="Max-payout exposure"
              value={`${formatNumber(dusdc(base!.reconstructedMaxPayout), 0)}`}
              sub="DUSDC worst-case, all open positions"
            />
            <StatCard
              label="Active markets"
              value={`${base!.marketCount}`}
              sub="oracles carrying open exposure"
            />
            <StatCard
              label="Top concentration"
              value={formatPercent(concentration)}
              sub="largest single oracle"
            />
            <StatCard
              label="Live (shockable)"
              value={`${formatNumber(dusdc(base!.liveMaxPayout), 0)}`}
              sub="DUSDC on unexpired markets"
            />
          </>
        )}
      </div>

      {!loading && markets.length === 0 && (
        <Panel className="p-6 lg:p-8 mt-6">
          <p className="text-sm text-muted-foreground">
            No open exposure on active markets right now. This updates as new
            positions are minted against the pool.
          </p>
        </Panel>
      )}

      {!loading && markets.length > 0 && (
        <>
          <Panel className="p-6 lg:p-8 mt-6">
            <Tag>Exposure by oracle</Tag>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Worst-case payout the house owes per market, largest first. A few
              markets carry most of the risk, so concentration matters as much as
              the total.
            </p>
            <div className="mt-8 space-y-4">
              {markets.slice(0, 10).map((m) => {
                const width = topPayout > 0 ? (m.maxPayout / topPayout) * 100 : 0;
                const upPct = m.nPos > 0 ? m.nUp / m.nPos : 0;
                return (
                  <div key={m.oracleId}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="font-mono">
                        {tenorLabel(m.expiryMs - now)}
                        {!m.live && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            settling
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {formatNumber(dusdc(m.maxPayout), 0)} DUSDC ·{" "}
                        {m.nPos} pos · {formatPercent(upPct, 0)} up
                      </span>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                      <div
                        className="h-full rounded-full bg-[#eca8d6]"
                        style={{ width: `${Math.max(width, 0.6)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel className="p-6 lg:p-8 mt-6">
            <Tag>Stress: a BTC move, priced through the surface</Tag>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Drag to move BTC spot. Every open position on a live market is
              repriced through its on-chain SVI smile, and the change in the
              house&apos;s expected liability flows straight into the pool value.
              This is the same validated engine the vault marks with.
            </p>

            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <input
                  type="range"
                  min={-25}
                  max={25}
                  step={0.5}
                  value={shock}
                  onChange={(e) => setShock(Number(e.target.value))}
                  className="w-full accent-[#eca8d6]"
                />
                <div className="mt-2 flex justify-between text-xs font-mono text-muted-foreground">
                  <span>-25%</span>
                  <span>
                    {shock > 0 ? "+" : ""}
                    {shock}%
                    {shockedSpot
                      ? ` · BTC $${formatNumber(shockedSpot, 0)}`
                      : ""}
                  </span>
                  <span>+25%</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 lg:gap-12">
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    House liability Δ
                  </span>
                  <span
                    className={`mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none ${
                      whatif.dLiab > 0 ? "text-[#d98a8a]" : ""
                    }`}
                  >
                    {whatif.dLiab > 0 ? "+" : ""}
                    {formatNumber(dusdc(whatif.dLiab), 0)}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    DUSDC expected
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    PLP impact
                  </span>
                  <span
                    className={`mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none ${
                      plpImpact < 0 ? "text-[#d98a8a]" : ""
                    }`}
                  >
                    {plpImpact > 0 ? "+" : ""}
                    {formatPercent(plpImpact)}
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Positions crossing strike
                  </span>
                  <span className="mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none">
                    {whatif.flips}
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
                  Reconstructed exposure{" "}
                  {base && base.totalMaxPayout > 0
                    ? `(${formatNumber(
                        base.reconstructedMaxPayout / base.totalMaxPayout,
                        2,
                      )}×)`
                    : ""}{" "}
                  matches the on-chain total max payout. Live from the Predict
                  indexer on Sui testnet.
                </span>
              </div>
              {markets[0] && (
                <a
                  href={explorerObject(markets[0].oracleId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors"
                >
                  Top oracle
                </a>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
