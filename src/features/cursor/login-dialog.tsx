import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderLogo } from "@/features/providers";
import { createStore } from "@/lib/local-store";
import { CheckIcon, LoaderIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { cursorLogin } from "./api";
import { refreshCursor, useCursor } from "./use-cursor";

type Prompt = {
  /** Runs once the user is signed in, e.g. to send the pending prompt. */
  onSignedIn?: () => void;
};

const promptStore = createStore<Prompt | null>(null);

/** Ask the user to sign in to Cursor. */
export function requestCursorLogin(prompt: Prompt = {}) {
  promptStore.set(prompt);
}

/** Mounted once; opens whenever `requestCursorLogin` is called. */
export function CursorLoginDialog() {
  const prompt = promptStore.use();
  const { check, loading } = useCursor();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    promptStore.set(null);
    setError(null);
  };

  const missing = check?.available === false;

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const status = await cursorLogin();
      if (!status.loggedIn) {
        setError(status.error ?? "Sign-in did not complete.");
        return;
      }
      close();
      prompt?.onSignedIn?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSigningIn(false);
      void refreshCursor();
    }
  };

  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 flex size-9 items-center justify-center rounded-xl bg-muted">
            <ProviderLogo logo="cursor" name="Cursor" className="size-5" />
          </span>
          <DialogTitle>{missing ? "Install the Cursor CLI" : "Sign in to Cursor"}</DialogTitle>
          <DialogDescription>
            {missing
              ? "Mali Cowork runs your local cursor-agent, which isn’t installed yet."
              : "Cursor models run through the cursor-agent CLI on this machine, using your own Cursor subscription."}
          </DialogDescription>
        </DialogHeader>

        {missing ? (
          <CommandHint command="curl https://cursor.com/install -fsS | bash" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Signing in opens your browser. Come back here once Cursor confirms it.
            </p>
            <CommandHint command="cursor-agent login" note="Or run it yourself in a terminal:" />
          </>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Close
          </Button>
          {missing ? (
            <Button type="button" disabled={loading} onClick={() => void refreshCursor()} className="gap-1.5">
              {loading && <LoaderIcon className="size-4 animate-spin" />}
              Check again
            </Button>
          ) : (
            <Button type="button" disabled={signingIn} onClick={signIn} className="gap-1.5">
              {signingIn ? <LoaderIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
              {signingIn ? "Waiting for the browser…" : "Sign in"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommandHint({ command, note }: { command: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        title="Copy"
        className="flex items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-2 text-left font-mono text-xs hover:bg-muted"
      >
        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{command}</span>
        <span className="shrink-0 font-sans text-[10px] text-muted-foreground">
          {copied ? "copied" : "copy"}
        </span>
      </button>
    </div>
  );
}
