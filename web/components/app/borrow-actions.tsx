"use client";

import { useMemo, useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/app-kit";
import { ConnectWallet } from "@/components/app/connect-wallet";
import {
  BORROW_MARKET,
  type MarketState,
  type Position,
  TPUSDC_DECIMALS,
  DUSDC_DECIMALS,
  TPLP_DECIMALS,
  BPS,
  previewSupply,
  previewUnsupply,
  collateralValue,
  ltvBps,
  maxBorrowable,
  useTpusdcBalance,
  useCoinObjects,
  buildSupplyTx,
  buildUnsupplyTx,
  buildBorrowTx,
  buildRepayTx,
} from "@/lib/borrow";
import {
  type VaultState,
  useDusdcBalance,
  useShareBalance,
  useCoins,
} from "@/lib/vault";
import { fromUnits, parseUnits, formatNumber, formatPercent } from "@/lib/format";
import { explorerTx, DUSDC_TYPE, SHARE_TYPE } from "@/lib/config";

const submitClass =
  "w-full rounded-full bg-foreground text-background hover:bg-foreground/90 h-11";
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

function parse(input: string, decimals: number): bigint {
  try {
    return parseUnits(input, decimals);
  } catch {
    return 0n;
  }
}

function Preview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-foreground/10 bg-foreground/[0.02] p-4">
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-2 text-2xl font-display tracking-tight leading-none">
        {children}
      </div>
    </div>
  );
}

