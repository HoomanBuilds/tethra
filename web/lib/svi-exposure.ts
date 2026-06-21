"use client";

import { useQuery } from "@tanstack/react-query";
import type { SviParams } from "@/lib/svi";

export type ExposureMarket = {
  oracleId: string;
  expiryMs: number;
  live: boolean;
  forward: number;
  svi: SviParams | null;
  maxPayout: number;
  nPos: number;
  nUp: number;
  expLiability: number;
};

export type ExposurePosition = { o: string; k: number; up: boolean; q: number };

export type SviExposure = {
  markets: ExposureMarket[];
  positions: ExposurePosition[];
  baseline: {
    vaultValue: number;
    totalMaxPayout: number;
    totalMtm: number;
    reconstructedMaxPayout: number;
    liveMaxPayout: number;
    spot: number | null;
    openCount: number;
    marketCount: number;
  };
  fetchedAt: number;
};

export function useSviExposure() {
  const { data, isPending, isError } = useQuery<SviExposure>({
    queryKey: ["svi-exposure"],
    queryFn: async () => {
      const res = await fetch("/api/svi-exposure");
      if (!res.ok) throw new Error(`svi-exposure ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  return { exposure: data, isPending, isError };
}
