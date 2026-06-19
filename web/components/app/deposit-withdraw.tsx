"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useCurrentAccount,
  useSuiClient,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { useVaultState, useDusdcBalance, useShareBalance, useCoins } from "@/lib/vault";
import { buildDepositTx, buildWithdrawTx, simulateDeltas } from "@/lib/tx";
import {
  fromDusdc,
  fromShares,
  toDusdc,
  toShares,
  formatNumber,
  formatUsd,
} from "@/lib/format";
import { DUSDC_TYPE, SHARE_TYPE, FAUCET_URL, explorerTx } from "@/lib/config";

const PCT_PRESETS = [25, 50, 75, 100];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
      {children}
    </span>
  );
}

function FaucetNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground leading-relaxed">
      {children}{" "}
      <a
        href={FAUCET_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Use the testnet faucet
      </a>
      .
    </p>
  );
}

// Keep only digits and a single decimal point.
function sanitizeDecimal(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  return parts.length <= 1 ? cleaned : `${parts[0]}.${parts.slice(1).join("")}`;
}

function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const submitClass =
  "w-full rounded-full bg-foreground text-background hover:bg-foreground/90 h-11";

function DepositTab() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { state } = useVaultState();
  const { balance: dusdcBalance } = useDusdcBalance(account?.address);
  const { coins: dusdcCoins } = useCoins(account?.address, DUSDC_TYPE);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const debounced = useDebounced(amount);

  const [preview, setPreview] = useState<{ shares: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const dusdcCoinIds = useMemo(
    () => dusdcCoins.map((c) => c.coinObjectId),
    [dusdcCoins],
  );

  const hasDusdc = dusdcBalance > 0n;
  const amountRaw = useMemo(() => {
    try {
      return toDusdc(amount);
    } catch {
      return 0n;
    }
  }, [amount]);

  const hasAmount = amountRaw > 0n;
  const overBalance = hasAmount && amountRaw > dusdcBalance;
  const overCap =
    !!state &&
    state.depositCap > 0n &&
    state.costBasis + amountRaw > state.depositCap;
  const amountValid = hasAmount && !overBalance && !overCap;

  useEffect(() => {
    let cancelled = false;
    const raw = (() => {
      try {
        return toDusdc(debounced);
      } catch {
        return 0n;
      }
    })();
    if (!account?.address || raw <= 0n || raw > dusdcBalance || dusdcCoinIds.length === 0) {
      setPreview(null);
      setPreviewError(undefined);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(undefined);
    (async () => {
      const tx = buildDepositTx(account.address, dusdcCoinIds, raw);
      const result = await simulateDeltas(client, tx);
      if (cancelled) return;
      if (!result.ok) {
        setPreview({ shares: 0n, ok: false });
        setPreviewError(result.error ?? "Preview unavailable.");
      } else {
        setPreview({ shares: result.shares, ok: true });
      }
      setPreviewLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, account?.address, dusdcBalance, dusdcCoinIds, client]);

  function onDeposit() {
    if (!account?.address || dusdcCoinIds.length === 0) return;
    const tx = buildDepositTx(account.address, dusdcCoinIds, amountRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Deposit submitted.", {
            description: "Shares minted to your wallet.",
            action: {
              label: "View",
              onClick: () => window.open(explorerTx(res.digest), "_blank"),
            },
          });
          setAmount("");
          setPreview(null);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <FieldLabel>Amount, dUSDC</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Wallet {formatNumber(fromDusdc(dusdcBalance))}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(sanitizeDecimal(e.target.value))}
            disabled={isSubmitting}
            className="font-mono text-base"
          />
          <Button
            variant="outline"
            size="sm"
            className="border-foreground/15 font-mono text-xs"
            disabled={!hasDusdc || isSubmitting}
            onClick={() => setAmount(String(fromDusdc(dusdcBalance)))}
          >
            Max
          </Button>
        </div>
      </div>

      <div className="border border-foreground/10 bg-foreground/[0.02] p-4">
        <FieldLabel>You receive, estimated</FieldLabel>
        <div className="mt-2 text-2xl font-display tracking-tight leading-none">
          {previewLoading ? (
            <Skeleton className="h-7 w-32" />
          ) : preview?.ok ? (
            `${formatNumber(fromShares(preview.shares))} shares`
          ) : (
            <span className="text-muted-foreground">0 shares</span>
          )}
        </div>
        {hasAmount && !account && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Connect your wallet to preview and deposit.
          </p>
        )}
        {overBalance && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Amount exceeds your wallet balance.
          </p>
        )}
        {preview && !preview.ok && previewError && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Preview unavailable. {previewError}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Performance fee is 15% on profit only, taken at withdrawal. 85% stays
        with you. No management fee.
      </p>

      {account && !hasDusdc && (
        <FaucetNote>No dUSDC in this wallet yet.</FaucetNote>
      )}

      {overCap && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          This deposit would exceed the vault cap of{" "}
          {state ? formatUsd(fromDusdc(state.depositCap)) : ""}. Try a smaller
          amount.
        </p>
      )}

      {account ? (
        <Button
          className={submitClass}
          disabled={!amountValid || isSubmitting}
          onClick={onDeposit}
        >
          {isSubmitting ? "Confirming" : "Deposit"}
        </Button>
      ) : (
        <ConnectWallet
          className={submitClass}
          label="Connect a wallet to deposit"
          showAccount={false}
        />
      )}
    </div>
  );
}