function AmountField({
  label,
  hint,
  value,
  onChange,
  onMax,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onMax?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="text-xs font-mono text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(sanitizeDecimal(e.target.value))}
          disabled={disabled}
          className="font-mono text-base"
        />
        {onMax && (
          <Button
            variant="outline"
            size="sm"
            className="border-foreground/15 font-mono text-xs"
            disabled={disabled}
            onClick={onMax}
          >
            Max
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------- Supply side (lenders) ----------------

function SupplyTab({ market, totalAssets }: { market: MarketState; totalAssets: bigint }) {
  const account = useCurrentAccount();
  const { balance } = useDusdcBalance(account?.address);
  const { coins } = useCoins(account?.address, DUSDC_TYPE);
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [amount, setAmount] = useState("");

  const raw = useMemo(() => parse(amount, DUSDC_DECIMALS), [amount]);
  const overBalance = raw > balance;
  const valid = raw > 0n && !overBalance;
  const sharesOut = valid
    ? previewSupply(raw, market.supplyTotal, totalAssets)
    : 0n;

  function onSubmit() {
    if (!account?.address || !valid) return;
    const tx = buildSupplyTx(account.address, coins.map((c) => c.coinObjectId), raw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Supplied to the market.", {
            description: "tpUSDC minted to your wallet.",
            action: { label: "View", onClick: () => window.open(explorerTx(res.digest), "_blank") },
          });
          setAmount("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <AmountField
        label="Supply, dUSDC"
        hint={`Wallet ${formatNumber(fromUnits(balance, DUSDC_DECIMALS))}`}
        value={amount}
        onChange={setAmount}
        onMax={() => setAmount(String(fromUnits(balance, DUSDC_DECIMALS)))}
        disabled={isPending}
      />
      <Preview label="You receive, estimated">
        {valid ? (
          `${formatNumber(fromUnits(sharesOut, TPUSDC_DECIMALS))} tpUSDC`
        ) : (
          <span className="text-muted-foreground">0 tpUSDC</span>
        )}
      </Preview>
      {overBalance && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Amount exceeds your dUSDC balance.
        </p>
      )}
      <p className="text-xs text-muted-foreground leading-relaxed">
        You earn interest paid by borrowers. tpUSDC redeems for more dUSDC over time.
        Withdraw any time, subject to available reserve.
      </p>
      {account ? (
        <Button className={submitClass} disabled={!valid || isPending} onClick={onSubmit}>
          {isPending ? "Confirming" : "Supply dUSDC"}
        </Button>
      ) : (
        <ConnectWallet className={submitClass} label="Connect a wallet to supply" showAccount={false} />
      )}
    </div>
  );
}

function WithdrawSupplyTab({ market, totalAssets }: { market: MarketState; totalAssets: bigint }) {
  const account = useCurrentAccount();
  const { balance } = useTpusdcBalance(account?.address);
  const tpusdc = useCoinObjects(account?.address, BORROW_MARKET.tpusdcType);
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [amount, setAmount] = useState("");

  const raw = useMemo(() => {
    const r = parse(amount, TPUSDC_DECIMALS);
    return r > balance ? balance : r;
  }, [amount, balance]);
  const valid = raw > 0n;
  const dusdcOut = valid ? previewUnsupply(raw, market.supplyTotal, totalAssets) : 0n;
  const overReserve = dusdcOut > market.reserve;

  function onSubmit() {
    if (!account?.address || !valid) return;
    const tx = buildUnsupplyTx(account.address, tpusdc.ids, raw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Withdrawal submitted.", {
            description: "dUSDC sent to your wallet.",
            action: { label: "View", onClick: () => window.open(explorerTx(res.digest), "_blank") },
          });
          setAmount("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <AmountField
        label="Withdraw, tpUSDC"
        hint={`Held ${formatNumber(fromUnits(balance, TPUSDC_DECIMALS))}`}
        value={amount}
        onChange={setAmount}
        onMax={() => setAmount(String(fromUnits(balance, TPUSDC_DECIMALS)))}
        disabled={isPending}
      />
      <div className="grid grid-cols-4 gap-2">
        {PCT_PRESETS.map((p) => (
          <Button
            key={p}
            variant="outline"
            size="sm"
            disabled={balance === 0n || isPending}
            onClick={() => setAmount(String(fromUnits((balance * BigInt(p)) / 100n, TPUSDC_DECIMALS)))}
            className="border-foreground/15 font-mono text-xs"
          >
            {p}%
          </Button>
        ))}
      </div>
      <Preview label="dUSDC you receive, estimated">
        {valid ? (
          `${formatNumber(fromUnits(dusdcOut, DUSDC_DECIMALS))} dUSDC`
        ) : (
          <span className="text-muted-foreground">0 dUSDC</span>
        )}
      </Preview>
      {overReserve && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Not enough idle reserve to withdraw this amount right now. Reserve is lent out;
          withdraw less or wait for repayments.
        </p>
      )}
      {account ? (
        <Button className={submitClass} disabled={!valid || overReserve || isPending} onClick={onSubmit}>
          {isPending ? "Confirming" : "Withdraw dUSDC"}
        </Button>
      ) : (
        <ConnectWallet className={submitClass} label="Connect a wallet to withdraw" showAccount={false} />
      )}
    </div>
  );
}

export function SupplyCard({ market, totalAssets }: { market: MarketState; totalAssets: bigint }) {
  return (
    <Panel className="p-6 lg:p-8">
      <Tabs defaultValue="supply">
        <TabsList className="grid w-full grid-cols-2 bg-foreground/[0.04]">
          <TabsTrigger value="supply">Supply</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="supply">
          <SupplyTab market={market} totalAssets={totalAssets} />
        </TabsContent>
        <TabsContent value="withdraw">
          <WithdrawSupplyTab market={market} totalAssets={totalAssets} />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}

// ---------------- Borrow side ----------------

function LtvBar({ ltv, maxLtv, liqLtv }: { ltv: number; maxLtv: number; liqLtv: number }) {
  const pct = Math.min(100, (ltv / BPS) * 100);
  const over = ltv > maxLtv;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <FieldLabel>Projected LTV</FieldLabel>
        <span className={`text-sm font-mono ${over ? "text-[#c2410c]" : "text-foreground"}`}>
          {formatPercent(ltv / BPS)} / {formatPercent(maxLtv / BPS)} max
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-foreground/10 overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-[#c2410c]" : "bg-foreground"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        Liquidation at {formatPercent(liqLtv / BPS)} LTV. Collateral valued at the vault cost-basis floor.
      </span>
    </div>
  );
}

function BorrowTab({
  market,
  vault,
  position,
}: {
  market: MarketState;
  vault: VaultState | undefined;
  position: Position | null;
}) {
  const account = useCurrentAccount();
  const { balance: tplpBalance } = useShareBalance(account?.address);
  const { coins: tplpCoins } = useCoins(account?.address, SHARE_TYPE);
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [collateral, setCollateral] = useState("");
  const [borrow, setBorrow] = useState("");

  const collRaw = useMemo(() => {
    const r = parse(collateral, TPLP_DECIMALS);
    return r > tplpBalance ? tplpBalance : r;
  }, [collateral, tplpBalance]);
  const borrowRaw = useMemo(() => parse(borrow, DUSDC_DECIMALS), [borrow]);

  const curColl = position?.collateral ?? 0n;
  const curDebt = position?.debt ?? 0n;
  const costBasis = vault?.costBasis ?? 0n;
  const totalShares = vault?.totalShares ?? 0n;

  const projColl = curColl + collRaw;
  const projCollValue = collateralValue(projColl, costBasis, totalShares);
  const borrowPower = maxBorrowable(projCollValue, market.maxLtvBps, curDebt);
  const cappedPower = borrowPower > market.reserve ? market.reserve : borrowPower;
  const projDebt = curDebt + borrowRaw;
  const projLtv = ltvBps(projDebt, projCollValue);

  const noValue = projCollValue === 0n && projColl > 0n;
  const overReserve = borrowRaw > market.reserve;
  const overLtv = projLtv > market.maxLtvBps;
  const anything = collRaw > 0n || borrowRaw > 0n;
  const valid = anything && !overReserve && !overLtv && !(borrowRaw > 0n && noValue);

  function onSubmit() {
    if (!account?.address || !valid) return;
    const tx = buildBorrowTx(account.address, tplpCoins.map((c) => c.coinObjectId), collRaw, borrowRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Borrow submitted.", {
            description: borrowRaw > 0n ? "dUSDC sent to your wallet." : "Collateral added.",
            action: { label: "View", onClick: () => window.open(explorerTx(res.digest), "_blank") },
          });
          setCollateral("");
          setBorrow("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <AmountField
        label="Add collateral, tPLP"
        hint={`Wallet ${formatNumber(fromUnits(tplpBalance, TPLP_DECIMALS))}`}
        value={collateral}
        onChange={setCollateral}
        onMax={() => setCollateral(String(fromUnits(tplpBalance, TPLP_DECIMALS)))}
        disabled={isPending}
      />
      <AmountField
        label="Borrow, dUSDC"
        hint={`Available ${formatNumber(fromUnits(cappedPower, DUSDC_DECIMALS))}`}
        value={borrow}
        onChange={setBorrow}
        onMax={() => setBorrow(String(fromUnits(cappedPower, DUSDC_DECIMALS)))}
        disabled={isPending}
      />
      <LtvBar ltv={projLtv} maxLtv={market.maxLtvBps} liqLtv={market.liqThresholdBps} />
      {noValue && borrowRaw > 0n && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          tPLP has no cost-basis value yet (the Predict vault holds no deposits), so it
          cannot back a loan. Add collateral now; borrow once the vault has deposits.
        </p>
      )}
      {overReserve && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Borrow exceeds the market reserve ({formatNumber(fromUnits(market.reserve, DUSDC_DECIMALS))} dUSDC available).
        </p>
      )}
      {overLtv && !noValue && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          That borrow would exceed the {formatPercent(market.maxLtvBps / BPS)} max LTV. Add collateral or borrow less.
        </p>
      )}
      {account ? (
        <Button className={submitClass} disabled={!valid || isPending} onClick={onSubmit}>
          {isPending ? "Confirming" : borrowRaw > 0n ? "Borrow dUSDC" : "Add collateral"}
        </Button>
      ) : (
        <ConnectWallet className={submitClass} label="Connect a wallet to borrow" showAccount={false} />
      )}
    </div>
  );
}

