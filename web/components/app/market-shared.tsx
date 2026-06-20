"use client";

import { Panel, Tag, AccentDot } from "@/components/app/app-kit";
import { BORROW_MARKET } from "@/lib/borrow";
import { explorerObject, VAULT_ID } from "@/lib/config";

const linkClass =
  "font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-foreground/20 hover:decoration-foreground/60 transition-colors w-fit";

export function StatSkeleton() {
  return (
    <Panel className="p-6 lg:p-8">
      <span className="block h-3 w-24 rounded bg-foreground/10" />
      <span className="mt-4 block h-10 w-32 rounded bg-foreground/[0.06]" />
      <span className="mt-4 block h-3 w-28 rounded bg-foreground/10" />
    </Panel>
  );
}

export function PositionStat({
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

export function healthLabel(ltvBps: number, liqBps: number): { text: string; tone: string } {
  if (ltvBps === 0) return { text: "No debt", tone: "text-muted-foreground" };
  if (ltvBps >= liqBps) return { text: "Liquidatable", tone: "text-[#c2410c]" };
  if (ltvBps >= liqBps * 0.85) return { text: "At risk", tone: "text-[#c2410c]" };
  if (ltvBps >= liqBps * 0.6) return { text: "Caution", tone: "text-foreground" };
  return { text: "Healthy", tone: "text-foreground" };
}

export function HowItWorks({ points }: { points: { title: string; detail: string }[] }) {
  return (
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
          {points.map((point) => (
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
  );
}

export function ProtocolLinksPanel({ blurb }: { blurb: string }) {
  return (
    <Panel className="p-6 lg:p-8 mt-6 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center">
        <div>
          <Tag>Protocol</Tag>
          <p className="mt-4 text-muted-foreground leading-relaxed max-w-lg">{blurb}</p>
          <div className="mt-6 flex flex-col gap-3 text-sm">
            <a href={explorerObject(BORROW_MARKET.market)} target="_blank" rel="noreferrer" className={linkClass}>
              Market object
            </a>
            <a href={explorerObject(BORROW_MARKET.package)} target="_blank" rel="noreferrer" className={linkClass}>
              Move package
            </a>
            <a href={explorerObject(VAULT_ID)} target="_blank" rel="noreferrer" className={linkClass}>
              Tethra vault (collateral)
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
  );
}
