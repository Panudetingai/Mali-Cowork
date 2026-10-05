/**
 * Putting something into the chat box from elsewhere (the ⌘K palette, the
 * empty-state cards): the text to type, or a skill to add as a badge. Nothing
 * is sent — the user reads it and presses Enter.
 */
export type ComposeRequest = {
  text?: string;
  skill?: string;
  /** Highlighted text — shown in the reply bar, merged when the user sends. */
  replyExcerpt?: string;
};

const EVENT = "mali:compose";

export function requestCompose(request: ComposeRequest) {
  window.dispatchEvent(new CustomEvent<ComposeRequest>(EVENT, { detail: request }));
}

/** The chat box listens; returns the unsubscribe. */
export function onCompose(handler: (request: ComposeRequest) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<ComposeRequest>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
