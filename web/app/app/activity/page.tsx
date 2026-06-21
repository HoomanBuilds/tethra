"use client";

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { PACKAGE, explorerTx } from "@/lib/config";
import { LEND_ASSETS } from "@/lib/lend";
import { BORROW_MARKET } from "@/lib/borrow";
import { PageHeader, Panel, EmptyState, Tag } from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";

type ActionKind = "in" | "out" | "neutral";

interface ActivityRow {
  digest: string;
  label: string;
  kind: ActionKind;
  timestampMs: number | null;
  status: string;
}

// Sui normalizes object ids; compare the 0x-prefixed, padded forms.
function normalizeId(id: string): string {
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  return "0x" + hex.toLowerCase().padStart(64, "0");
}

const PLP_PKG = normalizeId(PACKAGE);
const LEND_PKG = normalizeId(LEND_ASSETS.sui.package);
const BORROW_PKG = normalizeId(BORROW_MARKET.package);

// Map a single Move call to a Tethra action label, across all three tiers.
function callAction(mv: any): { label: string; kind: ActionKind } | null {
  const pkg = normalizeId(mv.package);
  const fn = mv.function;

  if (pkg === PLP_PKG && mv.module === "vault") {
    if (fn === "deposit") return { label: "PLP deposit", kind: "in" };
    if (fn === "withdraw") return { label: "PLP withdraw", kind: "out" };
  }

  if (pkg === LEND_PKG && (mv.module === "lend_vault" || mv.module === "lend_vault_dbusdc")) {
    const sym = mv.module === "lend_vault" ? "SUI" : "DBUSDC";
    if (fn === "deposit") return { label: `Lend ${sym}`, kind: "in" };
    if (fn === "withdraw") return { label: `Withdraw ${sym}`, kind: "out" };
    if (fn === "compound") return { label: `Compound ${sym} referral`, kind: "neutral" };
  }

  if (pkg === BORROW_PKG && mv.module === "market") {
    if (fn === "supply") return { label: "Supply dUSDC", kind: "in" };
    if (fn === "unsupply") return { label: "Withdraw supply", kind: "out" };
    if (fn === "borrow") return { label: "Borrow dUSDC", kind: "out" };
    if (fn === "repay") return { label: "Repay dUSDC", kind: "in" };
    if (fn === "add_collateral") return { label: "Add collateral", kind: "in" };
    if (fn === "withdraw_collateral") return { label: "Withdraw collateral", kind: "out" };
  }

  return null;
}

// Collect every recognized Tethra action in a programmable transaction (a single
// PTB can do more than one, e.g. add collateral + borrow).
function txActions(tx: any): { label: string; kind: ActionKind }[] {
  const kind = tx?.transaction?.data?.transaction;
  if (!kind || kind.kind !== "ProgrammableTransaction") return [];
  const commands = Array.isArray(kind.transactions) ? kind.transactions : [];
  const out: { label: string; kind: ActionKind }[] = [];
  const seen = new Set<string>();
  for (const c of commands) {
    const mv = c?.MoveCall;
    if (!mv) continue;
    const a = callAction(mv);
    if (a && !seen.has(a.label)) {
      seen.add(a.label);
      out.push(a);
    }
  }
  return out;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Readable form, no dashes (e.g. "18 Jun 2026, 21:40").
function formatTimestamp(ms: number | null): string {
  if (!ms) return "Unknown time";
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

function shortDigest(digest: string): string {
  return digest.length > 14 ? `${digest.slice(0, 8)}…${digest.slice(-4)}` : digest;
}

const dotColor = (kind: ActionKind): string =>
  kind === "in" ? "#eca8d6" : kind === "out" ? "rgba(236,234,226,0.4)" : "rgba(236,234,226,0.25)";

export default function ActivityPage() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const address = account?.address ?? null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tethra-activity", address],
    enabled: !!address,
    queryFn: async (): Promise<ActivityRow[]> => {
      const rows: ActivityRow[] = [];
      let cursor: string | null = null;
      // Scan a few pages: the deployer/admin address has many non-Tethra txs.
      for (let page = 0; page < 3; page++) {
        const res = await client.queryTransactionBlocks({
          filter: { FromAddress: address as string },
          options: { showInput: true, showEffects: true },
          limit: 50,
          order: "descending",
          cursor,
        });
        for (const tx of res.data ?? []) {
          const acts = txActions(tx);
          if (acts.length === 0) continue;
          const status = tx.effects?.status?.status ?? "unknown";
          rows.push({
            digest: tx.digest,
            label: acts.map((a) => a.label).join(" + "),
            kind: acts[0].kind,
            timestampMs: tx.timestampMs ? Number(tx.timestampMs) : null,
            status:
              status === "success" ? "Success" : status === "failure" ? "Failed" : "Unknown",
          });
        }
        if (!res.hasNextPage || !res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return rows;
    },
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Activity"
        title="Your Tethra history."
        description="Every Tethra transaction signed from your connected address on Sui testnet: PLP, lend, supply, and borrow, read straight from chain."
      />

      {!address ? (
        <EmptyState
          title="Connect to see your activity"
          description="Your PLP, lend, supply, and borrow transactions on testnet will appear here."
          image="/images/connection.png"
          action={
            <ConnectWallet
              className="rounded-full bg-foreground text-background hover:bg-foreground/90 h-11 px-6"
              label="Connect wallet"
              showAccount={false}
            />
          }
        />
      ) : isLoading ? (
        <Panel className="p-8">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-[#eca8d6] animate-pulse" />
            Reading recent transactions from chain.
          </div>
        </Panel>
      ) : isError ? (
        <Panel className="p-8">
          <h3 className="text-xl font-display tracking-tight">Could not load activity</h3>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-md">
            The node did not return your transactions just now. Refresh the page
            to try again.
          </p>
        </Panel>
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No Tethra activity yet"
          description="Deposit, lend, supply, or borrow to get started."
          image="/images/connection.png"
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
            <Tag>Recent Tethra transactions</Tag>
            <span className="text-xs font-mono text-muted-foreground">
              {data.length} {data.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <ul>
            {data.map((row) => (
              <li
                key={row.digest}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-foreground/10 px-6 py-5 last:border-b-0"
              >
                <div className="flex items-center gap-4">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor(row.kind) }}
                  />
                  <div>
                    <span className="block font-medium">{row.label}</span>
                    <a
                      href={explorerTx(row.digest)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {shortDigest(row.digest)}
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatTimestamp(row.timestampMs)}
                  </span>
                  <span
                    className="text-xs font-mono uppercase tracking-wider"
                    style={{
                      color: row.status === "Success" ? "#eca8d6" : "var(--muted-foreground)",
                    }}
                  >
                    {row.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
