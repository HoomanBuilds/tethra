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
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/app-kit";
import { useVaultState, useDusdcBalance, useShareBalance, useCoins } from "@/lib/vault";
import { buildDepositTx, buildWithdrawTx, simulateDeltas } from "@/lib/tx";
import {
  fromDusdc,
  fromShares,
  toDusdc,
  formatNumber,
  formatUsd,
} from "@/lib/format";
import { DUSDC_TYPE, SHARE_TYPE, FAUCET_URL, explorerTx } from "@/lib/config";

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

function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

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

  const amountValid = amountRaw > 0n && amountRaw <= dusdcBalance;
  const overCap =
    !!state &&
    state.depositCap > 0n &&
    state.costBasis + amountRaw > state.depositCap;

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

  const canSubmit =
    !!account && hasDusdc && amountValid && !overCap && !isSubmitting;

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
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            disabled={!account || !hasDusdc}
            className="font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            className="border-foreground/15 font-mono text-xs"
            disabled={!account || !hasDusdc}
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

      <Button
        className="w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
        disabled={!canSubmit}
        onClick={onDeposit}
      >
        {!account
          ? "Connect a wallet"
          : isSubmitting
            ? "Confirming"
            : "Deposit"}
      </Button>
    </div>
  );
}

const PCT_PRESETS = [25, 50, 75, 100];

function WithdrawTab() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { balance: shareBalance } = useShareBalance(account?.address);
  const { coins: shareCoins } = useCoins(account?.address, SHARE_TYPE);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [pct, setPct] = useState(100);
  const debouncedPct = useDebounced(pct);

  const [preview, setPreview] = useState<{ dusdc: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const shareCoinIds = useMemo(
    () => shareCoins.map((c) => c.coinObjectId),
    [shareCoins],
  );

  const hasShares = shareBalance > 0n;
  // bigint math, never float, to avoid precision loss on share proportions.
  const shares = (shareBalance * BigInt(pct)) / 100n;

  useEffect(() => {
    let cancelled = false;
    const sharesToWithdraw = (shareBalance * BigInt(debouncedPct)) / 100n;
    if (!account?.address || sharesToWithdraw <= 0n || shareCoinIds.length === 0) {
      setPreview(null);
      setPreviewError(undefined);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(undefined);
    (async () => {
      const tx = buildWithdrawTx(account.address, shareCoinIds, sharesToWithdraw);
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
  }, [debouncedPct, account?.address, shareBalance, shareCoinIds, client]);

  function onWithdraw() {
    if (!account?.address || shareCoinIds.length === 0 || shares <= 0n) return;
    const tx = buildWithdrawTx(account.address, shareCoinIds, shares);
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
          setPct(100);
          setPreview(null);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const canSubmit = !!account && hasShares && shares > 0n && !isSubmitting;

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <FieldLabel>Withdraw</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Shares {formatNumber(fromShares(shareBalance))}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-3xl font-display tracking-tight leading-none">
            {pct}%
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {formatNumber(fromShares(shares))} shares
          </span>
        </div>

        <Slider
          value={[pct]}
          min={0}
          max={100}
          step={1}
          disabled={!account || !hasShares}
          onValueChange={(v) => setPct(v[0] ?? 0)}
          className="mt-1"
        />

        <div className="mt-1 grid grid-cols-4 gap-2">
          {PCT_PRESETS.map((p) => (
            <Button
              key={p}
              variant="outline"
              size="sm"
              disabled={!account || !hasShares}
              onClick={() => setPct(p)}
              className={`border-foreground/15 font-mono text-xs ${
                pct === p ? "bg-foreground/[0.06]" : ""
              }`}
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

      <Button
        className="w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
        disabled={!canSubmit}
        onClick={onWithdraw}
      >
        {!account
          ? "Connect a wallet"
          : isSubmitting
            ? "Confirming"
            : "Withdraw"}
      </Button>
    </div>
  );
}

export function DepositWithdraw() {
  return (
    <Panel className="p-6 lg:p-8">
      <Tabs defaultValue="deposit">
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
