"use client";

import {
  PageHeader,
  Panel,
  StatCard,
  Tag,
  AccentDot,
} from "@/components/app/app-kit";
import { TethraChart } from "@/components/app/chart";
import { useSviSurface, type SurfaceOracle } from "@/lib/svi-surface";
import { formatNumber, formatPercent } from "@/lib/format";
import { explorerObject } from "@/lib/config";

// Tenor color ramp: warm pink (nearest expiry) to cool blue (furthest).
function ramp(n: number): string[] {
  const A = [0xec, 0xa8, 0xd6];
  const B = [0x6f, 0x9b, 0xd1];
  if (n <= 1) return ["#eca8d6"];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const c = A.map((a, j) => Math.round(a + (B[j] - a) * t));
    return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  });
}

function tenorLabel(ms: number): string {
  const s = ms / 1000;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

const sci = (x: number) => x.toExponential(2);

function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

function buildOption(oracles: SurfaceOracle[], now: number) {
  const colors = ramp(oracles.length);
  // Every expiry is sampled on the same strike grid, so a shared category axis
  // overlays them cleanly (matches the proven chart pattern in the app).
  const strikes = oracles[0]?.smile.map((p) => p.strike) ?? [];
  const atmIdx = Math.round((strikes.length - 1) / 2);
  return {
    color: colors,
    legend: {
      data: oracles.map((o) => tenorLabel(o.expiryMs - now)),
      top: 6,
      left: "center",
      itemGap: 16,
      inactiveColor: "rgba(236,234,226,0.22)",
    },
    grid: { left: 52, right: 20, top: 52, bottom: 28, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (
        ps: Array<{ marker: string; seriesName: string; value: number; dataIndex: number }>,
      ) => {
        if (!ps?.length) return "";
        const strike = strikes[ps[0].dataIndex];
        const head = `$${Number(strike).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
        const rows = ps
          .map(
            (p) =>
              `${p.marker}${p.seriesName}&nbsp;&nbsp;<b>${Number(p.value).toFixed(1)}%</b>`,
          )
          .join("<br/>");
        return `<span style="color:#8B867C">strike</span> ${head}<br/>${rows}`;
      },
    },
    xAxis: {
      type: "category",
      data: strikes.map((s) => String(Math.round(s))),
      boundaryGap: false,
      name: "strike",
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: { interval: 7, formatter: (v: string) => `$${Math.round(Number(v) / 1000)}k` },
    },
    yAxis: {
      type: "value",
      name: "implied vol",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 38,
      axisLabel: { formatter: "{value}%" },
    },
    series: oracles.map((o, i) => ({
      name: tenorLabel(o.expiryMs - now),
      type: "line",
      smooth: true,
      symbol: "none",
      data: o.smile.map((p) => Number((p.iv * 100).toFixed(2))),
      lineStyle: { color: colors[i], width: i === 0 ? 2.4 : 1.6 },
      itemStyle: { color: colors[i] },
      emphasis: { focus: "series", lineStyle: { width: 3 } },
      blur: { lineStyle: { opacity: 0.12 } },
      ...(i === 0
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              data: [{ xAxis: atmIdx }],
              lineStyle: { color: "rgba(236,234,226,0.25)", type: "dashed", width: 1 },
              label: { formatter: "ATM", color: "#8B867C", fontSize: 10 },
            },
          }
        : {}),
    })),
  };
}

export default function SurfacePage() {
  const { surface, isPending, isError } = useSviSurface();
  const loading = isPending || !surface;
  const oracles = surface?.oracles ?? [];
  const now = surface?.fetchedAt ?? 0;
  const front = oracles[0];

  const butterflyClean = oracles.filter((o) => o.butterflyOk).length;
  const calendarClean = oracles.filter((o) => o.calendarOk).length;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Vol surface"
        title={
          <>
            The live SVI <span className="text-muted-foreground">surface.</span>
          </>
        }
        description="Implied-volatility smiles read straight from the DeepBook Predict oracles (OracleSVI) on Sui testnet, priced with the same SVI engine the protocol uses on-chain. One curve per live BTC expiry, refreshed continuously."
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
              label="BTC forward"
              value={surface.spot ? `$${formatNumber(surface.spot, 0)}` : "—"}
              sub="oracle spot, the surface anchor"
            />
            <StatCard
              label="Live markets"
              value={`${surface.liveCount}`}
              sub="active BTC oracles on Predict"
            />
            <StatCard
              label="Front ATM vol"
              value={front ? formatPercent(front.atmIv) : "—"}
              sub="nearest expiry, at-the-money"
            />
            <StatCard
              label="Front skew"
              value={front ? formatPercent(front.skew) : "—"}
              sub="downside − upside IV (5%)"
            />
          </>
        )}
      </div>

      {!loading && oracles.length === 0 && (
        <Panel className="p-6 lg:p-8 mt-6">
          <p className="text-sm text-muted-foreground">
            No live Predict markets right now. Oracles roll on sub-hourly BTC
            expiries; this updates as the next batch activates.
          </p>
        </Panel>
      )}

      {!loading && oracles.length > 0 && (
        <>
          <Panel className="p-6 lg:p-8 mt-6">
            <Tag>Implied-vol smiles</Tag>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Implied volatility (%) across strike, one curve per live expiry.
              Hover a tenor in the key to highlight its smile, or click to show
              and hide it. The tilt is skew; the gap between curves is the term
              structure of volatility.
            </p>
            <div className="mt-6">
              <TethraChart option={buildOption(oracles, now)} height={400} />
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2 mt-6">
            <Panel className="p-6 lg:p-8">
              <Tag>No-arbitrage checks</Tag>
              <div className="mt-6 grid grid-cols-2 gap-6">
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Butterfly
                  </span>
                  <span className="mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none">
                    {butterflyClean}/{oracles.length}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    smiles with monotone digital prices
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Calendar
                  </span>
                  <span className="mt-2 block text-4xl lg:text-5xl font-display tracking-tight leading-none">
                    {calendarClean}/{oracles.length}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    expiries with non-decreasing variance
                  </span>
                </div>
              </div>
              <p className="mt-6 text-sm text-muted-foreground leading-relaxed">
                We re-derive the UP (cash-or-nothing digital) price the protocol
                marks, then flag any vertical-spread (butterfly) or calendar
                arbitrage in the live surface. A clean surface keeps the
                vault&apos;s mark-to-market honest.
              </p>
            </Panel>

            <Panel className="p-6 lg:p-8">
              <Tag>Why it matters</Tag>
              <p className="mt-6 text-sm text-muted-foreground leading-relaxed">
                The PLP vault underwrites these markets, so its NAV is only as
                trustworthy as the surface it is priced on. This is the same SVI
                model Tethra validates against the protocol&apos;s on-chain ask to
                a median error of ~1e-5, now rendered live.
              </p>
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                A downward-sloping smile (negative skew) means the market pays up
                for downside; the term structure shows whether near or far
                expiries carry richer volatility.
              </p>
            </Panel>
          </div>

          <Panel className="p-6 lg:p-8 mt-6">
            <Tag>Live SVI parameters</Tag>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left font-mono text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="pb-3 pr-4 font-normal">Tenor</th>
                    <th className="pb-3 pr-4 font-normal">ATM vol</th>
                    <th className="pb-3 pr-4 font-normal">Skew</th>
                    <th className="pb-3 pr-4 font-normal">a</th>
                    <th className="pb-3 pr-4 font-normal">b</th>
                    <th className="pb-3 pr-4 font-normal">ρ</th>
                    <th className="pb-3 pr-4 font-normal">m</th>
                    <th className="pb-3 pr-4 font-normal">σ</th>
                    <th className="pb-3 font-normal">Checks</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {oracles.map((o) => {
                    const issues = [
                      !o.butterflyOk && "butterfly",
                      !o.calendarOk && "calendar",
                    ].filter(Boolean) as string[];
                    return (
                      <tr
                        key={o.oracleId}
                        className="border-t border-foreground/[0.06]"
                      >
                        <td className="py-3 pr-4">{tenorLabel(o.expiryMs - now)}</td>
                        <td className="py-3 pr-4">{formatPercent(o.atmIv)}</td>
                        <td className="py-3 pr-4">{formatPercent(o.skew)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{sci(o.svi.a)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{sci(o.svi.b)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{o.svi.rho.toFixed(3)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{sci(o.svi.m)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{sci(o.svi.sigma)}</td>
                        <td className="py-3">
                          {issues.length === 0 ? (
                            <span className="text-muted-foreground">clean</span>
                          ) : (
                            <span className="text-[#d98a8a]">{issues.join(", ")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className="p-6 lg:p-8 mt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AccentDot />
                <span className="text-sm text-muted-foreground">
                  Live from the DeepBook Predict oracles on Sui testnet.
                </span>
              </div>
              {front && (
                <a
                  href={explorerObject(front.oracleId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors"
                >
                  Front oracle
                </a>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
