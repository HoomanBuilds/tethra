"use client";

import { backtest } from "@/lib/backtest-data";
import { TethraChart } from "@/components/app/chart";
import { CHART } from "@/lib/chart-theme";
import { PageHeader, Panel, StatCard, Tag } from "@/components/app/app-kit";

const { summary, nav, drawdown, feeYield, exposure, btc, pricing } = backtest;

const fmtPct = (x: number) => `${x >= 0 ? "" : ""}${x.toFixed(2)}%`;
const fmtBps = (x: number) => `${x}`;

// A small note shown inside a panel when a series has no real data to render.
function NotAvailable({ note }: { note: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
        Series not available. {note}
      </p>
    </div>
  );
}

function ChartPanel({
  caption,
  title,
  children,
}: {
  caption: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="p-6 lg:p-8">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h3 className="text-xl font-display tracking-tight">{title}</h3>
        <Tag>{caption}</Tag>
      </div>
      {children}
    </Panel>
  );
}

const axisTime = (data: { t: string }[]) => ({
  type: "category" as const,
  data: data.map((p) => p.t),
  boundaryGap: false,
  axisLabel: { hideOverlap: true, interval: Math.max(0, Math.floor(data.length / 6)) },
});

export default function AnalyticsPage() {
  const navOption = {
    xAxis: axisTime(nav),
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { formatter: (v: number) => v.toFixed(2) },
    },
    tooltip: { valueFormatter: (v: number) => Number(v).toFixed(3) },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "none",
        data: nav.map((p) => p.v),
        lineStyle: { color: CHART.accent, width: 2 },
        areaStyle: { color: CHART.accentSoft },
      },
    ],
  };

  const ddOption = {
    xAxis: axisTime(drawdown),
    yAxis: {
      type: "value",
      max: 0,
      axisLabel: { formatter: (v: number) => `${v.toFixed(2)}%` },
    },
    tooltip: { valueFormatter: (v: number) => `${Number(v).toFixed(3)}%` },
    series: [
      {
        type: "line",
        smooth: false,
        symbol: "none",
        data: drawdown.map((p) => p.v),
        lineStyle: { color: CHART.destructive, width: 1.5, opacity: 0.8 },
        areaStyle: { color: "rgba(217,138,138,0.12)" },
      },
    ],
  };

  const feeOption = {
    xAxis: axisTime(feeYield),
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => v.toFixed(3) },
    },
    tooltip: { valueFormatter: (v: number) => Number(v).toFixed(4) },
    series: [
      {
        type: "line",
        step: "end",
        symbol: "none",
        data: feeYield.map((p) => p.v),
        lineStyle: { color: CHART.accent, width: 2 },
        areaStyle: { color: CHART.accentFaint },
      },
    ],
  };

  const btcOption = {
    xAxis: axisTime(btc),
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { formatter: (v: number) => `${Math.round(v / 1000)}k` },
    },
    tooltip: { valueFormatter: (v: number) => `$${Number(v).toLocaleString("en-US")}` },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "none",
        data: btc.map((p) => p.v),
        lineStyle: { color: CHART.muted, width: 1.5 },
      },
    ],
  };

  const exposureCap = exposure.length ? exposure[0].cap : 0;
  const exposureOption = {
    xAxis: axisTime(exposure),
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => `$${Math.round(v)}` },
    },
    tooltip: { valueFormatter: (v: number) => `$${Number(v).toFixed(0)}` },
    series: [
      {
        type: "line",
        smooth: false,
        symbol: "none",
        data: exposure.map((p) => p.v),
        lineStyle: { color: CHART.accent, width: 2 },
        areaStyle: { color: CHART.accentFaint },
        markLine: {
          silent: true,
          symbol: "none",
          label: {
            formatter: `cap $${exposureCap}`,
            color: CHART.muted,
            fontFamily: CHART.font,
            fontSize: 11,
          },
          lineStyle: { color: CHART.muted, type: "dashed", width: 1 },
          data: [{ yAxis: exposureCap }],
        },
      },
    ],
  };

  const pricingOption = {
    grid: { left: 8, right: 18, top: 18, bottom: 28, containLabel: true },
    tooltip: {
      trigger: "item",
      formatter: (p: { data: number[] }) =>
        `model ${p.data[0].toFixed(4)}<br/>on-chain ${p.data[1].toFixed(4)}`,
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 1,
      name: "model N(d2) + spread",
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { color: CHART.muted, fontFamily: CHART.font, fontSize: 11 },
      axisLabel: { formatter: (v: number) => v.toFixed(2) },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      name: "on-chain ask",
      axisLabel: { formatter: (v: number) => v.toFixed(2) },
    },
    series: [
      {
        type: "line",
        symbol: "none",
        data: [
          [0, 0],
          [1, 1],
        ],
        lineStyle: { color: CHART.muted, type: "dashed", width: 1 },
        silent: true,
        z: 1,
      },
      {
        type: "scatter",
        symbolSize: 6,
        data: pricing.map((p) => [p.model, p.actual]),
        itemStyle: { color: CHART.accent, opacity: 0.55 },
        z: 2,
      },
    ],
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/real-time-graph.png"
            alt=""
            aria-hidden="true"
            className="h-64 w-2/3 object-contain object-right opacity-[0.10]"
          />
        </div>
        <div className="relative z-10">
          <PageHeader
            label="Analytics"
            title="Evidence, not promises."
            description="Every series below is a backtest over real DeepBook Predict testnet flow. It is not a forward return guarantee."
          />
        </div>
      </div>

      <Panel className="mb-12 flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <span className="flex items-center gap-2 bg-[#eca8d6]/10 px-3 py-1 text-xs font-mono text-[#eca8d6] uppercase tracking-wider">
          <span className="h-2 w-2 rounded-full bg-[#eca8d6]" />
          Backtest
        </span>
        <span className="text-sm text-muted-foreground">
          Backtest over real testnet flow, {summary.windowLabel}.
        </span>
      </Panel>

      <div className="mb-12 grid gap-px bg-foreground/10 sm:grid-cols-2 lg:grid-cols-4 border border-foreground/10">
        <StatCard
          label="House edge"
          value={fmtBps(summary.houseEdgeBps)}
          sub="basis points, premium over payouts"
          className="border-0"
        />
        <StatCard
          label="Max drawdown"
          value={fmtPct(summary.maxDrawdownPct)}
          sub="running peak to trough on NAV"
          className="border-0"
        />
        <StatCard
          label="Net yield"
          value={fmtPct(summary.netYieldPct)}
          sub={`over the window, after ${summary.feeToVaultPct}% fee`}
          className="border-0"
        />
        <StatCard
          label="Pricing match"
          value={`~${summary.pricingMedianErr.toExponential(0).replace("e+", "e").replace("e-", "e-")}`}
          sub="median ask error vs on-chain"
          className="border-0"
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <ChartPanel caption="Backtest NAV, indexed to 100" title="Vault NAV">
          {nav.length ? (
            <TethraChart option={navOption} height={300} />
          ) : (
            <NotAvailable note="No settled house PnL was found in the committed flow." />
          )}
        </ChartPanel>

        <ChartPanel caption="Running peak to trough" title="Drawdown">
          {drawdown.length ? (
            <TethraChart option={ddOption} height={300} />
          ) : (
            <NotAvailable note="NAV series is empty, so drawdown cannot be computed." />
          )}
        </ChartPanel>

        <ChartPanel caption="Cumulative fee to the vault" title="Fee yield accrual">
          {feeYield.length ? (
            <TethraChart option={feeOption} height={300} />
          ) : (
            <NotAvailable note="No positive NAV increments accrued a fee." />
          )}
        </ChartPanel>

        <ChartPanel caption="BTC daily close, regime context" title="BTC regime">
          {btc.length ? (
            <TethraChart option={btcOption} height={300} />
          ) : (
            <NotAvailable note="No BTC price history was available." />
          )}
        </ChartPanel>

        <ChartPanel caption="Open notional per oracle vs cap" title="Exposure vs cap">
          {exposure.length ? (
            <TethraChart option={exposureOption} height={300} />
          ) : (
            <NotAvailable note="No open notional was recorded in the flow." />
          )}
        </ChartPanel>

        {pricing.length ? (
          <ChartPanel caption="Model N(d2) plus spread vs on-chain ask" title="Pricing accuracy">
            <TethraChart option={pricingOption} height={300} />
          </ChartPanel>
        ) : (
          <Panel className="p-6 lg:p-8">
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h3 className="text-xl font-display tracking-tight">Pricing accuracy</h3>
              <Tag>Validated offline against on-chain ask</Tag>
            </div>
            <div className="flex flex-col items-start gap-3">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Median ask error
              </span>
              <span className="text-5xl font-display tracking-tight leading-none">
                ~{summary.pricingMedianErr.toExponential(0).replace("e-", "e-")}
              </span>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-sm">
                The on-chain ask is a probability in [0, 1]. The scatter is not
                available in this build; the median error of the modeled ask
                against the recorded on-chain ask was validated offline.
              </p>
            </div>
          </Panel>
        )}
      </div>

      <p className="mt-10 text-sm text-muted-foreground leading-relaxed max-w-3xl">
        Derived from a passive PLP house backtest over settled oracles in the
        committed testnet flow. NAV compounds realized house PnL against the
        configured pool size. Drawdown is running peak to trough. Fee yield is
        the cumulative 15 percent performance fee on new profit. Pricing pairs
        compare the SVI model ask to the recorded on-chain ask.
      </p>
    </div>
  );
}
