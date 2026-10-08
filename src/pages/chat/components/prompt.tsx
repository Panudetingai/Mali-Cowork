import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { toast, useToastError } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { refreshAntigravity } from "@/features/antigravity";
import {
  AttachmentChip,
  importAttachment,
  saveAttachment,
  type Attachment,
} from "@/features/attachments";
import { attachFolder, detachFolder, type ChatSession } from "@/features/chat-history";
import { onCompose } from "@/features/command-palette";
import { refreshCursor, requestCursorLogin } from "@/features/cursor";
import { effortFor, effortLevels, isMaxEffort, setEffortFor, useEffortChoices } from "@/features/effort";
import { filterSkills, skillSlug, useInstructions, type Skill } from "@/features/instructions";
import { McpToolIcon, useInstalledConnectors, useMcpConnections } from "@/features/mcp";
import {
  opencodeWarm,
  refreshOpencode,
  requestProviderKey,
  useOpencode,
  type OpencodeState,
  type PermissionReply,
  type WorkMode,
} from "@/features/opencode";
import type { PermissionRequest } from "../api/chat";
import { useProjects } from "@/features/projects";
import { getProvider } from "@/features/providers";
import { InboxDropdownButton } from "@/features/tasks";
import { useVoiceInput, useVoiceSettings, VoiceButton, VoiceMode } from "@/features/voice";
import {
  findGrant,
  folderName,
  normalizeFolder,
  requestFolderAccess,
  useFolderGrants,
} from "@/features/workspace";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpIcon,
  AudioLinesIcon,
  EyeIcon,
  FolderIcon,
  GhostIcon,
  FolderLockIcon,
  LoaderIcon,
  ScrollTextIcon,
  SquareIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type RefObject } from "react";
import { contextUsage } from "../context-usage";
import type { SendMessage } from "../hooks/use-chat";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import {
  agentNameOf,
  agentOf,
  apiModelId,
  contextBudgetFor,
  findModel,
  isCursorModel,
  isOpencodeModel,
  loadSelectedModelId,
  opencodeModelOf,
  opencodeProviderOf,
  saveSelectedModelId,
  type AiModel,
  type ContextBudget,
} from "../models";
import type { ChatMessage } from "../types";
import { CONTEXT_WARN_RATIO, ContextMeter } from "./context-meter";
import { ContextNearMaxGlow, EffortMaxGlow, EffortPicker } from "./effort-picker";
import { filterMentions, MentionPopup } from "./mention/mention-popup";
import { buildMentionAppendix, parseMentions } from "./mention/mentions";
import { SkillPopup, slashItems, type SlashItem } from "./mention/skill-popup";
import { useWorkspaceFiles } from "./mention/use-workspace-files";
import { useModelCatalog } from "../hooks/use-model-catalog";
import { ModelPicker } from "./model-picker";
import { PromptOptionsMenu } from "./prompt-options-menu";
import { mergeReplyExcerpt } from "./reply-excerpt";
import { ReplyExcerptBar } from "./reply-excerpt-bar";
import {
  clearComposerDraft,
  composerDraftKey,
  readComposerDraft,
  writeComposerDraft,
} from "../composer-draft";

type Props = {
  ref: RefObject<HTMLTextAreaElement | null>;
  mode: WorkMode;
  chatId?: string;
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
  /** Cowork: queue the prompt as a background task (Task Inbox) instead. */
  onSubmitBackground?: (payload: SendMessage) => Promise<boolean>;
  /** Narrow column (Code mode): one toolbar row, folder shown elsewhere. */
  compact?: boolean;
  temporaryChat?: boolean;
  onTemporaryChatChange?: (on: boolean) => void;
  canChangeTemporary?: boolean;
  permissions?: PermissionRequest[];
  onReplyPermission?: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  onAllowFolder?: (request: PermissionRequest, folder: string) => Promise<void>;
};

const NO_FOLDERS: string[] = [];
const MAX_ATTACHMENTS = 10;
/** Sent when the user attaches files but types nothing. */
const ATTACHMENTS_ONLY_PROMPT = "Please take a look at the attached files.";
/** Pasted text longer than this is attached as a file. */
const LONG_PASTE_CHARS = 500;

