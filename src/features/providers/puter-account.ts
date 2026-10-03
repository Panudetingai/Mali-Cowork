/**
 * The user's Puter account: signing in through the browser, or checking a
 * token they pasted. The backend does both (src-tauri/src/puter.rs), so the
 * token never passes through a web page of ours.
 */
import { invoke } from "@tauri-apps/api/core";

export type PuterAccount = {
  username: string;
  /** Puter turns AI down until the account's email is confirmed. */
  needsEmail: boolean;
  /** A guest account Puter made without a sign-up. */
  temporary: boolean;
};

/**
 * Sign in in the browser: Puter asks the user to allow Mali Cowork, then hands
 * back a restricted token (it can use AI, not change the account).
 */
export function puterSignIn(baseUrl?: string | null) {
  return invoke<{ token: string; account: PuterAccount }>("puter_sign_in", { baseUrl: baseUrl ?? null });
}

export function puterSignInCancel() {
  return invoke("puter_sign_in_cancel").catch(() => undefined);
}

/** Whose account a token is, or why Puter refused it. */
export function puterAccount(token: string, baseUrl?: string | null) {
  return invoke<PuterAccount>("puter_account", { token: token.trim(), baseUrl: baseUrl ?? null });
}

/** Where a pasted token comes from. */
export const PUTER_DASHBOARD = "https://puter.com/dashboard";

/** A sign-in the user stopped isn't something to show as an error. */
export function isCancelled(message: string) {
  return /cancel/i.test(message);
}
