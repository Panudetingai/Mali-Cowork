/**
 * The ask box inside the notch. Without a folder it answers in Chat mode, on
 * the Quick bar's engine, right here. With a folder it works like Cowork: the
 * main window runs it (folder access, checkpoint, Undo) and this shows the
 * steps and the answer as they come.
 */
import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { MessageResponse } from "@/components/ai-elements/message";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { useAttachmentPreview, type Attachment } from "@/features/attachments";
import { quickModelId, type QuickTurn } from "@/features/quick";
import { cn } from "@/lib/utils";
import { useNotchCatalog } from "./use-notch-catalog";
import { chatIssueOf, loadSelectedModelId, OPENCODE_DEFAULT_ID } from "@/pages/chat/models";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  Loader2Icon,
  MessageCircleIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { folderName, useAllowedFolders } from "./folders";
import { CHAT_BOT, CHAT_INPUT, topRowOf } from "./layout";
import { NotchModels } from "./notch-models";
import type { RosterBot } from "./team";
import type { NotchCapture } from "./bridge";
import { useNotchText } from "./text";
import type { NotchGeometry } from "./types";
import type { NotchChat as Chat } from "./use-notch-chat";
import type { CoworkTurn, useNotchCowork } from "./use-notch-cowork";

export type ChatPanel = "models" | "folders" | null;

type Props = {
  chat: Chat;
  cowork: ReturnType<typeof useNotchCowork>;
  geometry: NotchGeometry;
  input: string;
  onInput: (text: string) => void;
  /** The team bot being asked; Mali when unset. */
  bot?: RosterBot;
  /** Back to asking Mali. */
  onClearBot: () => void;
  onClose: () => void;
  /** The folder to work in; null asks in Chat mode. */
  folder: string | null;
  onFolder: (path: string | null) => void;
  /** The model picked here; undefined answers with the bot's, Cowork's or the Quick bar's. */
  modelId?: string;
  /** What the picker shows as chosen: null when following the default. */
  pickedModel: string | null;
  onPickModel: (id: string | null) => void;
  panel: ChatPanel;
  onPanel: (panel: ChatPanel) => void;
  /** Open this conversation's chat in the app. */
  onOpenChat: (chatId: string) => void;
  /** The window just captured (dragging the bot onto it, or the camera). */
  captured?: NotchCapture;
};

/** One tap after a capture or a file: what people most often want done with it, in the app's language. */
const QUICK_ASKS = [
  { label: "qExplain", prompt: "qExplainPrompt" },
  { label: "qSummarize", prompt: "qSummarizePrompt" },
  { label: "qIssues", prompt: "qIssuesPrompt" },
  { label: "qContinue", prompt: "qContinuePrompt" },
] as const;

