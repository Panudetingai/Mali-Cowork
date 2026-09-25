import { createStore } from "@/lib/local-store";
import { startOfWeek } from "./recap";
import { useEffect } from "react";

type RecapStore = {
  open: boolean;
  /** Weeks back the dialog opens on: 0 = this week, 1 = the week that just ended. */
  startOffset: number;
  /** The Monday 00:00 of the last week the recap was shown. */
  lastWeek: number | null;
};

const store = createStore<RecapStore>(
  { open: false, startOffset: 0, lastWeek: null },
  {
    key: "mali_weekly_recap",
    revive: (value) => ({
      open: false,
      startOffset: 0,
      lastWeek: typeof value?.lastWeek === "number" ? value.lastWeek : null,
    }),
  },
);

export const useWeeklyRecapOpen = () => store.use().open;
export const useWeeklyRecapStartOffset = () => store.use().startOffset;
export const useWeeklyRecapLastWeek = () => store.use().lastWeek;

/** Open on this week (the menu), or `weeksBack` (the Monday recap of last week). */
export function requestWeeklyRecapOpen(weeksBack = 0) {
  store.set((s) => ({ ...s, open: true, startOffset: weeksBack }));
}

/**
 * Close. Which week was being viewed doesn't matter: the automatic recap is
 * marked as seen for the current week when it opens, so browsing back to an
 * older week and closing never makes it open again.
 */
export function closeWeeklyRecap() {
  store.set((s) => ({ ...s, open: false }));
}

export function markWeeklyRecapSeen(weekStart: number) {
  store.set((s) => ({ ...s, lastWeek: weekStart }));
}

/**
 * On the first visit each Monday, open on the week that just ended — the new
 * one has barely started. Safe to call on every mount.
 */
export function useWeeklyRecapAutoOpen() {
  const open = useWeeklyRecapOpen();
  const lastWeek = useWeeklyRecapLastWeek();

  useEffect(() => {
    const today = new Date();
    if (today.getDay() !== 1) return; // Monday only
    const current = startOfWeek(today.getTime());
    if (lastWeek === current || open) return;
    markWeeklyRecapSeen(current);
    requestWeeklyRecapOpen(1);
  }, [open, lastWeek]);
}