function WithdrawTab() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { balance: shareBalance } = useShareBalance(account?.address);
  const { coins: shareCoins } = useCoins(account?.address, SHARE_TYPE);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const debounced = useDebounced(amount);

  const [preview, setPreview] = useState<{ dusdc: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const shareCoinIds = useMemo(
    () => shareCoins.map((c) => c.coinObjectId),
    [shareCoins],
  );

  const hasShares = shareBalance > 0n;

  // Parse the typed share amount, clamped to the balance (bigint, no float loss).
  const sharesRaw = useMemo(() => {
    try {
      const r = toShares(amount);
      return r > shareBalance ? shareBalance : r;
    } catch {
      return 0n;
    }
  }, [amount, shareBalance]);

  const hasAmount = sharesRaw > 0n;

  function setPct(pct: number) {
    const target = (shareBalance * BigInt(pct)) / 100n;
    setAmount(String(fromShares(target)));
  }

  useEffect(() => {
    let cancelled = false;
    const raw = (() => {
      try {
        const r = toShares(debounced);
        return r > shareBalance ? shareBalance : r;
      } catch {
        return 0n;
      }
    })();
    if (!account?.address || raw <= 0n || shareCoinIds.length === 0) {
      setPreview(null);
      setPreviewError(undefined);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(undefined);
    (async () => {
      const tx = buildWithdrawTx(account.address, shareCoinIds, raw);
      const result = await simulateDeltas(client, tx);
      if (cancelled) return;
      if (!result.ok) {
        setPreview({ dusdc: 0n, ok: false });
        setPreviewError(result.error ?? "Preview unavailable.");
      } else {
        setPreview({ dusdc: result.dusdc, ok: true });
      }
      setPreviewLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, account?.address, shareBalance, shareCoinIds, client]);

  function onWithdraw() {
    if (!account?.address || shareCoinIds.length === 0 || sharesRaw <= 0n) return;
    const tx = buildWithdrawTx(account.address, shareCoinIds, sharesRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Withdrawal submitted.", {
            description: "dUSDC sent to your wallet, net of fee.",
            action: {
              label: "View",
              onClick: () => window.open(explorerTx(res.digest), "_blank"),
            },
          });
          setAmount("");
          setPreview(null);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <FieldLabel>Amount, shares</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Shares {formatNumber(fromShares(shareBalance))}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(sanitizeDecimal(e.target.value))}
            disabled={isSubmitting}
            className="font-mono text-base"
          />
          <Button
            variant="outline"
            size="sm"
            className="border-foreground/15 font-mono text-xs"
            disabled={!hasShares || isSubmitting}
            onClick={() => setAmount(String(fromShares(shareBalance)))}
          >
            Max
          </Button>
        </div>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {PCT_PRESETS.map((p) => (
            <Button
              key={p}
              variant="outline"
              size="sm"
              disabled={!hasShares || isSubmitting}
              onClick={() => setPct(p)}
              className="border-foreground/15 font-mono text-xs"
            >
              {p}%
            </Button>
          ))}
        </div>
      </div>

      <div className="border border-foreground/10 bg-foreground/[0.02] p-4">
        <FieldLabel>You receive, estimated, net of fee, live</FieldLabel>
        <div className="mt-2 text-2xl font-display tracking-tight leading-none">
          {previewLoading ? (
            <Skeleton className="h-7 w-32" />
          ) : preview?.ok ? (
            formatUsd(fromDusdc(preview.dusdc))
          ) : (
            <span className="text-muted-foreground">{formatUsd(0)}</span>
          )}
        </div>
        {hasAmount && !account && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Connect your wallet to preview and withdraw.
          </p>
        )}
        {preview && !preview.ok && previewError && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Preview unavailable. {previewError}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Shares burn on withdrawal. The 15% performance fee applies to profit
        only, and is already reflected in the estimate above.
      </p>

      {account && !hasShares && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No shares to withdraw yet. Deposit dUSDC to receive plpVAULT shares.
        </p>
      )}

      {account ? (
        <Button
          className={submitClass}
          disabled={!hasAmount || isSubmitting}
          onClick={onWithdraw}
        >
          {isSubmitting ? "Confirming" : "Withdraw"}
        </Button>
      ) : (
        <ConnectWallet
          className={submitClass}
          label="Connect a wallet to withdraw"
          showAccount={false}
        />
      )}
    </div>
  );
}

export function DepositWithdraw() {
  const [tab, setTab] = useState("deposit");
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#withdraw") {
      setTab("withdraw");
    }
  }, []);
  return (
    <Panel className="p-6 lg:p-8">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 bg-foreground/[0.04]">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit">
          <DepositTab />
        </TabsContent>
        <TabsContent value="withdraw">
          <WithdrawTab />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