export const NotchChat = forwardRef<HTMLInputElement, Props>(function NotchChat(props, inputRef) {
  const { chat, cowork, geometry, input, onInput, bot, onClearBot, onClose, folder, panel, onPanel } = props;
  const top = topRowOf(geometry);
  const t = useNotchText();
  const inFolder = !!folder;
  // Cowork's list includes OpenCode Zen; Chat/Quick bar hide Zen's free tier.
  const { catalog, loading } = useNotchCatalog("cowork");
  // What will really answer: the pick here, else the bot's model, else the default for the mode.
  const fallback = inFolder ? loadSelectedModelId("cowork") : quickModelId();
  const answerId = props.modelId ?? ((!inFolder && bot?.modelId) || fallback);
  const nameOf = (id: string) =>
    id === OPENCODE_DEFAULT_ID ? "Auto" : (catalog.find((m) => m.id === id)?.name ?? id.split("/").at(-1) ?? id);
  const answer = catalog.find((m) => m.id === answerId);
  const busy = chat.streaming || cowork.running;
  const thread = inFolder ? cowork.turns.length > 0 : chat.turns.length > 0;

  const submit = async (ask?: string) => {
    const text = (ask ?? input).trim();
    if (busy || (!text && chat.files.length === 0)) return;
    const sendMeta = catalog.find((m) => m.id === answerId);
    if (!inFolder && sendMeta && chatIssueOf(sendMeta)) {
      chat.setNote(`${sendMeta.name} ตอบได้เมื่อเลือกโฟลเดอร์ — กด Chat แล้วเลือกโฟลเดอร์ก่อนส่ง`);
      onPanel("folders");
      return;
    }
    onInput("");
    onPanel(null);
    if (folder) {
      await cowork.send(text || "Look at the attached files.", { folder, modelId: props.modelId, files: chat.takeFiles() });
      return;
    }
    const sent = await chat.send(text, { bot, modelId: props.modelId });
    if (!sent && !ask) onInput(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (panel) onPanel(null);
      else onClose();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void chat.addFiles(files);
  };

  const pick = async () => {
    const picked = await open({ multiple: true }).catch(() => null);
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) void chat.addFiles(paths);
  };

  return (
    <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2" style={{ top: top + 4 }}>
      <AnimatePresence mode="popLayout" initial={false}>
        {panel === "models" ? (
          <NotchModels
            key="models"
            catalog={catalog}
            inFolder={inFolder}
            loading={loading}
            selected={props.pickedModel}
            defaultName={t("sameAs", { where: inFolder ? t("cowork") : t("quickBar"), name: nameOf(fallback) })}
            onPick={(id) => {
              props.onPickModel(id);
              onPanel(null);
            }}
            onClose={() => onPanel(null)}
          />
        ) : panel === "folders" ? (
          <Folders key="folders" folder={folder} onFolder={props.onFolder} onClose={() => onPanel(null)} />
        ) : thread ? (
          inFolder ? (
            <CoworkThread key="cowork" turns={cowork.turns} onOpenChat={props.onOpenChat} />
          ) : (
            <Thread key="thread" turns={chat.turns} answeredBy={chat.answeredBy} />
          )
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {(chat.files.length > 0 || chat.importing > 0) && (
          <motion.div
            className="flex h-[52px] shrink-0 items-center gap-2 overflow-x-auto"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <AnimatePresence initial={false}>
              {chat.files.map((file) => (
                <FileThumb key={file.id} file={file} onRemove={() => chat.removeFile(file.id)} />
              ))}
            </AnimatePresence>
            {chat.importing > 0 && <Loader2Icon className="size-3.5 shrink-0 animate-spin text-white/50" />}
            {props.captured && (
              <span className="shrink-0 truncate text-[11px] text-white/40" title={props.captured.title}>
                {props.captured.app ? `📸 ${props.captured.app}` : `📸 ${t("captured")}`}
              </span>
            )}
            {!input.trim() && !busy && chat.importing === 0 && chat.files.length > 0 && (
              <span className="ml-auto flex shrink-0 gap-1">
                {QUICK_ASKS.map((q) => (
                  <motion.button
                    key={q.label}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    onClick={() => void submit(t(q.prompt))}
                    className="h-7 rounded-full bg-white/[0.1] px-2.5 text-[12px] text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
                  >
                    {t(q.label)}
                  </motion.button>
                ))}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div
        className="flex shrink-0 items-center gap-1.5 rounded-[18px] bg-white/[0.08] px-1.5 ring-1 ring-white/[0.06] focus-within:ring-white/20"
        // The bot sits to the left of the box.
        style={{ height: CHAT_INPUT, marginLeft: CHAT_BOT + 10 }}
      >
        <IconButton title={t("attach")} onClick={() => void pick()} big>
          <PlusIcon className="size-4" />
        </IconButton>
        <Chip
          on={panel === "folders"}
          tint={inFolder ? "#34c77b" : undefined}
          onClick={() => onPanel(panel === "folders" ? null : "folders")}
          title={folder ?? t("chatOnly")}
        >
          {inFolder ? <FolderIcon className="size-3 shrink-0" /> : <MessageCircleIcon className="size-3 shrink-0" />}
          <span className="truncate">{folder ? folderName(folder) : t("chat")}</span>
        </Chip>
        {bot && !inFolder && (
          <span
            className="flex h-7 shrink-0 items-center gap-1 rounded-full border pr-1 pl-2.5 text-[12px] font-medium text-white/85"
            style={{ background: `${bot.color}26`, borderColor: `${bot.color}77` }}
            title={bot.role}
          >
            {bot.name}
            <button
              type="button"
              onClick={onClearBot}
              title={t("askMaliInstead")}
              className="rounded-full p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            inFolder
              ? t("placeholderFolder", { folder: folderName(folder!) })
              : chat.files.length
                ? t("placeholderFile")
                : bot
                  ? t("placeholderBot", { name: bot.name })
                  : t("placeholder")
          }
          className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/35"
          spellCheck={false}
        />
        <Chip
          on={panel === "models"}
          onClick={() => onPanel(panel === "models" ? null : "models")}
          title={t("answeringWith", { name: nameOf(answerId) })}
        >
          {answer && <ModelSelectorLogo provider={answer.provider} className="size-3" />}
          <span className="truncate">{nameOf(answerId)}</span>
          <ChevronDownIcon className={cn("size-3 shrink-0 transition-transform", panel === "models" && "rotate-180")} />
        </Chip>
        {chat.streaming ? (
          <motion.button
            type="button"
            onClick={chat.stop}
            whileTap={{ scale: 0.92 }}
            title={t("stop")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.14] text-white"
          >
            <SquareIcon className="size-3 fill-current" />
          </motion.button>
        ) : (
          <motion.button
            type="button"
            onClick={() => void submit()}
            whileTap={{ scale: 0.92 }}
            disabled={busy || (!input.trim() && chat.files.length === 0)}
            title={inFolder ? t("startWork") : t("send")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition-opacity disabled:opacity-30"
          >
            {cowork.running ? <Loader2Icon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" strokeWidth={2.5} />}
          </motion.button>
        )}
      </div>
      {chat.note && <p className="truncate px-2 text-[11px] text-amber-200/80">{chat.note}</p>}
    </div>
  );
});

function Chip({
  on,
  tint,
  title,
  onClick,
  children,
}: {
  on: boolean;
  tint?: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 max-w-36 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors",
        on ? "bg-white/[0.16] text-white" : "bg-white/[0.06] text-white/60 hover:bg-white/[0.12] hover:text-white",
      )}
      style={tint && !on ? { background: `${tint}22`, color: `${tint}` } : undefined}
    >
      {children}
    </button>
  );
}

/** Where to work: a folder already allowed, another one, or no folder (just chat). */
function Folders({
  folder,
  onFolder,
  onClose,
}: {
  folder: string | null;
  onFolder: (path: string | null) => void;
  onClose: () => void;
}) {
  const allowed = useAllowedFolders();
  const t = useNotchText();
  const choose = async () => {
    const picked = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof picked === "string") {
      onFolder(picked);
      onClose();
    }
  };
  const pickFolder = (path: string | null) => {
    onFolder(path);
    onClose();
  };
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-white/[0.04]"
      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, filter: "blur(4px)" }}
    >
      <p className="shrink-0 border-b border-white/[0.06] px-4 py-2.5 text-[12px] text-white/50">
        {t("foldersIntro")}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Row icon={<MessageCircleIcon className="size-3.5" />} active={!folder} onClick={() => pickFolder(null)}>
          <span className="flex-1">{t("chatOnly")}</span>
          <span className="text-[11px] text-white/35">{t("noFiles")}</span>
        </Row>
        {allowed.map((f) => (
          <Row key={f.path} icon={<FolderIcon className="size-3.5" />} active={folder === f.path} onClick={() => pickFolder(f.path)}>
            <span className="min-w-0 flex-1 truncate" title={f.path}>
              {f.name}
              <span className="ml-2 text-[11px] text-white/30">{f.path}</span>
            </span>
            <span className="shrink-0 text-[11px] text-white/35">{f.access === "write" ? t("readWrite") : t("readOnly")}</span>
          </Row>
        ))}
        <Row icon={<FolderOpenIcon className="size-3.5" />} active={false} onClick={() => void choose()}>
          <span className="flex-1">{t("chooseFolder")}</span>
        </Row>
      </div>
    </motion.div>
  );
}

function Row({
  icon,
  active,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-white/[0.1] text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <span className="shrink-0 text-white/60">{icon}</span>
      {children}
      {active && <CheckIcon className="size-3.5 shrink-0 text-white/80" />}
    </button>
  );
}

function useFollow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  // Follow the answer as it's written.
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [dep]);
  return ref;
}

const THREAD = "min-h-0 flex-1 overflow-y-auto rounded-[20px] bg-white/[0.04] px-4 py-3";

function Thread({ turns, answeredBy }: { turns: QuickTurn[]; answeredBy: Record<string, RosterBot> }) {
  const t = useNotchText();
  const last = turns.at(-1);
  const ref = useFollow(`${turns.length}:${last?.answer.length}`);
  return (
    <motion.div ref={ref} className={THREAD} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col gap-3">
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-2">
            <Asked text={turn.display} files={turn.request.attachments} />
            {answeredBy[turn.id] && (
              <span className="text-[11px] font-semibold" style={{ color: answeredBy[turn.id].color }}>
                {answeredBy[turn.id].name}
              </span>
            )}
            {turn.answer ? (
              <Answer text={turn.answer} streaming={turn.status === "streaming"} />
            ) : turn.status === "streaming" ? (
              <Waiting text={t("thinking")} />
            ) : null}
            {turn.status === "error" && <Failed text={turn.error} />}
            {turn.status === "stopped" && <p className="text-[11px] text-white/35">{t("stopped")}</p>}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/** Work in a folder: what was asked, the steps as they run, the answer, and what changed. */
function CoworkThread({ turns, onOpenChat }: { turns: CoworkTurn[]; onOpenChat: (chatId: string) => void }) {
  const t = useNotchText();
  const last = turns.at(-1);
  const ref = useFollow(`${turns.length}:${last?.reply?.length}:${last?.steps.length}:${last?.status}`);
  return (
    <motion.div ref={ref} className={THREAD} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col gap-3">
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-2">
            <Asked text={turn.prompt} files={turn.files} />
            <span className="flex items-center gap-1 text-[11px] text-emerald-300/70">
              <FolderIcon className="size-3" />
              {folderName(turn.folder)}
            </span>
            {turn.status === "starting" && <Waiting text={t("checkingFolder")} />}
            {turn.status === "queued" && (
              <p className="flex items-center gap-2 text-[12px] text-white/50">
                <ClockIcon className="size-3.5" /> {t("queued")}
              </p>
            )}
            {turn.status === "running" && (
              <div className="flex flex-col gap-1">
                {turn.steps.slice(-3).map((step) => (
                  <p key={step.id} className="flex min-w-0 items-center gap-2 text-[12px] text-white/50">
                    {step.done ? (
                      <CheckIcon className="size-3 shrink-0" />
                    ) : (
                      <Loader2Icon className="size-3 shrink-0 animate-spin" />
                    )}
                    <span className="truncate">{step.title}</span>
                  </p>
                ))}
                {turn.phase === "permission" && (
                  <p className="text-[12px] text-amber-200/80">{t("waitingOk")}</p>
                )}
                {!turn.steps.length && <Waiting text={t("starting")} />}
              </div>
            )}
            {turn.reply && <Answer text={turn.reply} streaming={turn.status === "running"} />}
            {turn.status === "error" && <Failed text={turn.error} />}
            {turn.status === "done" && turn.chatId && (
              <div className="flex items-center gap-2 text-[12px]">
                <span className="flex items-center gap-1 text-emerald-300/80">
                  <CheckIcon className="size-3.5" />
                  {turn.changed
                    ? turn.changed === 1
                      ? t("fileChanged")
                      : t("filesChanged", { n: turn.changed })
                    : t("done")}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenChat(turn.chatId!)}
                  className="ml-auto flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-white/70 hover:bg-white/[0.16] hover:text-white"
                >
                  {turn.changed ? t("reviewUndo") : t("openInMali")}
                  <ArrowUpRightIcon className="size-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function Asked({ text, files }: { text: string; files: Attachment[] }) {
  return (
    <div className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
      {files.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {files.map((file) => (
            <FileThumb key={file.id} file={file} size={40} />
          ))}
        </div>
      )}
      <p className="rounded-2xl bg-white/[0.1] px-3 py-1.5 text-[13px] whitespace-pre-wrap text-white/90">{text}</p>
    </div>
  );
}

function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <MarkdownSurface>
      <MessageResponse className="text-[14px] text-white/90" isAnimating={streaming}>
        {text}
      </MessageResponse>
    </MarkdownSurface>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-white/50">
      <Loader2Icon className="size-3.5 animate-spin" /> {text}
    </div>
  );
}

function Failed({ text }: { text?: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-[12px] text-red-200">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      {text}
    </p>
  );
}

/** A file as a little card: a picture shows itself; anything else, its name. */
function FileThumb({ file, onRemove, size = 48 }: { file: Attachment; onRemove?: () => void; size?: number }) {
  const t = useNotchText();
  const preview = useAttachmentPreview(file);
  return (
    <motion.div
      layout
      title={file.name}
      className="group relative shrink-0 overflow-hidden rounded-xl bg-white/[0.08] ring-1 ring-white/10"
      style={{ height: size, width: preview ? Math.round(size * 1.45) : undefined }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
    >
      {preview ? (
        <img src={preview} alt={file.name} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full max-w-44 items-center gap-2 px-3 text-[12px] text-white/80">
          {file.kind === "image" ? (
            <ImageIcon className="size-4 shrink-0 text-white/60" />
          ) : (
            <FileIcon className="size-4 shrink-0 text-white/60" />
          )}
          <span className="truncate">{file.name}</span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("remove")}
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:text-white"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </motion.div>
  );
}

function IconButton({
  title,
  onClick,
  big,
  children,
}: {
  title: string;
  onClick: () => void;
  big?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white",
        big ? "size-9" : "size-6",
      )}
    >
      {children}
    </button>
  );
}
