import { createStore } from "@/lib/local-store";
import { startOfWeek } from "./recap";
import { useEffect } from "react";

type RecapStore = {
  open: boolean;
  /** The Monday 00:00 of the last week the recap was shown. */
  lastWeek: number | null;
};

const store = createStore<RecapStore>(
  { open: false, lastWeek: null },
  {
    key: "mali_weekly_recap",
    revive: (value) => ({
      open: false,
      lastWeek: typeof value?.lastWeek === "number" ? value.lastWeek : null,
    }),
  },
);

export const useWeeklyRecapOpen = () => store.use().open;
export const useWeeklyRecapLastWeek = () => store.use().lastWeek;

export function requestWeeklyRecapOpen() {
  store.set((s) => ({ ...s, open: true }));
}

export function closeWeeklyRecap(weekStart?: number) {
  store.set((s) => ({
    ...s,
    open: false,
    lastWeek: weekStart ?? s.lastWeek,
  }));
}

export function markWeeklyRecapSeen(weekStart: number) {
  store.set((s) => ({ ...s, lastWeek: weekStart }));
}

/** Open automatically on the first Monday of each week. Safe to call on every mount. */
export function useWeeklyRecapAutoOpen() {
  const open = useWeeklyRecapOpen();
  const lastWeek = useWeeklyRecapLastWeek();

  useEffect(() => {
    const today = new Date();
    if (today.getDay() !== 1) return; // Monday only
    const current = startOfWeek(today.getTime());
    if (lastWeek === current || open) return;
    markWeeklyRecapSeen(current);
    requestWeeklyRecapOpen();
  }, [open, lastWeek]);
}
