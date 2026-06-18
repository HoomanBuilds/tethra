"use client";

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { PACKAGE, explorerTx } from "@/lib/config";
import { PageHeader, Panel, EmptyState, Tag } from "@/components/app/app-kit";

type VaultAction = "Deposit" | "Withdraw";

interface ActivityRow {
  digest: string;
  action: VaultAction;
  timestampMs: number | null;
  status: string;
}

// Sui normalizes object ids; compare the 0x-prefixed, padded forms.
function normalizeId(id: string): string {
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  return "0x" + hex.toLowerCase().padStart(64, "0");
}

const PACKAGE_NORM = normalizeId(PACKAGE);

const VAULT_FN: Record<string, VaultAction> = {
  deposit: "Deposit",
  withdraw: "Withdraw",
};

// Inspect the programmable transaction for a vault::deposit / vault::withdraw call.
function vaultAction(tx: any): VaultAction | null {
  const kind = tx?.transaction?.data?.transaction;
  if (!kind || kind.kind !== "ProgrammableTransaction") return null;
  const commands = Array.isArray(kind.transactions) ? kind.transactions : [];
  for (const c of commands) {
    const mv = c?.MoveCall;
    if (!mv) continue;
    if (mv.module !== "vault") continue;
    if (normalizeId(mv.package) !== PACKAGE_NORM) continue;
    const action = VAULT_FN[mv.function];
    if (action) return action;
  }
  return null;
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

export default function ActivityPage() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const address = account?.address ?? null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vault-activity", address],
    enabled: !!address,
    queryFn: async (): Promise<ActivityRow[]> => {
      const res = await client.queryTransactionBlocks({
        filter: { FromAddress: address as string },
        options: { showInput: true, showEffects: true },
        limit: 25,
        order: "descending",
      });
      const rows: ActivityRow[] = [];
      for (const tx of res.data ?? []) {
        const action = vaultAction(tx);
        if (!action) continue;
        const status = tx.effects?.status?.status ?? "unknown";
        rows.push({
          digest: tx.digest,
          action,
          timestampMs: tx.timestampMs ? Number(tx.timestampMs) : null,
          status: status === "success" ? "Success" : status === "failure" ? "Failed" : "Unknown",
        });
      }
      return rows;
    },
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        label="Activity"
        title="Your vault history."
        description="Deposits and withdrawals signed from your connected address on Sui testnet, read straight from chain."
      />

      {!address ? (
        <EmptyState
          title="Connect to see your activity"
          description="Your vault deposits and withdrawals on testnet will appear here."
          image="/images/connection.png"
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
          title="No vault activity yet"
          description="Deposit dUSDC to get started."
          image="/images/connection.png"
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
            <Tag>Recent vault transactions</Tag>
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
                    style={{
                      backgroundColor:
                        row.action === "Deposit" ? "#eca8d6" : "rgba(236,234,226,0.4)",
                    }}
                  />
                  <div>
                    <span className="block font-medium">{row.action}</span>
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
