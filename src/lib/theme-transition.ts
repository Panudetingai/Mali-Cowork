import type { MouseEvent } from "react";

/** Circular reveal when toggling light/dark (View Transitions API). */
export async function themeTransition(
  event: MouseEvent<HTMLElement>,
  apply: () => void,
): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }

  const startViewTransition = (
    document as Document & {
      startViewTransition?: (updateCallback: () => void) => { ready: Promise<void> };
    }
  ).startViewTransition;

  if (!startViewTransition) {
    apply();
    return;
  }

  const x = event.clientX;
  const y = event.clientY;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = startViewTransition.call(document, apply);

  try {
    await transition.ready;
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 480,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  } catch {
    /* transition skipped or aborted */
  }
}