function RepayTab({
  market,
  vault,
  position,
}: {
  market: MarketState;
  vault: VaultState | undefined;
  position: Position | null;
}) {
  const account = useCurrentAccount();
  const { balance: dusdcBalance } = useDusdcBalance(account?.address);
  const { coins: dusdcCoins } = useCoins(account?.address, DUSDC_TYPE);
  const { mutate, isPending } = useSignAndExecuteTransaction();
  const [repay, setRepay] = useState("");
  const [withdraw, setWithdraw] = useState("");

  const curColl = position?.collateral ?? 0n;
  const curDebt = position?.debt ?? 0n;
  const costBasis = vault?.costBasis ?? 0n;
  const totalShares = vault?.totalShares ?? 0n;

  const repayRaw = useMemo(() => {
    const r = parse(repay, DUSDC_DECIMALS);
    const cap = curDebt < dusdcBalance ? curDebt : dusdcBalance;
    return r > cap ? cap : r;
  }, [repay, curDebt, dusdcBalance]);
  const withdrawRaw = useMemo(() => {
    const r = parse(withdraw, TPLP_DECIMALS);
    return r > curColl ? curColl : r;
  }, [withdraw, curColl]);

  const remainingDebt = curDebt > repayRaw ? curDebt - repayRaw : 0n;
  const remainingColl = curColl - withdrawRaw;
  const remainingValue = collateralValue(remainingColl, costBasis, totalShares);
  const projLtv = ltvBps(remainingDebt, remainingValue);
  const overLtv = remainingDebt > 0n && projLtv > market.maxLtvBps;
  const anything = repayRaw > 0n || withdrawRaw > 0n;
  const valid = anything && !overLtv;

  // Largest collateral withdrawal that keeps remaining debt within max LTV.
  function safeMaxWithdraw(): bigint {
    if (remainingDebt === 0n) return curColl;
    if (totalShares === 0n || costBasis === 0n) return 0n;
    const requiredValue = (remainingDebt * BigInt(BPS)) / BigInt(market.maxLtvBps);
    const requiredColl = (requiredValue * totalShares) / costBasis;
    return curColl > requiredColl ? curColl - requiredColl : 0n;
  }

  function onSubmit() {
    if (!account?.address || !valid) return;
    const tx = buildRepayTx(account.address, dusdcCoins.map((c) => c.coinObjectId), repayRaw, withdrawRaw);
    mutate(
      { transaction: tx },
      {
        onSuccess: (res) => {
          toast.success("Submitted.", {
            description: "Position updated.",
            action: { label: "View", onClick: () => window.open(explorerTx(res.digest), "_blank") },
          });
          setRepay("");
          setWithdraw("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const noDebt = curDebt === 0n;
  const noColl = curColl === 0n;

  return (
    <div className="flex flex-col gap-5 pt-2">
      <AmountField
        label="Repay, dUSDC"
        hint={`Debt ${formatNumber(fromUnits(curDebt, DUSDC_DECIMALS))}`}
        value={repay}
        onChange={setRepay}
        onMax={() => setRepay(String(fromUnits(curDebt < dusdcBalance ? curDebt : dusdcBalance, DUSDC_DECIMALS)))}
        disabled={isPending || noDebt}
      />
      <AmountField
        label="Withdraw collateral, tPLP"
        hint={`Locked ${formatNumber(fromUnits(curColl, TPLP_DECIMALS))}`}
        value={withdraw}
        onChange={setWithdraw}
        onMax={() => setWithdraw(String(fromUnits(safeMaxWithdraw(), TPLP_DECIMALS)))}
        disabled={isPending || noColl}
      />
      {!noDebt && (
        <LtvBar ltv={projLtv} maxLtv={market.maxLtvBps} liqLtv={market.liqThresholdBps} />
      )}
      {overLtv && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Withdrawing that much would push remaining debt past the max LTV. Repay more or withdraw less.
        </p>
      )}
      {noDebt && noColl && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          You have no open position. Add collateral and borrow on the Borrow tab.
        </p>
      )}
      {account ? (
        <Button className={submitClass} disabled={!valid || isPending} onClick={onSubmit}>
          {isPending ? "Confirming" : "Repay / withdraw"}
        </Button>
      ) : (
        <ConnectWallet className={submitClass} label="Connect a wallet to repay" showAccount={false} />
      )}
    </div>
  );
}

export function BorrowCard({
  market,
  vault,
  position,
}: {
  market: MarketState;
  vault: VaultState | undefined;
  position: Position | null;
}) {
  return (
    <Panel className="p-6 lg:p-8">
      <Tabs defaultValue="borrow">
        <TabsList className="grid w-full grid-cols-2 bg-foreground/[0.04]">
          <TabsTrigger value="borrow">Borrow</TabsTrigger>
          <TabsTrigger value="repay">Repay</TabsTrigger>
        </TabsList>
        <TabsContent value="borrow">
          <BorrowTab market={market} vault={vault} position={position} />
        </TabsContent>
        <TabsContent value="repay">
          <RepayTab market={market} vault={vault} position={position} />
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
