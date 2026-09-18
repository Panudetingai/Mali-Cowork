import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { attachFolder, detachFolder, type ChatSession } from "@/features/chat-history";
import { requestCursorLogin, useCursor } from "@/features/cursor";
import {
  opencodeWarm,
  requestProviderKey,
  useOpencode,
  type OpencodeState,
  type WorkMode,
} from "@/features/opencode";
import {
  listConfiguredProviders,
  useEnvKeys,
  useProviderConfigs,
} from "@/features/providers";
import {
  findGrant,
  folderName,
  normalizeFolder,
  requestFolderAccess,
  useFolderGrants,
} from "@/features/workspace";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUpIcon, EyeIcon, FolderIcon, LoaderIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type RefObject } from "react";
import { contextUsage } from "../context-usage";
import type { SendMessage } from "../hooks/use-chat";
import {
  buildModelCatalog,
  contextBudgetFor,
  findModel,
  isOpencodeModel,
  loadSelectedModelId,
  opencodeProviderOf,
  saveSelectedModelId,
  type AiModel,
} from "../models";
import type { ChatMessage } from "../types";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { ContextMeter } from "./context-meter";
import { ModelPicker } from "./model-picker";
import { PromptOptionsMenu } from "./prompt-options-menu";
import { WorkModeToggle } from "./work-mode-toggle";

type Props = {
  ref: RefObject<HTMLTextAreaElement | null>;
  mode: WorkMode;
  session?: ChatSession;
  messages: ChatMessage[];
  isLoading?: boolean;
  canStop?: boolean;
  placeholder?: string;
  onStop?: () => void;
  onNewChat: (options?: { cwd?: string }) => void;
  onModeChange: (mode: WorkMode) => void;
  onSubmit: (payload: SendMessage) => Promise<boolean>;
};

const NO_FOLDERS: string[] = [];

