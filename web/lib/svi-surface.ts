"use client";

import { useQuery } from "@tanstack/react-query";
import type { OracleSmile } from "@/lib/svi";

export type SurfaceOracle = OracleSmile & { calendarOk: boolean };

export type SviSurface = {
  oracles: SurfaceOracle[];
  spot: number | null;
  underlying: string;
  liveCount: number;
  fetchedAt: number;
};

export function useSviSurface() {
  const { data, isPending, isError } = useQuery<SviSurface>({
    queryKey: ["svi-surface"],
    queryFn: async () => {
      const res = await fetch("/api/svi-surface");
      if (!res.ok) throw new Error(`svi-surface ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  return { surface: data, isPending, isError };
}
