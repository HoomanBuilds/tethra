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
  type LendAsset,
  useAssetBalance,
  useLendShareBalance,
  useLendShares,
  GAS_RESERVE,
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

function DepositTab({ asset }: { asset: LendAsset }) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { balance: assetBalance } = useAssetBalance(account?.address, asset);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const debounced = useDebounced(amount);

  const [preview, setPreview] = useState<{ shares: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const maxDepositable = asset.isGasToken
    ? assetBalance > GAS_RESERVE
      ? assetBalance - GAS_RESERVE
      : 0n
    : assetBalance;

  const amountRaw = useMemo(() => {
    try {
      return parseUnits(amount, asset.decimals);
    } catch {
      return 0n;
    }
  }, [amount, asset.decimals]);

  const hasAmount = amountRaw > 0n;
  const overBalance = hasAmount && amountRaw > maxDepositable;
  const amountValid = hasAmount && !overBalance;

  useEffect(() => {
    let cancelled = false;
    const raw = (() => {
      try {
        return parseUnits(debounced, asset.decimals);
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
      const tx = buildLendDepositTx(asset, account.address, raw);
      const result = await simulateLendDeltas(client, tx, asset);
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
  }, [debounced, account?.address, maxDepositable, client, asset]);

  function onDeposit() {
    if (!account?.address || !amountValid) return;
    const tx = buildLendDepositTx(asset, account.address, amountRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Deposit submitted.", {
            description: `tl${asset.symbol} shares minted to your wallet.`,
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

  const noBalance = assetBalance === 0n;

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <FieldLabel>Amount, {asset.symbol}</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Wallet {formatNumber(fromUnits(assetBalance, asset.decimals))}
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
            onClick={() => setAmount(String(fromUnits(maxDepositable, asset.decimals)))}
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
            `${formatNumber(fromUnits(preview.shares, asset.decimals))} tl${asset.symbol}`
          ) : (
            <span className="text-muted-foreground">0 tl{asset.symbol}</span>
          )}
        </div>
        {hasAmount && !account && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Connect your wallet to preview and deposit.
          </p>
        )}
        {overBalance && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            {asset.isGasToken
              ? "Amount exceeds depositable balance (wallet minus 0.1 SUI gas reserve)."
              : "Amount exceeds your wallet balance."}
          </p>
        )}
        {preview && !preview.ok && previewError && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Preview unavailable. {previewError}
          </p>
        )}
      </div>

      {account && noBalance && !asset.isGasToken && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your wallet holds no {asset.symbol}. You can get testnet {asset.symbol} from the DeepBook testnet faucet.
        </p>
      )}

      {asset.isGasToken ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Yield is variable. Lending carries bad-debt risk if a borrower is not
          liquidated in time. 0.1 SUI is reserved for gas; Max reflects this.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Yield is variable. Lending carries bad-debt risk if a borrower is not
          liquidated in time.
        </p>
      )}

      {account ? (
        <Button
          className={submitClass}
          disabled={!amountValid || isSubmitting}
          onClick={onDeposit}
        >
          {isSubmitting ? "Confirming" : `Deposit ${asset.symbol}`}
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

function WithdrawTab({ asset }: { asset: LendAsset }) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { balance: shareBalance } = useLendShareBalance(account?.address, asset);
  const { coins: shareCoins } = useLendShares(account?.address, asset);
  const { mutate, isPending: isSubmitting } = useSignAndExecuteTransaction();

  const [amount, setAmount] = useState("");
  const debounced = useDebounced(amount);

  const [preview, setPreview] = useState<{ assetOut: bigint; ok: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | undefined>();

  const shareCoinIds = useMemo(
    () => shareCoins.map((c) => c.coinObjectId),
    [shareCoins],
  );

  const hasShares = shareBalance > 0n;

  const sharesRaw = useMemo(() => {
    try {
      const r = parseUnits(amount, asset.decimals);
      return r > shareBalance ? shareBalance : r;
    } catch {
      return 0n;
    }
  }, [amount, shareBalance]);

  const hasAmount = sharesRaw > 0n;

  function setPct(pct: number) {
    const target = (shareBalance * BigInt(pct)) / 100n;
    setAmount(String(fromUnits(target, asset.decimals)));
  }

  useEffect(() => {
    let cancelled = false;
    const raw = (() => {
      try {
        const r = parseUnits(debounced, asset.decimals);
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
      const tx = buildLendWithdrawTx(asset, account.address, shareCoinIds, raw);
      const result = await simulateLendDeltas(client, tx, asset);
      if (cancelled) return;
      if (!result.ok) {
        setPreview({ assetOut: 0n, ok: false });
        setPreviewError(result.error ?? "Preview unavailable.");
      } else {
        setPreview({ assetOut: result.asset, ok: true });
      }
      setPreviewLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, account?.address, shareBalance, shareCoinIds, client, asset]);

  function onWithdraw() {
    if (!account?.address || shareCoinIds.length === 0 || sharesRaw <= 0n) return;
    const tx = buildLendWithdrawTx(asset, account.address, shareCoinIds, sharesRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Withdrawal submitted.", {
            description: `${asset.symbol} sent to your wallet.`,
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
          <FieldLabel>Amount, tl{asset.symbol} shares</FieldLabel>
          <span className="text-xs font-mono text-muted-foreground">
            Shares {formatNumber(fromUnits(shareBalance, asset.decimals))}
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
            onClick={() => setAmount(String(fromUnits(shareBalance, asset.decimals)))}
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
        <FieldLabel>{asset.symbol} you receive, estimated</FieldLabel>
        <div className="mt-2 text-2xl font-display tracking-tight leading-none">
          {previewLoading ? (
            <Skeleton className="h-7 w-32" />
          ) : preview?.ok ? (
            `${formatNumber(fromUnits(preview.assetOut, asset.decimals))} ${asset.symbol}`
          ) : (
            <span className="text-muted-foreground">0 {asset.symbol}</span>
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
          No tl{asset.symbol} shares to withdraw yet. Deposit {asset.symbol} to receive shares.
        </p>
      )}

      {account ? (
        <Button
          className={submitClass}
          disabled={!hasAmount || isSubmitting}
          onClick={onWithdraw}
        >
          {isSubmitting ? "Confirming" : `Withdraw ${asset.symbol}`}
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

export function LendDepositWithdraw({ asset }: { asset: LendAsset }) {
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
          <DepositTab asset={asset} />
        </TabsContent>
        <TabsContent value="withdraw">
          <WithdrawTab asset={asset} />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
