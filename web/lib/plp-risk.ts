"use client";

import { useQuery } from "@tanstack/react-query";

export type PlpRisk = {
  vaultBalance: number;
  vaultValue: number;
  totalMtm: number;
  totalMaxPayout: number;
  availableLiquidity: number;
  availableWithdrawal: number;
  plpTotalSupply: number;
  plpSharePrice: number;
  utilization: number;
  maxPayoutUtilization: number;
  netDeposits: number;
  totalSupplied: number;
  totalWithdrawn: number;
  maxTotalExposurePct: number;
  quoteAsset: string | null;
  fetchedAt: number;
};

export function usePlpRisk() {
  const { data, isPending, isError, refetch } = useQuery<PlpRisk>({
    queryKey: ["plp-risk"],
    queryFn: async () => {
      const res = await fetch("/api/plp-risk");
      if (!res.ok) throw new Error(`plp-risk ${res.status}`);
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  return { risk: data, isPending, isError, refetch };
}

export type PlpNav = {
  series: { t: string; v: number }[];
  current: number | null;
  changePct: number;
  count: number;
  fetchedAt?: number;
};

export function usePlpNav() {
  const { data, isPending, isError } = useQuery<PlpNav>({
    queryKey: ["plp-nav"],
    queryFn: async () => {
      const res = await fetch("/api/plp-nav");
      if (!res.ok) throw new Error(`plp-nav ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  return { nav: data, isPending, isError };
}

export type BtcFeed = {
  series: { t: string; v: number }[];
  current: number | null;
  count: number;
  fetchedAt?: number;
};

export function useBtcFeed() {
  const { data, isPending, isError } = useQuery<BtcFeed>({
    queryKey: ["btc-feed"],
    queryFn: async () => {
      const res = await fetch("/api/btc-feed");
      if (!res.ok) throw new Error(`btc-feed ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  return { btc: data, isPending, isError };
}
