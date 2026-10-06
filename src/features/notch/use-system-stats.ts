import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

export type SystemStats = {
  cpuPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskUsedPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  gpuPercent: number | null;
  gpuLabel: string | null;
};

/** Cached on the backend; the notch only reads — no heavy work per invoke. */
const POLL_MS = 4_000;

export function useSystemStats(enabled = true) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let alive = true;

    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const next = await invoke<SystemStats>("system_stats_snapshot");
        if (alive) setStats(next);
      } catch (error) {
        console.warn("[notch] system stats", error);
      } finally {
        busy.current = false;
      }
    };

    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled]);

  return stats;
}
