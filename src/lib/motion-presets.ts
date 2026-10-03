/** Shared motion curve (onboarding + app page transitions). */
export const MALI_EASE = [0.22, 1, 0.36, 1] as const;

export const maliPageEnter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, ease: MALI_EASE },
} as const;
