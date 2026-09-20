import { Button } from "@/components/ui/button";
import {
  AttachmentChip,
  importAttachment,
  saveAttachment,
  type Attachment,
} from "@/features/attachments";
import { Textarea } from "@/components/ui/textarea";
import { attachFolder, detachFolder, type ChatSession } from "@/features/chat-history";
import { requestCursorLogin, useCursor } from "@/features/cursor";
import { useGemini } from "@/features/gemini";
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
import { filterSkills, skillSlug, useInstructions, type Skill } from "@/features/instructions";
import { useProjects } from "@/features/projects";
import { cn } from "@/lib/utils";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpIcon,
  EyeIcon,
  FolderIcon,
  LoaderIcon,
  SquareIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type RefObject } from "react";
import { contextUsage } from "../context-usage";
import type { SendMessage } from "../hooks/use-chat";
import {
  buildModelCatalog,
  contextBudgetFor,
  findModel,
  isCursorModel,
  isOpencodeModel,
  loadSelectedModelId,
  opencodeProviderOf,
  saveSelectedModelId,
  type AiModel,
  type ContextBudget,
} from "../models";
import type { ChatMessage } from "../types";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { ContextMeter } from "./context-meter";
import { buildMentionAppendix, parseMentions } from "./mention/mentions";
import { filterMentions, MentionPopup } from "./mention/mention-popup";
import { SkillPopup } from "./mention/skill-popup";
import { useWorkspaceFiles } from "./mention/use-workspace-files";
import { ModelPicker } from "./model-picker";
import { PromptOptionsMenu } from "./prompt-options-menu";
import { WorkModeToggle } from "./work-mode-toggle";

type Props = {
  ref: RefObject<HTMLTextAreaElement | null>;
  mode: WorkMode;
  /** The chat's project; its skills join the `/` picker. */
  projectId?: string;
  session?: ChatSession;
  messages: ChatMessage[];
  isLoading?: boolean;
  canStop?: boolean;
  placeholder?: string;
  onStop?: () => void;
  onNewChat: (options?: { cwd?: string }) => void;
  /** Start a new chat carrying a summary of this one. */
  onSummarize?: (model: AiModel, budget: ContextBudget) => void;
  onModeChange: (mode: WorkMode) => void;
  onSubmit: (payload: SendMessage) => Promise<boolean>;
};

const NO_FOLDERS: string[] = [];
const MAX_ATTACHMENTS = 10;
/** Sent when the user attaches files but types nothing. */
const ATTACHMENTS_ONLY_PROMPT = "Please take a look at the attached files.";

