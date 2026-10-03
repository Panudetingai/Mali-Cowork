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

/** First-time finish or skip — won't auto-open on next launch. */
export function finishOnboarding() {
  store.set({ done: true, open: false });
}

/** Close the setup page when replaying from Settings (keeps `done`). */
export function dismissOnboarding() {
  store.set((s) => ({ ...s, open: false }));
}

export function isOnboardingDone() {
  return store.get().done;
}

/** Must see the full setup page before the rest of the app. */
export function mustShowOnboarding() {
  const { done, open } = store.get();
  return open || !done;
}
