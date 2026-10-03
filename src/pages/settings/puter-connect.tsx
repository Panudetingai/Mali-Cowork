"use client";

import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/features/providers";
import {
  isCancelled,
  PUTER_DASHBOARD,
  puterAccount,
  puterSignIn,
  puterSignInCancel,
  type PuterAccount,
} from "@/features/providers/puter-account";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangleIcon, ArrowUpRightIcon, KeyRoundIcon, LoaderIcon, LogOutIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SecretInput } from "./ui";

/** A pasted token is checked once typing stops for this long. */
const CHECK_AFTER_MS = 600;

const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.24, ease: MALI_EASE },
} as const;

type Phase =
  | { kind: "checking" }
  | { kind: "signedOut" }
  | { kind: "waiting" }
  | { kind: "signedIn"; account: PuterAccount }
  | { kind: "rejected"; message: string };

/**
 * Connecting Puter, two ways: sign in through the browser (Puter asks the
 * user to allow Mali, no copying), or paste a token from puter.com/dashboard.
 * Either way the token is checked with Puter, and the card says whose
 * account it is — and what would stop AI from working, before the user finds
 * out mid-chat.
 */
export function PuterConnect({
  apiKey,
  baseUrl,
  onToken,
}: {
  apiKey: string;
  baseUrl: string;
  /** A checked token, from either way in; empty to sign out. */
  onToken: (token: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(() => (apiKey.trim() ? { kind: "checking" } : { kind: "signedOut" }));
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const [signInError, setSignInError] = useState<string>();
  const checked = useRef<string>(undefined);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  /** Ask Puter whose `token` is; the newest check wins. */
  const latest = useRef(0);
  const check = (token: string) => {
    const run = ++latest.current;
    checked.current = token;
    setPhase({ kind: "checking" });
    puterAccount(token, baseUrl).then(
      (account) => run === latest.current && setPhase({ kind: "signedIn", account }),
      (e) => run === latest.current && setPhase({ kind: "rejected", message: String(e) }),
    );
  };

  // The saved token, checked when the dialog opens: it may have been revoked.
  useEffect(() => {
    const token = apiKey.trim();
    if (token && checked.current !== token) check(token);
  }, [apiKey, baseUrl]);

  // A pasted token: checked once typing stops, kept only if Puter takes it.
  useEffect(() => {
    const token = draft.trim();
    if (!pasting || !token) return;
    const timer = setTimeout(() => {
      const run = ++latest.current;
      setPhase({ kind: "checking" });
      puterAccount(token, baseUrl).then(
        (account) => {
          if (run !== latest.current) return;
          checked.current = token;
          onTokenRef.current(token);
          setPasting(false);
          setDraft("");
          setPhase({ kind: "signedIn", account });
        },
        (e) => run === latest.current && setPhase({ kind: "rejected", message: String(e) }),
      );
    }, CHECK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [draft, pasting, baseUrl]);

  const signIn = async () => {
    setSignInError(undefined);
    setPasting(false);
    setPhase({ kind: "waiting" });
    try {
      const { token, account } = await puterSignIn(baseUrl);
      checked.current = token;
      onToken(token);
      setPhase({ kind: "signedIn", account });
    } catch (e) {
      const message = String(e);
      // Back to whatever was there before.
      if (apiKey.trim()) check(apiKey.trim());
      else setPhase({ kind: "signedOut" });
      if (!isCancelled(message)) setSignInError(message);
    }
  };

  const signOut = () => {
    checked.current = undefined;
    onToken("");
    setPhase({ kind: "signedOut" });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Puter account</span>
      <div className="overflow-hidden rounded-2xl bg-muted/25 ring-1 ring-border/70">
        <AnimatePresence mode="wait" initial={false}>
          {phase.kind === "signedIn" ? (
            <motion.div key="in" {...fade} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white uppercase dark:bg-white dark:text-neutral-900">
                  {phase.account.username.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">@{phase.account.username}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    Connected · AI only, can't change your account
                  </p>
                </div>
              </div>
              {signInError && <Hint tone="danger" text={signInError} />}
              {phase.account.needsEmail && (
                <Hint
                  text="Confirm your email at puter.com first — Puter turns AI down until you do."
                  action="Open Puter"
                  onAction={() => void openUrl("https://puter.com")}
                />
              )}
              {phase.account.temporary && (
                <Hint
                  text="This is a guest account. Sign up at puter.com to keep its credits."
                  action="Sign up"
                  onAction={() => void openUrl("https://puter.com")}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl text-xs" onClick={() => void signIn()}>
                  <RefreshCwIcon className="size-3.5" />
                  Switch account
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 rounded-xl text-xs text-muted-foreground" onClick={signOut}>
                  <LogOutIcon className="size-3.5" />
                  Sign out
                </Button>
              </div>
            </motion.div>
          ) : phase.kind === "waiting" ? (
            <motion.div key="wait" {...fade} className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              <span className="relative flex size-11 items-center justify-center rounded-2xl bg-background ring-1 ring-border/70">
                <ProviderLogo logo="puter" name="Puter" className="size-6" />
                <LoaderIcon className="absolute -right-1.5 -bottom-1.5 size-4 animate-spin rounded-full bg-background text-muted-foreground" />
              </span>
              <div>
                <p className="text-sm font-semibold">Finish in your browser</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Sign in to Puter, then allow Mali Cowork. This page updates by itself.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl text-xs" onClick={() => void puterSignInCancel()}>
                  Cancel
                </Button>
              </div>
            </motion.div>
          ) : phase.kind === "checking" ? (
            <motion.div key="check" {...fade} className="flex items-center gap-2.5 px-4 py-5 text-sm text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
              Checking with Puter…
            </motion.div>
          ) : (
            <motion.div key="out" {...fade} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-background ring-1 ring-border/70">
                  <ProviderLogo logo="puter" name="Puter" className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Connect your Puter account</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    The free plan works. AI uses your Puter credits, and Mali never sees your password.
                  </p>
                </div>
              </div>
              {phase.kind === "rejected" && (
                <Hint tone="danger" text={phase.message} />
              )}
              {signInError && <Hint tone="danger" text={signInError} />}
              <Button
                type="button"
                className="h-10 w-full gap-2 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                onClick={() => void signIn()}
              >
                Sign in with Puter
                <ArrowUpRightIcon className="size-4 opacity-70" />
              </Button>

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="h-px flex-1 bg-border/70" />
                or
                <span className="h-px flex-1 bg-border/70" />
              </div>

              {pasting ? (
                <div className="flex flex-col gap-1.5">
                  <SecretInput
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Paste your Puter auth token"
                    aria-label="Puter auth token"
                    className="rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => void openUrl(PUTER_DASHBOARD)}
                    className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    puter.com/dashboard → Create token
                    <ArrowUpRightIcon className="size-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPasting(true);
                    setSignInError(undefined);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <KeyRoundIcon className="size-3.5" />
                  Paste a token instead
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Hint({
  text,
  tone = "warning",
  action,
  onAction,
}: {
  text: string;
  tone?: "warning" | "danger";
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed",
        tone === "danger"
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 wrap-anywhere">{text}</span>
      {action && onAction && (
        <button type="button" onClick={onAction} className="shrink-0 font-medium underline-offset-2 hover:underline">
          {action}
        </button>
      )}
    </div>
  );
}
