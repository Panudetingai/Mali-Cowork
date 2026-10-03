import { forgetImage, loadImage, needsProxy } from "@/features/chat-blocks/load-image";
import { useCallback, useEffect, useState } from "react";

type State = { src?: string; failed?: boolean; error?: string };

/**
 * `src` ready to draw: web pictures through the backend (see `loadImage`),
 * anything else (data:, blob:, local) as is. Waits for `enabled`, so a
 * picture far down a long chat isn't fetched until it's near the screen.
 */
export function useProxiedImage(src: string, enabled = true) {
  const [state, setState] = useState<State>(() => (needsProxy(src) ? {} : { src }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsProxy(src)) {
      setState({ src });
      return;
    }
    setState({});
    if (!enabled) return;
    let cancelled = false;
    loadImage(src).then(
      (data) => !cancelled && setState({ src: data }),
      (error) => !cancelled && setState({ failed: true, error: String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [src, enabled, attempt]);

  const retry = useCallback(() => {
    forgetImage(src);
    setAttempt((n) => n + 1);
  }, [src]);

  return { ...state, retry };
}
