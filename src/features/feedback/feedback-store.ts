import { createStore } from "@/lib/local-store";
import { useEffect } from "react";

/** Open the review card after this many app launches. */
export const FEEDBACK_PROMPT_AFTER_LAUNCHES = 5;
/** Ask again this many days after the user put it off. */
export const FEEDBACK_REPROMPT_DAYS = 30;
/** Put off this many times, it never asks again. */
export const FEEDBACK_MAX_DISMISSALS = 2;

type FeedbackStore = {
  open: boolean;
  launches: number;
  /** Stars given; once set, the card never opens by itself again. */
  rated: number | null;
  dismissedAt: number | null;
  /** How many times it was put off ("Not now", ×, Escape). */
  dismissals: number;
};

const store = createStore<FeedbackStore>(
  { open: false, launches: 0, rated: null, dismissedAt: null, dismissals: 0 },
  {
    key: "mali_feedback",
    revive: (value) => ({
      open: false,
      launches: typeof value?.launches === "number" ? value.launches : 0,
      rated: typeof value?.rated === "number" ? value.rated : null,
      dismissedAt: typeof value?.dismissedAt === "number" ? value.dismissedAt : null,
      // Older saves had no count: a put-off one counts once.
      dismissals: typeof value?.dismissals === "number" ? value.dismissals : value?.dismissedAt ? 1 : 0,
    }),
  },
);

export const getFeedback = store.get;
export const useFeedbackOpen = () => store.use().open;

/** Open by hand, e.g. from a menu. */
export function requestFeedbackOpen() {
  store.set((s) => ({ ...s, open: true }));
}

export function closeFeedback() {
  store.set((s) => ({ ...s, open: false }));
}

/** Put off: asked again after a while, at most `FEEDBACK_MAX_DISMISSALS` times in all. */
export function dismissFeedback() {
  store.set((s) => ({ ...s, open: false, dismissedAt: Date.now(), dismissals: s.dismissals + 1 }));
}

/** Keep the rating; the card stays open for its thank-you. It won't ask again. */
export function submitFeedbackRating(stars: number) {
  store.set((s) => ({ ...s, rated: stars }));
}

/** Whether a launch should bring the card up. */
export function shouldAskForFeedback(s: Pick<FeedbackStore, "launches" | "rated" | "dismissedAt" | "dismissals">, now = Date.now()) {
  if (s.rated != null || s.dismissals >= FEEDBACK_MAX_DISMISSALS) return false;
  if (s.launches < FEEDBACK_PROMPT_AFTER_LAUNCHES) return false;
  return s.dismissedAt == null || now - s.dismissedAt > FEEDBACK_REPROMPT_DAYS * 24 * 60 * 60 * 1000;
}

let countedThisSession = false;

/** Count this launch; open the card once it's time. Safe on every mount. */
export function useFeedbackAutoOpen() {
  useEffect(() => {
    if (countedThisSession) return;
    countedThisSession = true;
    // Read the store now, not a render's copy: the count must build on what's saved.
    store.set((s) => {
      const next = { ...s, launches: s.launches + 1 };
      return shouldAskForFeedback(next) && !s.open ? { ...next, open: true } : next;
    });
  }, []);
}
