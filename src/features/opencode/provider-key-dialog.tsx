import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkProviderKey,
  cleanApiKey,
  configOrDefaults,
  getProvider,
  getProviderConfig,
  looksLikeUrl,
  ProviderLogo,
  saveProviderConfig,
  syncCliProviders,
} from "@/features/providers";
import { clearAgentSessions } from "@/features/chat-history";
import { createStore } from "@/lib/local-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EyeIcon, EyeOffIcon, ExternalLinkIcon, KeyRoundIcon, LoaderIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { opencodeSetAuth } from "./api";
import { getOpencodeModels, refreshOpencode } from "./use-opencode";

type KeyPrompt = {
  providerId: string;
  /**
   * Where the key belongs: `opencode` stores it in OpenCode's auth file,
   * `api` in Settings → Models (the keychain) for direct API calls.
   */
  target?: "opencode" | "api";
  /** Model the user tried to use, for the description. */
  modelName?: string;
  /** The saved key was rejected rather than missing. */
  invalid?: boolean;
  /** Runs after the key is saved, e.g. to send the pending prompt. */
  onSaved?: () => void;
};

const promptStore = createStore<KeyPrompt | null>(null);

/** Ask the user for a provider's API key. */
export function requestProviderKey(prompt: KeyPrompt) {
  promptStore.set(prompt);
}

/** Where each provider hands out API keys. */
const KEY_PAGES: Record<string, string> = {
  opencode: "https://opencode.ai/auth",
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/app/apikey",
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/settings/keys",
  "ollama-cloud": "https://ollama.com/settings/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  xai: "https://console.x.ai",
  mistral: "https://console.mistral.ai/api-keys",
  moonshotai: "https://platform.moonshot.ai/console/api-keys",
  zai: "https://z.ai/manage-apikey/apikey-list",
};

/** Mounted once; opens whenever `requestProviderKey` is called. */
export function ProviderKeyDialog() {
  const prompt = promptStore.use();
  const close = () => promptStore.set(null);

  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        {prompt && <KeyForm key={prompt.providerId} prompt={prompt} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}

function KeyForm({ prompt, onClose }: { prompt: KeyPrompt; onClose: () => void }) {
  const toApi = prompt.target === "api";
  const appProvider = getProvider(prompt.providerId);
  const provider = getOpencodeModels()?.providers.find((p) => p.id === prompt.providerId);
  const name = appProvider?.name ?? provider?.name ?? prompt.providerId;
  const keyPage = appProvider?.keyUrl ?? KEY_PAGES[prompt.providerId];
  const envVar = appProvider?.envVar ?? provider?.env[0];
  const inputId = useId();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  /** `checking` while the provider verifies the key, `saving` while it is stored. */
  const [step, setStep] = useState<"idle" | "checking" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = step !== "idle";
  const value = cleanApiKey(key);

  useEffect(() => setError(null), [key]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value || busy) return;
    if (looksLikeUrl(value)) {
      setError(`That looks like a link. Open it, copy the ${name} key itself, and paste it here.`);
      return;
    }

    // Catch a wrong key here, where it can still be corrected, instead of in
    // the middle of the next reply.
    setStep("checking");
    const check = await checkProviderKey(
      prompt.providerId,
      value,
      toApi ? getProviderConfig(prompt.providerId)?.baseUrl : undefined,
    );
    if (check.status === "rejected") {
      setStep("idle");
      setError(
        check.message
          ? `${name} rejected this key: ${check.message}`
          : `${name} rejected this key. Check that it was copied in full, and that it is still active.`,
      );
      return;
    }

    setStep("saving");
    try {
      if (toApi && appProvider) {
        const saved = getProviderConfig(prompt.providerId);
        saveProviderConfig(prompt.providerId, {
          ...configOrDefaults(appProvider, saved),
          apiKey: value,
        });
        // Keep OpenCode on the same key, so both paths stay in sync.
        await syncCliProviders().catch(() => undefined);
      } else {
        await opencodeSetAuth(prompt.providerId, value);
      }
      await refreshOpencode();
      // Sessions opened with the old key keep failing on it.
      clearAgentSessions();
      onClose();
      prompt.onSaved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setStep("idle");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <DialogHeader>
        <div className="mb-1 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <KeyRoundIcon className="size-4" />
          </span>
          <ProviderLogo logo={prompt.providerId} name={name} className="size-5" />
        </div>
        <DialogTitle>
          {prompt.invalid ? `${name} didn't accept its saved key` : `Set up ${name}`}
        </DialogTitle>
        <DialogDescription>
          {prompt.invalid
            ? `${name} turned down the key saved on this Mac${
                prompt.modelName ? `, so ${prompt.modelName} couldn't answer` : ""
              }. Paste a new one to pick up where you left off.`
            : prompt.modelName
              ? `${prompt.modelName} runs on ${name}, which needs an API key.`
              : `Add your ${name} API key to use its models.`}{" "}
          {toApi
            ? "The key is kept in this Mac's keychain."
            : "The key is stored by OpenCode on this device only."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>API key</Label>
        <div className="relative">
          <Input
            id={inputId}
            type={show ? "text" : "password"}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={envVar ? `e.g. the value of ${envVar}` : "Paste your API key"}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide API key" : "Show API key"}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
          </button>
        </div>
        {keyPage && (
          <button
            type="button"
            onClick={() => void openUrl(keyPage)}
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Get a {name} API key
            <ExternalLinkIcon className="size-3" />
          </button>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!value || busy} className="gap-1.5">
          {busy && <LoaderIcon className="size-4 animate-spin" />}
          {step === "checking" ? "Checking…" : "Save key"}
        </Button>
      </DialogFooter>
    </form>
  );
}