export default function PromptInput({
  ref,
  mode,
  session,
  messages,
  isLoading,
  canStop,
  placeholder,
  onStop,
  onNewChat,
  onModeChange,
  onSubmit,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(() => loadSelectedModelId(mode));
  const opencode = useOpencode();
  const cursor = useCursor();
  useFolderGrants(); // re-render when access changes

  const providerConfigs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const cursorStatus = useMemo(
    () => ({ models: cursor.models, loggedIn: !!cursor.check?.loggedIn }),
    [cursor.models, cursor.check?.loggedIn],
  );
  const catalog = useMemo(
    () =>
      buildModelCatalog(
        opencode.models,
        listConfiguredProviders(providerConfigs, envKeys),
        mode,
        cursorStatus,
      ),
    [opencode.models, providerConfigs, envKeys, mode, cursorStatus],
  );
  const selected = findModel(catalog, modelId);
  const usesOpencode = isOpencodeModel(selected.id);
  const opencodeMissing = usesOpencode && opencode.check?.available === false;
  const budget = contextBudgetFor(selected);
  const usageLive = useMemo(() => contextUsage(messages), [messages]);
  const usage = useDebouncedValue(usageLive, 400, !!isLoading);

  const isCowork = mode === "cowork";
  // A chat keeps the folder its agent session started in; new chats use the default.
  const cwd = session?.cwd || opencode.cwd;
  const extraFolders = session?.folders ?? NO_FOLDERS;
  const folders = isCowork ? [cwd, ...extraFolders].filter(Boolean) : NO_FOLDERS;

  const opencodeReady = !!opencode.check?.available;
  useEffect(() => {
    if (isCowork && cwd && opencodeReady) opencodeWarm(cwd, "cowork");
  }, [isCowork, cwd, opencodeReady]);

  const defaultPlaceholder = isCowork
    ? "Describe what you want to build or change in your project…"
    : "How can I help you today?";

  /** Ask for whatever the model still needs; true when something was asked. */
  const askForAccess = (model: AiModel, onReady?: () => void) => {
    if (model.needsLogin) {
      requestCursorLogin({ onSignedIn: onReady });
      return true;
    }
    const providerId = model.needsKey ? opencodeProviderOf(model.id) : undefined;
    if (providerId) {
      requestProviderKey({
        providerId,
        modelName: model.free ? undefined : model.name,
        onSaved: onReady,
      });
      return true;
    }
    return false;
  };

  /** Primary Cowork folder. Changing it after a chat started opens a new chat. */
  const pickWorkingFolder = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      defaultPath: cwd || undefined,
      title: session?.cwd
        ? "Change working folder (starts a new chat)"
        : "Choose the folder Cowork works in",
    });
    if (typeof folder !== "string" || !folder) return;
    const grant = await requestFolderAccess(folder);
    if (!grant) return;
    const path = normalizeFolder(folder);
    opencode.update({ cwd: path });
    if (session?.cwd) {
      if (path === normalizeFolder(session.cwd)) return;
      onNewChat({ cwd: path });
      return;
    }
  };

  const addAttachedFolder = async () => {
    if (!session?.cwd) {
      await pickWorkingFolder();
      return;
    }
    const folder = await open({
      directory: true,
      multiple: false,
      defaultPath: cwd || undefined,
      title: "Add a folder to this chat",
    });
    if (typeof folder !== "string" || !folder) return;
    const grant = await requestFolderAccess(folder);
    if (!grant) return;
    const path = normalizeFolder(folder);
    if (path === normalizeFolder(session.cwd)) return;
    attachFolder(session.id, path);
  };

  async function send(text: string, model: AiModel) {
    setPrompt("");
    const sent = await onSubmit({ prompt: text, model, budget: contextBudgetFor(model) });
    if (!sent) setPrompt((current) => current || text);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isLoading || opencodeMissing) return;
    if (askForAccess(selected, () => void send(trimmed, selected))) return;
    await send(trimmed, selected);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto w-full max-w-3xl rounded-2xl border bg-card p-3 shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-amber-300"
    >
      {isCowork && extraFolders.length > 0 && session && (
        <div className="mb-1.5 flex flex-wrap gap-1 px-1">
          {extraFolders.map((folder) => (
            <span
              key={folder}
              title={folder}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2 text-xs text-muted-foreground"
            >
              <FolderIcon className="size-3" />
              <span className="max-w-32 truncate">{folderName(folder)}</span>
              <button
                type="button"
                aria-label={`Remove ${folderName(folder)}`}
                onClick={() => detachFolder(session.id, folder)}
                className="rounded-full p-0.5 hover:bg-background hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Textarea
        ref={ref}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={placeholder ?? defaultPlaceholder}
        rows={2}
        disabled={isLoading}
        className="max-h-40 min-h-12 resize-none border-0 bg-transparent p-1 text-[15px] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 dark:bg-transparent"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      {opencodeMissing && (
        <p className="mt-1 px-1 text-xs text-red-600 dark:text-red-400">
          {opencode.check?.error ?? "OpenCode CLI is not available."}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PromptOptionsMenu
            opencode={usesOpencode ? opencode : undefined}
            mode={mode}
            canAddFolder={!!session?.cwd}
            onPickWorkingFolder={pickWorkingFolder}
            onAddFolder={addAttachedFolder}
          />
          <WorkModeToggle mode={mode} onModeChange={onModeChange} />
          {isCowork && (
            <FolderChip
              opencode={opencode}
              cwd={cwd}
              boundToChat={!!session?.cwd}
              onClick={pickWorkingFolder}
            />
          )}
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1">
          {(messages.length > 0 || isLoading) && (
            <ContextMeter usage={usage} budget={budget} folders={folders} onNewChat={onNewChat} />
          )}
          <ModelPicker
            models={catalog}
            selected={selected}
            loading={opencode.loading}
            onSelect={(model) => {
              setModelId(model.id);
              saveSelectedModelId(mode, model.id);
              askForAccess(model);
            }}
          />
          {canStop ? (
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              className="rounded-full"
              onClick={onStop}
              aria-label="Stop"
            >
              <SquareIcon className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              className="rounded-full"
              disabled={!prompt.trim() || isLoading || opencodeMissing}
              aria-label="Send"
            >
              {isLoading ? <LoaderIcon className="animate-spin" /> : <ArrowUpIcon />}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function FolderChip({
  opencode,
  cwd,
  boundToChat,
  onClick,
}: {
  opencode: OpencodeState;
  cwd: string;
  boundToChat: boolean;
  onClick: () => void;
}) {
  const grant = cwd ? findGrant(cwd) : undefined;
  const status = opencode.loading
    ? { dot: "bg-muted-foreground/50 animate-pulse", label: "Connecting to OpenCode…" }
    : !opencode.check?.available
      ? { dot: "bg-red-500", label: "OpenCode unavailable" }
      : !grant
        ? { dot: "bg-amber-500", label: "Not allowed yet — you’ll be asked before the agent starts" }
        : { dot: "bg-emerald-500", label: grant.access === "read" ? "Read-only access" : "Read & write access" };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="min-w-0 gap-1.5 rounded-full px-2 text-xs text-muted-foreground"
      title={
        boundToChat
          ? `${status.label}\n${cwd}\n\nClick to change folder — opens a new chat`
          : `${status.label}\n${cwd}`
      }
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
      <FolderIcon className="size-3.5" />
      <span className="max-w-32 truncate">{folderName(cwd)}</span>
      {grant?.access === "read" && <EyeIcon className="size-3" aria-label="Read only" />}
    </Button>
  );
}

