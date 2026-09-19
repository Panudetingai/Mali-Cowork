import { createStore } from "@/lib/local-store";

type OnboardingState = {
  /** Finished or skipped once; not shown again unless asked. */
  done: boolean;
  /** Open right now (also when replayed from Settings). */
  open: boolean;
};

const store = createStore<OnboardingState>(
  { done: false, open: false },
  {
    key: "mali_onboarding",
    // Only `done` survives a restart.
    revive: (saved) => ({ done: !!(saved as OnboardingState | undefined)?.done, open: false }),
  },
);

export const useOnboarding = store.use;

/**
 * `VITE_ONBOARDING=always` in `.env` opens onboarding on every start, for
 * trying it as a new user (with `MALI_SIMULATE_NEW_USER=1` nothing is installed).
 */
export const FORCE_ONBOARDING = import.meta.env.VITE_ONBOARDING === "always";

export function openOnboarding() {
  store.set((s) => ({ ...s, open: true }));
}

export function finishOnboarding() {
  store.set({ done: true, open: false });
}

export function isOnboardingDone() {
  return store.get().done;
}
