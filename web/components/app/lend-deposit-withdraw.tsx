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
import {
  useSuiBalance,
  useLendShareBalance,
  useLendShares,
  GAS_RESERVE,
  LEND_SHARE_DECIMALS,
  LEND_SUI_DECIMALS,
} from "@/lib/lend";
import {
  buildLendDepositTx,
  buildLendWithdrawTx,
  simulateLendDeltas,
} from "@/lib/lend-tx";
import { fromUnits, parseUnits, formatNumber } from "@/lib/format";
import { explorerTx } from "@/lib/config";

const PCT_PRESETS = [25, 50, 75, 100];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
      {children}
    </span>
  );
}

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
  const { balance: suiBalance } = useSuiBalance(account?.address);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const debounced = useDebounced(amount);

  const [preview, setPreview] = useState<{ shares: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const maxDepositable = suiBalance > GAS_RESERVE ? suiBalance - GAS_RESERVE : 0n;

  const amountRaw = useMemo(() => {
    try {
      return parseUnits(amount, LEND_SUI_DECIMALS);
    } catch {
      return 0n;
    }
  }, [amount]);

  const hasAmount = amountRaw > 0n;
  const overBalance = hasAmount && amountRaw > maxDepositable;
  const amountValid = hasAmount && !overBalance;

  useEffect(() => {
    let cancelled = false;
    const raw = (() => {
      try {
        return parseUnits(debounced, LEND_SUI_DECIMALS);
      } catch {
        return 0n;
      }
    })();
    if (!account?.address || raw <= 0n || raw > maxDepositable) {
      setPreview(null);
      setPreviewError(undefined);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(undefined);
    (async () => {
      const tx = buildLendDepositTx(account.address, raw);
      const result = await simulateLendDeltas(client, tx);
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
  }, [debounced, account?.address, maxDepositable, client]);

  function onDeposit() {
    if (!account?.address || !amountValid) return;
    const tx = buildLendDepositTx(account.address, amountRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Deposit submitted.", {
            description: "tlSUI shares minted to your wallet.",
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
          <FieldLabel>Amount, SUI</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Wallet {formatNumber(fromUnits(suiBalance, LEND_SUI_DECIMALS))}
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
            disabled={maxDepositable <= 0n || isSubmitting}
            onClick={() => setAmount(String(fromUnits(maxDepositable, LEND_SUI_DECIMALS)))}
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
            `${formatNumber(fromUnits(preview.shares, LEND_SHARE_DECIMALS))} tlSUI`
          ) : (
            <span className="text-muted-foreground">0 tlSUI</span>
          )}
        </div>
        {hasAmount && !account && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Connect your wallet to preview and deposit.
          </p>
        )}
        {overBalance && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Amount exceeds depositable balance (wallet minus 0.1 SUI gas reserve).
          </p>
        )}
        {preview && !preview.ok && previewError && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Preview unavailable. {previewError}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Yield is variable. Lending carries bad-debt risk if a borrower is not
        liquidated in time. 0.1 SUI is reserved for gas; Max reflects this.
      </p>

      {account ? (
        <Button
          className={submitClass}
          disabled={!amountValid || isSubmitting}
          onClick={onDeposit}
        >
          {isSubmitting ? "Confirming" : "Deposit SUI"}
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
  const { balance: shareBalance } = useLendShareBalance(account?.address);
  const { coins: shareCoins } = useLendShares(account?.address);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const debounced = useDebounced(amount);

  const [preview, setPreview] = useState<{ sui: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const shareCoinIds = useMemo(
    () => shareCoins.map((c) => c.coinObjectId),
    [shareCoins],
  );

  const hasShares = shareBalance > 0n;

  const sharesRaw = useMemo(() => {
    try {
      const r = parseUnits(amount, LEND_SHARE_DECIMALS);
      return r > shareBalance ? shareBalance : r;
    } catch {
      return 0n;
    }
  }, [amount, shareBalance]);

  const hasAmount = sharesRaw > 0n;

  function setPct(pct: number) {
    const target = (shareBalance * BigInt(pct)) / 100n;
    setAmount(String(fromUnits(target, LEND_SHARE_DECIMALS)));
  }

  useEffect(() => {
    let cancelled = false;
    const raw = (() => {
      try {
        const r = parseUnits(debounced, LEND_SHARE_DECIMALS);
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
      const tx = buildLendWithdrawTx(account.address, shareCoinIds, raw);
      const result = await simulateLendDeltas(client, tx);
      if (cancelled) return;
      if (!result.ok) {
        setPreview({ sui: 0n, ok: false });
        setPreviewError(result.error ?? "Preview unavailable.");
      } else {
        setPreview({ sui: result.sui, ok: true });
      }
      setPreviewLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, account?.address, shareBalance, shareCoinIds, client]);

  function onWithdraw() {
    if (!account?.address || shareCoinIds.length === 0 || sharesRaw <= 0n) return;
    const tx = buildLendWithdrawTx(account.address, shareCoinIds, sharesRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Withdrawal submitted.", {
            description: "SUI sent to your wallet.",
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
          <FieldLabel>Amount, tlSUI shares</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Shares {formatNumber(fromUnits(shareBalance, LEND_SHARE_DECIMALS))}
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
            onClick={() => setAmount(String(fromUnits(shareBalance, LEND_SHARE_DECIMALS)))}
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
        <FieldLabel>SUI you receive, estimated</FieldLabel>
        <div className="mt-2 text-2xl font-display tracking-tight leading-none">
          {previewLoading ? (
            <Skeleton className="h-7 w-32" />
          ) : preview?.ok ? (
            `${formatNumber(fromUnits(preview.sui, LEND_SUI_DECIMALS))} SUI`
          ) : (
            <span className="text-muted-foreground">0 SUI</span>
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

      {account && !hasShares && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No tlSUI shares to withdraw yet. Deposit SUI to receive shares.
        </p>
      )}

      {account ? (
        <Button
          className={submitClass}
          disabled={!hasAmount || isSubmitting}
          onClick={onWithdraw}
        >
          {isSubmitting ? "Confirming" : "Withdraw SUI"}
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

export function LendDepositWithdraw() {
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