export default function PromptInput({
  ref,
  mode,
  projectId,
  session,
  messages,
  isLoading,
  canStop,
  placeholder,
  onStop,
  onNewChat,
  onSummarize,
  onModeChange,
  onSubmit,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [importing, setImporting] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [modelId, setModelId] = useState(() => loadSelectedModelId(mode));
  const opencode = useOpencode();
  const cursor = useCursor();
  const gemini = useGemini();
  useFolderGrants(); // re-render when access changes

  const providerConfigs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const cursorStatus = useMemo(
    () => ({ models: cursor.models, loggedIn: !!cursor.check?.loggedIn }),
    [cursor.models, cursor.check?.loggedIn],
  );
  const geminiStatus = useMemo(
    () => ({ models: gemini.models, loggedIn: !!gemini.check?.loggedIn }),
    [gemini.models, gemini.check?.loggedIn],
  );
  const catalog = useMemo(
    () =>
      buildModelCatalog(
        opencode.models,
        listConfiguredProviders(providerConfigs, envKeys),
        mode,
        cursorStatus,
        undefined,
        geminiStatus,
      ),
    [opencode.models, providerConfigs, envKeys, mode, cursorStatus, geminiStatus],
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
    ? "Describe what to build or change… (type @ to attach files)"
    : "How can I help you today?";

  /** Ask for whatever the model still needs; true when something was asked. */
  const askForAccess = (model: AiModel, onReady?: () => void) => {
    // Only Cursor has an in-app sign-in flow; other CLIs explain sign-in
    // through their own backend errors (e.g. run `gemini` once).
    if (model.needsLogin && isCursorModel(model.id)) {
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

  /** Copy files into the app and show them above the text box. */
  async function addAttachments(sources: (string | File)[]) {
    setAttachError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (sources.length > room) setAttachError(`Up to ${MAX_ATTACHMENTS} files per message.`);
    const accepted = sources.slice(0, Math.max(room, 0));
    setImporting((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (source) => {
        try {
          const attachment =
            typeof source === "string" ? await importAttachment(source) : await saveAttachment(source);
          setAttachments((prev) => [...prev, attachment]);
        } catch (error) {
          setAttachError(String(error));
        } finally {
          setImporting((n) => n - 1);
        }
      }),
    );
    ref.current?.focus();
  }

  const pickFiles = async () => {
    const picked = await open({ multiple: true, title: "Attach files or pictures" });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) await addAttachments(paths);
  };

  const pasteFiles = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addAttachments(files);
  };

  // Files dragged from Finder / Explorer onto the window.
  const addRef = useLatest(addAttachments);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else if (payload.type === "drop") {
          setDragging(false);
          if (payload.paths.length) void addRef.current(payload.paths);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addRef]);

  // `@` mentions: files and folders under the working folder.
  const mentionRoot = cwd || undefined;
  const { entries: workspaceEntries, loading: workspaceLoading } = useWorkspaceFiles(mentionRoot);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [attaching, setAttaching] = useState(false);
  const mentionMatches = useMemo(
    () => (mention ? filterMentions(workspaceEntries, mention.query) : []),
    [mention, workspaceEntries],
  );

  // `/` (or `\`) calls a skill from Settings → Instructions.
  const { skills: globalSkills } = useInstructions();
  const projects = useProjects();
  const skills = useMemo(() => {
    const project = projects.find((p) => p.id === projectId);
    return project?.skills.length ? [...project.skills, ...globalSkills] : globalSkills;
  }, [projects, projectId, globalSkills]);
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(null);
  const [slashActive, setSlashActive] = useState(0);
  const skillMatches = useMemo(() => (slash ? filterSkills(skills, slash.query) : []), [slash, skills]);

  /** Recompute an open `@` or `/` query from the caret position. */
  function updateMention(value: string, caret: number | undefined) {
    const skill = caret == null ? null : /(?:^|\s)[/\\]([^\s/\\]*)$/.exec(value.slice(0, caret));
    if (skill && caret != null) {
      setSlash({ query: skill[1], start: caret - skill[1].length - 1 });
      setSlashActive(0);
    } else {
      setSlash(null);
    }
    if (caret == null || !mentionRoot) {
      setMention(null);
      return;
    }
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (!m) {
      setMention(null);
      return;
    }
    setMention({ query: m[1], start: caret - m[1].length - 1 });
    setMentionActive(0);
  }

  function insertMention(rel: string) {
    if (!mention) return;
    const caret = ref.current?.selectionStart ?? prompt.length;
    const next = `${prompt.slice(0, mention.start)}@${rel} ${prompt.slice(caret)}`;
    const nextCaret = mention.start + rel.length + 2;
    setPrompt(next);
    setMention(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function insertSkill(skill: Skill) {
    if (!slash) return;
    const caret = ref.current?.selectionStart ?? prompt.length;
    const token = `/${skillSlug(skill)} `;
    const next = `${prompt.slice(0, slash.start)}${token}${prompt.slice(caret)}`;
    const nextCaret = slash.start + token.length;
    setPrompt(next);
    setSlash(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function withMentions(text: string): Promise<string> {
    if (!mentionRoot || parseMentions(text).length === 0) return text;
    setAttaching(true);
    try {
      return text + (await buildMentionAppendix(mentionRoot, text));
    } finally {
      setAttaching(false);
    }
  }

  async function send(text: string, model: AiModel) {
    const files = attachments;
    setPrompt("");
    setAttachments([]);
    setAttachError(null);
    setMention(null);
    setSlash(null);
    const full = await withMentions(text || ATTACHMENTS_ONLY_PROMPT);
    const sent = await onSubmit({ prompt: full, model, budget: contextBudgetFor(model), attachments: files });
    if (!sent) {
      setPrompt((current) => current || text);
      setAttachments((current) => (current.length ? current : files));
    }
  }

  const canSend = (!!prompt.trim() || attachments.length > 0) && importing === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!canSend || isLoading || attaching || opencodeMissing) return;
    if (askForAccess(selected, () => void send(trimmed, selected))) return;
    await send(trimmed, selected);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto w-full max-w-3xl rounded-2xl border bg-card p-3 shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-amber-300"
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/90 text-sm font-medium text-amber-800 dark:bg-amber-950/90 dark:text-amber-200">
          <UploadIcon className="size-4" />
          Drop to attach
        </div>
      )}

      {(attachments.length > 0 || importing > 0) && (
        <div className="scroll-hidden mb-2 flex gap-2 overflow-x-auto px-1 pt-1">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
            />
          ))}
          {Array.from({ length: importing }, (_, i) => (
            <span key={`importing-${i}`} className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
              <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
            </span>
          ))}
        </div>
      )}
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

      <div className="relative">
        {slash && !mention && (
          <SkillPopup
            matches={skillMatches}
            hasSkills={skills.length > 0}
            active={slashActive}
            onActiveChange={setSlashActive}
            onSelect={insertSkill}
          />
        )}
        {mention && mentionMatches.length > 0 && (
          <MentionPopup
            query={mention.query}
            entries={workspaceEntries}
            loading={workspaceLoading}
            active={mentionActive}
            onActiveChange={setMentionActive}
            onSelect={insertMention}
          />
        )}
        <Textarea
          ref={ref}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            updateMention(event.target.value, event.target.selectionStart ?? undefined);
          }}
          onSelect={(event) => {
            if (mention) updateMention(prompt, event.currentTarget.selectionStart ?? undefined);
          }}
          placeholder={placeholder ?? defaultPlaceholder}
          rows={2}
          disabled={isLoading}
          onPaste={pasteFiles}
          className="max-h-40 min-h-12 resize-none border-0 bg-transparent p-1 text-[15px] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 dark:bg-transparent"
          onKeyDown={(event) => {
            if (slash && !mention) {
              if (event.key === "Escape") {
                event.preventDefault();
                setSlash(null);
                return;
              }
              if (skillMatches.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashActive((i) =>
                    event.key === "ArrowDown"
                      ? Math.min(i + 1, skillMatches.length - 1)
                      : Math.max(i - 1, 0),
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  insertSkill(skillMatches[slashActive] ?? skillMatches[0]);
                  return;
                }
              }
            }
            if (mention && mentionMatches.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMentionActive((i) =>
                  event.key === "ArrowDown"
                    ? Math.min(i + 1, mentionMatches.length - 1)
                    : Math.max(i - 1, 0),
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(mentionMatches[mentionActive]?.rel ?? mentionMatches[0].rel);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>

      {attachError && (
        <p className="mt-1 flex items-start gap-1 px-1 text-xs text-red-600 dark:text-red-400">
          <span className="min-w-0 flex-1">{attachError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setAttachError(null)}>
            <XIcon className="size-3" />
          </button>
        </p>
      )}

      {opencodeMissing && (
        <p className="mt-1 flex items-center gap-1.5 px-1 text-xs text-red-600 dark:text-red-400">
          <CoworkBot state="connection" size={28} className="-my-1" />
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
            onAddFiles={() => void pickFiles()}
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
            <ContextMeter
              usage={usage}
              budget={budget}
              folders={folders}
              onNewChat={onNewChat}
              onSummarize={onSummarize && !isLoading ? () => onSummarize(selected, budget) : undefined}
            />
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
              disabled={!canSend || isLoading || attaching || opencodeMissing}
              aria-label={attaching ? "Attaching files" : "Send"}
            >
              {isLoading || attaching ? <LoaderIcon className="animate-spin" /> : <ArrowUpIcon />}
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

/** A ref that always holds the latest value, for long-lived listeners. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