export default function PromptInput({
  ref,
  mode,
  chatId,
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
  onSubmitBackground,
  compact = false,
  temporaryChat,
  onTemporaryChatChange,
  canChangeTemporary = true,
  permissions = [],
  onReplyPermission,
  onAllowFolder,
}: Props) {
  const { t } = useTranslation();
  const draftKey = composerDraftKey(session?.id ?? chatId, mode);
  const [prompt, setPrompt] = useState(() => readComposerDraft(draftKey).prompt);
  /** Text the user highlighted in the thread — shown above the box, merged on send. */
  const [replyExcerpt, setReplyExcerpt] = useState<string | null>(
    () => readComposerDraft(draftKey).replyExcerpt,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [importing, setImporting] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [modelId, setModelId] = useState(() => loadSelectedModelId(mode));
  const opencode = useOpencode();
  useFolderGrants(); // re-render when access changes

  // Chat ↔ Code remount the composer; restore whatever was typed for this chat.
  useEffect(() => {
    const saved = readComposerDraft(draftKey);
    setPrompt(saved.prompt);
    setReplyExcerpt(saved.replyExcerpt);
  }, [draftKey]);

  const debouncedPrompt = useDebouncedValue(prompt, 250, true);
  useEffect(() => {
    writeComposerDraft(draftKey, { prompt: debouncedPrompt, replyExcerpt });
  }, [draftKey, debouncedPrompt, replyExcerpt]);

  const promptDraftRef = useRef(prompt);
  const excerptDraftRef = useRef(replyExcerpt);
  promptDraftRef.current = prompt;
  excerptDraftRef.current = replyExcerpt;
  useEffect(
    () => () => {
      writeComposerDraft(draftKey, {
        prompt: promptDraftRef.current,
        replyExcerpt: excerptDraftRef.current,
      });
    },
    [draftKey],
  );

  const { catalog, loading: catalogLoading, loadingGroupKeys } = useModelCatalog(mode);
  const refreshCatalogSources = useMemo(
    () => () => {
      void refreshOpencode(false);
      void refreshCursor(false);
      void refreshAntigravity(false);
    },
    [],
  );
  const selected = findModel(catalog, modelId);
  const usesOpencode = isOpencodeModel(selected.id);
  const opencodeMissing = usesOpencode && opencode.check?.available === false;
  // Each agent keeps its own session. One picked up mid-chat is handed the
  // conversation so far (see `handoff`), but not the other's tool runs.
  const ranOn = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.modelId)?.modelId;
  const switchesAgent =
    !!ranOn && agentOf(ranOn) !== agentOf(selected.id)
      ? { from: agentNameOf(ranOn), to: agentNameOf(selected.id) }
      : undefined;
  // Re-reads when the user moves the slider; the store keeps it per model.
  useEffortChoices();
  const effort = effortFor(selected.id, selected.efforts);
  const effortOpts = effortLevels(selected.efforts);
  const maxEffort = isMaxEffort(effortOpts, effort);
  const budget = contextBudgetFor(selected);
  const usageLive = useMemo(() => contextUsage(messages, prompt), [messages, prompt]);
  const usage = useDebouncedValue(usageLive, 400, !!isLoading);
  const contextRatio = Math.min(1, usageLive.usedTokens / budget.maxTokens);
  const contextNearMax = contextRatio >= CONTEXT_WARN_RATIO;
  const contextFull = contextRatio >= 0.95;

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

  /**
   * Ask for whatever the model still needs; true when something was asked.
   * A key for a provider Mali knows is kept as the user's own (Settings →
   * Models): the model then runs on it directly — Chat over the API, Cowork on
   * Mali's own agent — instead of through OpenCode. `onReady` gets the model
   * to use from then on.
   */
  const askForAccess = (model: AiModel, onReady?: (ready: AiModel) => void) => {
    // Only Cursor has an in-app sign-in flow; other CLIs explain sign-in
    // through their own backend errors (e.g. run `agy` once).
    if (model.needsLogin && isCursorModel(model.id)) {
      requestCursorLogin({ onSignedIn: () => onReady?.(model) });
      return true;
    }
    const providerId = model.needsKey ? opencodeProviderOf(model.id) : undefined;
    const own = providerId ? getProvider(providerId) : undefined;
    const name = opencodeModelOf(model.id)?.split("/").slice(1).join("/");
    if (providerId && own && name) {
      requestProviderKey({
        providerId,
        target: "api",
        model: name,
        modelName: model.name,
        onSaved: () => {
          const ready: AiModel = {
            ...model,
            id: apiModelId(providerId, name),
            provider: own.logo,
            source: own.group === "local" ? "local" : "api",
            group: own.name,
            needsKey: false,
            free: undefined,
          };
          setModelId(ready.id);
          saveSelectedModelId(mode, ready.id);
          onReady?.(ready);
        },
      });
      return true;
    }
    if (providerId) {
      requestProviderKey({
        providerId,
        modelName: model.free ? undefined : model.name,
        onSaved: () => onReady?.(model),
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
    const room = MAX_ATTACHMENTS - attachments.length;
    if (sources.length > room) toast.error(`Up to ${MAX_ATTACHMENTS} files per message.`);
    const accepted = sources.slice(0, Math.max(room, 0));
    setImporting((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (source) => {
        try {
          const attachment =
            typeof source === "string" ? await importAttachment(source) : await saveAttachment(source);
          setAttachments((prev) => [...prev, attachment]);
        } catch (error) {
          toast.error(String(error));
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
    if (files.length > 0) {
      event.preventDefault();
      void addAttachments(files);
      return;
    }
    // Long pasted text becomes a text attachment instead of flooding the box.
    const text = event.clipboardData.getData("text/plain");
    if (text.length > LONG_PASTE_CHARS) {
      event.preventDefault();
      const name = `pasted-text-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.txt`;
      void addAttachments([new File([text], name, { type: "text/plain" })]);
    }
  };

  // Files dragged from Finder / Explorer onto the window.
  const addRef = useLatest(addAttachments);
  useEffect(() => {
    if (!isTauri()) return;
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
  const skillMatches = useMemo(
    () => (slash ? filterSkills(skills.filter((k) => k.enabled), slash.query) : []),
    [slash, skills],
  );
  const slashList = useMemo(() => (slash ? slashItems(skillMatches, slash.query) : []), [slash, skillMatches]);

  // Skills and connectors picked for this prompt, shown as badges.
  const [pickedSkills, setPickedSkills] = useState<string[]>([]);
  const [pickedConnectors, setPickedConnectors] = useState<string[]>([]);
  const connectors = useInstalledConnectors();
  const skillBySlug = (slug: string) => skills.find((k) => skillSlug(k) === slug);
  const toggleSkill = (skill: Skill) => {
    const slug = skillSlug(skill);
    setPickedSkills((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };
  const toggleConnector = (id: string) =>
    setPickedConnectors((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

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

  /** A `/` pick: the typed `/query` goes away, the skill becomes a badge. */
  function pickSlash(item: SlashItem) {
    if (!slash) return;
    const caret = ref.current?.selectionStart ?? prompt.length;
    const next = `${prompt.slice(0, slash.start)}${prompt.slice(caret)}`;
    setPrompt(next);
    setSlash(null);
    if (item.kind === "files") void pickFiles();
    else {
      const slug = skillSlug(item.skill);
      setPickedSkills((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
    }
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(slash.start, slash.start);
    });
  }

  /** What the `@` mentions point at, for the model only — the message shows just the text. */
  async function mentionContext(text: string): Promise<string> {
    if (!mentionRoot || parseMentions(text).length === 0) return "";
    setAttaching(true);
    try {
      return await buildMentionAppendix(mentionRoot, text);
    } finally {
      setAttaching(false);
    }
  }

  // Voice: words land after whatever was typed when dictation started. With
  // "Send when I stop talking" (Settings → Voice, on by default) a pause ends
  // dictation and sends the box; before, the mic stayed on until clicked and
  // nothing was sent.
  const voiceSettings = useVoiceSettings();
  const promptNow = useLatest(prompt);
  const voiceBase = useRef("");
  const voice = useVoiceInput({
    autoStop: voiceSettings.autoSend,
    // Opened by mistake: the mic goes off by itself.
    idleMs: 10_000,
    onStart: () => {
      const typed = promptNow.current;
      voiceBase.current = typed && !/\s$/.test(typed) ? `${typed} ` : typed;
    },
    onText: (text) => setPrompt(voiceBase.current + text),
    onEnd: (text) => {
      if (voiceSettings.autoSend && text.trim()) void submitText((voiceBase.current + text).trim());
    },
  });
  /** The voice conversation over the chat (the round button when the box is empty). */
  const [voiceMode, setVoiceMode] = useState(false);
  const lastReply = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last && { id: last.id, text: last.content, streaming: !!last.isStreaming };
  }, [messages]);

  /** Send `text` as if typed and sent; false when it can't go now. */
  async function submitText(text: string): Promise<boolean> {
    if (!text || isLoading || attaching || opencodeMissing || importing > 0) return false;
    if (askForAccess(selected, (ready) => void send(text, ready))) return true;
    return send(text, selected);
  }

  async function send(text: string, model: AiModel, background = false): Promise<boolean> {
    voice.cancel();
    const files = attachments;
    const picks = { skills: pickedSkills, connectors: pickedConnectors };
    const excerpt = replyExcerpt;
    setPrompt("");
    setReplyExcerpt(null);
    clearComposerDraft(draftKey);
    setAttachments([]);
    setPickedSkills([]);
    setPickedConnectors([]);
    setMention(null);
    setSlash(null);
    const skillNames = picks.skills.map((slug) => skillBySlug(slug)?.name ?? slug);
    const fallback = skillNames.length ? `Use ${skillNames.join(", ")}.` : ATTACHMENTS_ONLY_PROMPT;
    const body = text || fallback;
    const shown = excerpt ? mergeReplyExcerpt(body, excerpt) : body;
    const context = await mentionContext(shown);
    const submit = background && onSubmitBackground ? onSubmitBackground : onSubmit;
    const sent = await submit({
      prompt: shown,
      context,
      model,
      budget: contextBudgetFor(model),
      attachments: files,
      skills: picks.skills,
      connectors: picks.connectors,
    });
    if (!sent) {
      setPrompt((current) => current || text);
      if (excerpt) setReplyExcerpt(excerpt);
      setAttachments((current) => (current.length ? current : files));
      setPickedSkills((current) => (current.length ? current : picks.skills));
      setPickedConnectors((current) => (current.length ? current : picks.connectors));
    }
    return sent;
  }

  const canSend = (!!prompt.trim() || attachments.length > 0 || pickedSkills.length > 0) && importing === 0;
  const voiceBusy = voice.listening || voice.phase === "transcribing";
  const showVoicePrimary = voice.supported && !canSend && !voiceBusy && importing === 0;

  useToastError(voice.error, voice.clearError);

  // The ⌘K palette and the empty-state cards fill the box (never send).
  useEffect(
    () =>
      onCompose(({ text, skill, replyExcerpt: excerpt }) => {
        if (skill) setPickedSkills((prev) => (prev.includes(skill) ? prev : [...prev, skill]));
        if (excerpt) setReplyExcerpt(excerpt);
        if (text !== undefined) setPrompt(text);
        requestAnimationFrame(() => {
          const box = ref.current;
          if (!box) return;
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        });
      }),
    [ref],
  );

  // ⌘U / Ctrl+U: attach files, as the plus menu says.
  const pickFilesRef = useLatest(pickFiles);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        void pickFilesRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickFilesRef]);

  const canBackground = isCowork && !!onSubmitBackground && !compact;

  /** ⌘⏎ / the Inbox button: queue it, even while this chat is still working. */
  async function submitBackground() {
    const trimmed = prompt.trim();
    if (!canBackground || !canSend || attaching || opencodeMissing) return;
    if (askForAccess(selected, (ready) => void send(trimmed, ready, true))) return;
    await send(trimmed, selected, true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!canSend || isLoading || attaching || opencodeMissing) return;
    if (askForAccess(selected, (ready) => void send(trimmed, ready))) return;
    await send(trimmed, selected);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "relative w-full rounded-xl border bg-card p-3 shadow-sm transition-[box-shadow,border-color] duration-300 focus-within:ring-1",
        maxEffort || contextFull
          ? "border-foreground/25 shadow-[0_0_28px_-6px_rgba(0,0,0,0.12)] focus-within:ring-ring/70 dark:border-foreground/20 dark:shadow-[0_0_32px_-6px_rgba(0,0,0,0.35)]"
          : contextNearMax
            ? "border-foreground/15 shadow-[0_0_20px_-8px_rgba(0,0,0,0.08)] focus-within:ring-ring/50 dark:border-foreground/15"
            : "focus-within:ring-ring/40",
        contextFull && "border-red-300/40 dark:border-red-400/30",
      )}
    >
      {(temporaryChat || session?.ephemeral) && messages.length > 0 && (
        <p className="mb-2 flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <GhostIcon className="size-3.5 shrink-0" />
          {t("temporaryChatOn")}
        </p>
      )}
      {replyExcerpt && (
        <ReplyExcerptBar excerpt={replyExcerpt} onClear={() => setReplyExcerpt(null)} />
      )}
      {contextNearMax && (
        <div aria-hidden>
          <div
            className={cn(
              "h-full transition-[width] duration-500 ease-out",
              contextFull
                ? "bg-linear-to-r from-red-500 via-foreground/70 to-foreground/40"
                : "bg-linear-to-r from-foreground/50 to-foreground/25",
            )}
            style={{ width: `${Math.round(contextRatio * 100)}%` }}
          />
        </div>
      )}
      <ContextNearMaxGlow ratio={contextRatio} active={false} />
      <EffortMaxGlow active={maxEffort} />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-foreground/35 bg-background/90 text-sm font-medium text-foreground dark:bg-background/95">
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

{!opencodeMissing && switchesAgent && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground mb-2 border-b border-muted-foreground/10 pb-2">
          <CoworkBot state="alert" size={28} className="-my-1" />
          {`${switchesAgent.to} picks up this conversation — it gets what was said, not ${switchesAgent.from}'s own tool steps.`}
        </p>
      )}

      {(pickedSkills.length > 0 || pickedConnectors.length > 0) && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {pickedSkills.map((slug) => (
            <PickBadge
              key={`skill-${slug}`}
              icon={<ScrollTextIcon className="size-3.5 text-foreground/70" />}
              label={slug}
              title={skillBySlug(slug)?.description}
              onRemove={() => setPickedSkills((prev) => prev.filter((s) => s !== slug))}
            />
          ))}
          {pickedConnectors.map((id) => {
            const connector = connectors.find((c) => c.id === id);
            if (!connector) return null;
            return (
              <PickBadge
                key={`mcp-${id}`}
                icon={<McpToolIcon mcp={connector.ref} size={14} />}
                label={connector.name}
                title={connector.enabled ? `Uses ${connector.name}` : `${connector.name} is off — turn it on in Connectors`}
                muted={!connector.enabled}
                onRemove={() => setPickedConnectors((prev) => prev.filter((c) => c !== id))}
              />
            );
          })}
        </div>
      )}

      <div className="relative">
        {slash && !mention && (
          <SkillPopup
            items={slashList}
            hasSkills={skills.length > 0}
            picked={pickedSkills}
            active={slashActive}
            onActiveChange={setSlashActive}
            onSelect={pickSlash}
          />
        )}
        {mention && (mentionMatches.length > 0 || workspaceLoading) && (
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
            // Typing takes over from dictation; what was heard so far stays.
            if (voice.listening) voice.cancel();
            setPrompt(event.target.value);
            updateMention(event.target.value, event.target.selectionStart ?? undefined);
          }}
          onSelect={(event) => {
            if (mention) updateMention(prompt, event.currentTarget.selectionStart ?? undefined);
          }}
          placeholder={
            replyExcerpt ? t("selectionReplyPlaceholder") : (placeholder ?? defaultPlaceholder)
          }
          rows={2}
          disabled={isLoading}
          onPaste={pasteFiles}
          className="max-h-40 min-h-12 resize-none border-0 bg-transparent p-1 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent dark:placeholder:text-muted-foreground/80"
          onKeyDown={(event) => {
            if (slash && !mention) {
              if (event.key === "Escape") {
                event.preventDefault();
                setSlash(null);
                return;
              }
              if (slashList.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashActive((i) =>
                    event.key === "ArrowDown"
                      ? Math.min(i + 1, slashList.length - 1)
                      : Math.max(i - 1, 0),
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  pickSlash(slashList[slashActive] ?? slashList[0]);
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
            if (event.key === "Backspace" && !prompt && event.currentTarget.selectionStart === 0) {
              if (pickedConnectors.length) setPickedConnectors((prev) => prev.slice(0, -1));
              else if (pickedSkills.length) setPickedSkills((prev) => prev.slice(0, -1));
            }
            if (
              event.key === "Enter" &&
              canBackground &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submitBackground();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>

      {opencodeMissing && (
        <p className="mt-1 flex items-center gap-1.5 px-1 text-xs text-red-600 dark:text-red-400">
          <CoworkBot state="connection" size={28} className="-my-1" />
          {opencode.check?.error ?? "OpenCode CLI is not available."}
        </p>
      )}

      <div className={cn("mt-2 flex items-center gap-2", compact ? "flex-nowrap" : "flex-wrap")}>
        <div className={cn("flex items-center gap-2", compact ? "shrink-0" : "min-w-0")}>
          <PromptOptionsMenu
            opencode={usesOpencode ? opencode : undefined}
            mode={mode}
            canAddFolder={!!session?.cwd}
            onAddFolder={addAttachedFolder}
            onAddFiles={() => void pickFiles()}
            skills={skills}
            pickedSkills={pickedSkills}
            onToggleSkill={toggleSkill}
            pickedConnectors={pickedConnectors}
            onToggleConnector={toggleConnector}
            temporaryChat={temporaryChat}
            onTemporaryChatChange={onTemporaryChatChange}
            canChangeTemporary={canChangeTemporary && !messages.length}
          />
          {compact ? null : isCowork ? (
            <FolderChip
              opencode={opencode}
              cwd={cwd}
              boundToChat={!!session?.cwd}
              onClick={pickWorkingFolder}
            />
          ) : (
            <ChatReachChip onSwitchToCowork={() => onModeChange("cowork")} />
          )}
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1">
          {(messages.length > 0 || isLoading) && (
            <ContextMeter
              ringOnly={compact}
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
            loading={catalogLoading}
            loadingGroupKeys={loadingGroupKeys}
            onRefreshSources={refreshCatalogSources}
            onSelect={(model) => {
              setModelId(model.id);
              saveSelectedModelId(mode, model.id);
              askForAccess(model);
            }}
          />
          <EffortPicker
            levels={effortOpts}
            value={effort ?? ""}
            onChange={(level) => setEffortFor(selected.id, level)}
            disabled={isLoading}
          />
          {canBackground && (
            <InboxDropdownButton
              chatId={session?.id}
              onRunBackground={() => void submitBackground()}
              canRunBackground={canSend && !attaching && !opencodeMissing}
              title={`Run in background (${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}Enter) — the agent works on it in the Inbox, with this chat as context, while you keep chatting here`}
            />
          )}
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
          ) : showVoicePrimary ? (
            <>
              <Button
                type="button"
                size="icon-sm"
                className="rounded-full"
                onClick={() => {
                  voice.cancel();
                  setVoiceMode(true);
                }}
                disabled={isLoading || opencodeMissing}
                aria-label={t("voiceModeOpen")}
                title={t("voiceModeOpen")}
              >
                <AudioLinesIcon className="size-3.5" />
              </Button>
            </>
          ) : voiceBusy ? (
            <>
              <VoiceButton voice={voice} size="sm" />
              <Button
                type="submit"
                size="icon-sm"
                className="rounded-full"
                disabled={!canSend || isLoading || attaching || opencodeMissing}
                aria-label="Send"
              >
                <ArrowUpIcon />
              </Button>
            </>
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
      <AnimatePresence>
        {voiceMode && (
          <VoiceMode
            onClose={() => setVoiceMode(false)}
            send={submitText}
            reply={lastReply}
            busy={!!isLoading && permissions.length === 0}
            permissions={permissions}
            onReplyPermission={onReplyPermission}
            onAllowFolder={onAllowFolder}
          />
        )}
      </AnimatePresence>
    </form>
  );
}

/**
 * What Chat can reach, where Cowork shows its folder.
 *
 * Chat leaves the file tools out and never hands a CLI a working folder, but
 * nothing on screen said so — the tooltip on the mode switch is not where
 * anyone looks. It also said nothing about connectors, so people assumed
 * "no file access" meant no tools at all and switched to Cowork to use one.
 */
function ChatReachChip({ onSwitchToCowork }: { onSwitchToCowork: () => void }) {
  const connectors = Object.values(useMcpConnections()).filter((c) => c.enabled).length;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onSwitchToCowork}
      className="min-w-0 gap-1.5 rounded-full px-2 text-xs text-muted-foreground"
      title={
        `Chat answers from what it knows and from your connectors. It cannot open, ` +
        `change or run anything on this Mac, and it is never given a folder.\n\n` +
        `Click to switch to Cowork, which works in the folders you grant.`
      }
    >
      <FolderLockIcon className="size-3.5" />
      <span className="hidden truncate sm:inline">
        {connectors > 0
          ? `No files · ${connectors} connector${connectors === 1 ? "" : "s"}`
          : "No file access"}
      </span>
    </Button>
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
        ? { dot: "bg-muted-foreground/70", label: "Not allowed yet — you’ll be asked before the agent starts" }
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

/** A skill or connector picked for this prompt. */
function PickBadge({
  icon,
  label,
  title,
  muted,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  muted?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      title={title}
      className={cn(
        "group/badge flex h-7 items-center gap-1.5 rounded-lg border bg-muted/50 pr-1 pl-2 text-xs font-medium animate-in fade-in-0 zoom-in-95 duration-150",
        muted && "opacity-60",
      )}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

/** A ref that always holds the latest value, for long-lived listeners. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
