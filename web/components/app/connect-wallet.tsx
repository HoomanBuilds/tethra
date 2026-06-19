"use client";

import { useState } from "react";
import {
  useWallets,
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/format";
import { FAUCET_URL } from "@/lib/config";

export function ConnectWallet({
  className,
  label = "Connect wallet",
  showAccount = true,
}: {
  className?: string;
  label?: string;
  showAccount?: boolean;
} = {}) {
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [open, setOpen] = useState(false);

  if (account && showAccount) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">
          {truncateAddress(account.address)}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full h-8 text-xs border-foreground/15"
          onClick={() => disconnect()}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className={
            className ??
            "rounded-full bg-foreground text-background hover:bg-foreground/90 h-8 px-4 text-xs"
          }
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-background border-foreground/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-tight">
            Connect a Sui wallet
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          {wallets.length === 0 && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              No Sui wallet detected. Install a Sui wallet extension, then reload
              this page to connect on testnet.
            </p>
          )}
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              onClick={() =>
                connect({ wallet }, { onSuccess: () => setOpen(false) })
              }
              className="flex items-center gap-3 p-3 border border-foreground/10 rounded-lg hover:bg-foreground/[0.04] transition-colors text-left"
            >
              {wallet.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.icon} alt="" className="w-6 h-6 rounded" />
              ) : (
                <span className="w-6 h-6 rounded bg-foreground/10" />
              )}
              <span className="text-sm">{wallet.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Testnet only. Need DUSDC test tokens?{" "}
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
      </DialogContent>
    </Dialog>
  );
}
