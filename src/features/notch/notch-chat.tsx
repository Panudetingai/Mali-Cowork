/**
 * The ask box inside the notch. Without a folder it answers in Chat mode, on
 * the Quick bar's engine, right here. With a folder it works like Cowork: the
 * main window runs it (folder access, checkpoint, Undo) and this shows the
 * steps and the answer as they come.
 */
import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { CoworkBot } from "@/components/anim/cowork-bot";
import type { BotState } from "@/features/cowork-bot";
import { MessageResponse } from "@/components/ai-elements/message";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { useAttachmentPreview, type Attachment } from "@/features/attachments";
import { quickModelId, type QuickTurn } from "@/features/quick";
import { cn } from "@/lib/utils";
import { ensureOpencodeModels, getOpencodeModels, loadOpencodeSettings } from "@/features/opencode";
import { normalizeFolder } from "@/features/workspace";
import { chatIssueOf, loadSelectedModelId, modelMetaFromId, OPENCODE_DEFAULT_ID } from "@/pages/chat/models";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleHelpIcon,
  CornerDownLeftIcon,
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
  ShieldAlertIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { QuestionRequest } from "@/pages/chat/api/chat";
import { EditLines, iconOf } from "./notch-pill";
import { folderName, useAllowedFolders } from "./folders";
import { CHAT_BOT, CHAT_INPUT, questionHeight, topRowOf } from "./layout";
import { NotchQuestion } from "./notch-question";
import { NotchModelsPanel } from "./notch-models-panel";
import type { RosterBot } from "./team";
import type { NotchCapture } from "./bridge";
import { Showcase } from "./notch-showcase";
import { useNotchText } from "./text";
import type { NotchGeometry, NotchSession, NotchStep } from "./types";
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
  /** A chat picked from the session list: what's asked here carries it on. */
  session?: NotchSession;
  onLeaveSession?: () => void;
  /** The agent asked this conversation something: the card sits under the thread. */
  question?: QuestionRequest;
  questionAsker?: string;
  questionBusy?: boolean;
  onAnswer?: (answers: string[][]) => void;
};

/** One tap after a capture or a file: what people most often want done with it, in the app's language. */
const QUICK_ASKS = [
  { label: "qExplain", prompt: "qExplainPrompt" },
  { label: "qSummarize", prompt: "qSummarizePrompt" },
  { label: "qIssues", prompt: "qIssuesPrompt" },
  { label: "qContinue", prompt: "qContinuePrompt" },
] as const;

export const NotchChat = forwardRef<HTMLTextAreaElement, Props>(function NotchChat(props, inputRef) {
  const { chat, cowork, geometry, input, onInput, bot, onClearBot, onClose, panel, onPanel, session } = props;
  const top = topRowOf(geometry);
  const t = useNotchText();
  // A picked session works where it works: its own folder, or none.
  const folder = session ? (session.cwd ?? null) : props.folder;
  const inFolder = !!folder || !!session;
  const [modelsReady, setModelsReady] = useState(!!getOpencodeModels());
  useEffect(() => {
    if (modelsReady) return;
    const cwd = normalizeFolder(loadOpencodeSettings().cwd) || undefined;
    void ensureOpencodeModels(cwd).finally(() => setModelsReady(true));
  }, [modelsReady]);
  // What will really answer: the pick here, else the bot's model, else the default for the mode.
  const fallback = session?.mode === "chat" ? loadSelectedModelId("chat") : inFolder ? loadSelectedModelId("cowork") : quickModelId();
  const answerId = props.modelId ?? ((!inFolder && bot?.modelId) || fallback);
  const opencode = getOpencodeModels();
  const answerMeta = useMemo(
    () => modelMetaFromId(answerId, opencode),
    [answerId, opencode, modelsReady],
  );
  const nameOf = (id: string) =>
    // A session answers on its own model unless another is picked here.
    session && !props.modelId && id === answerId && session.model
      ? session.model
      : id === OPENCODE_DEFAULT_ID
        ? "Auto"
        : (modelMetaFromId(id, opencode).name ?? id.split("/").at(-1) ?? id);
  const busy = chat.streaming || cowork.running;
  const thread = session ? true : inFolder ? cowork.turns.length > 0 : chat.turns.length > 0;
  const needsFolder = !inFolder && !!chatIssueOf(answerMeta);
  const inputNote = chat.note && panel !== "folders";

  const submit = async (ask?: string) => {
    const text = (ask ?? input).trim();
    if (busy || (!text && chat.files.length === 0)) return;
    if (!inFolder && chatIssueOf(answerMeta)) {
      chat.setNote(`${answerMeta.name} ต้องเลือกโฟลเดอร์ก่อนส่ง — เลือกจากรายการด้านบน`);
      onPanel("folders");
      return;
    }
    onInput("");
    onPanel(null);
    if (session) {
      await cowork.send(text || "Look at the attached files.", {
        folder: session.cwd ?? "",
        modelId: props.modelId,
        files: chat.takeFiles(),
        session: session.id,
      });
      return;
    }
    if (folder) {
      await cowork.send(text || "Look at the attached files.", { folder, modelId: props.modelId, files: chat.takeFiles() });
      return;
    }
    const sent = await chat.send(text, { bot, modelId: props.modelId });
    if (!sent && !ask) onInput(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (panel) onPanel(null);
      else onClose();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
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
          <NotchModelsPanel
            key="models"
            inFolder={inFolder}
            selected={props.pickedModel}
            defaultName={t("sameAs", { where: inFolder ? t("cowork") : t("quickBar"), name: nameOf(fallback) })}
            onPick={(id) => {
              props.onPickModel(id);
              onPanel(null);
            }}
            onClose={() => onPanel(null)}
          />
        ) : panel === "folders" ? (
          <Folders
            key="folders"
            folder={folder}
            hint={chat.note ?? undefined}
            onFolder={props.onFolder}
            onClose={() => onPanel(null)}
          />
        ) : thread ? (
          inFolder ? (
            <CoworkThread key="cowork" turns={cowork.turns} onOpenChat={props.onOpenChat} session={session} />
          ) : (
            <Thread key="thread" turns={chat.turns} answeredBy={chat.answeredBy} />
          )
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {props.question && !panel && (
          <motion.div
            key={props.question.id}
            className="flex shrink-0"
            style={{ height: questionHeight(props.question) }}
            initial={{ opacity: 0, y: 14, scale: 0.97, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <NotchQuestion
              request={props.question}
              asker={props.questionAsker ?? "Mali"}
              busy={!!props.questionBusy}
              onAnswer={(answers) => props.onAnswer?.(answers)}
              keys
              className="flex-1"
            />
          </motion.div>
        )}
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
      <AnimatePresence initial={false}>
        {inputNote && (
          <motion.div
            key="note"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex shrink-0 items-start gap-1.5 rounded-xl bg-amber-400/10 px-2.5 py-1.5 ring-1 ring-amber-400/20"
          >
            <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-amber-300/90" />
            <p className="line-clamp-2 text-[11px] leading-snug text-amber-100/90">{chat.note}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {/* The composer: the words on top (the bot sits in its corner), the buttons under them. */}
      <div
        className="flex shrink-0 flex-col justify-between rounded-[22px] bg-white/[0.07] px-2 pt-2 pb-2 ring-1 ring-white/[0.07] transition-shadow focus-within:ring-white/20"
        style={{ height: CHAT_INPUT }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            session
              ? t("placeholderSession", { title: session.title || t("untitled") })
              : folder
                ? t("placeholderFolder", { folder: folderName(folder) })
                : chat.files.length
                  ? t("placeholderFile")
                  : bot
                    ? t("placeholderBot", { name: bot.name })
                    : t("placeholder")
          }
          className="h-[34px] w-full resize-none bg-transparent py-1.5 pr-2 text-[14.5px] leading-snug text-white outline-none placeholder:text-white/35"
          style={{ paddingLeft: CHAT_BOT + 12 }}
          spellCheck={false}
        />
        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton title={t("attach")} onClick={() => void pick()}>
            <PlusIcon className="size-4" />
          </IconButton>
          {session ? (
            <span
              className="flex h-7 max-w-52 min-w-0 shrink items-center gap-1 rounded-full bg-white/[0.08] pr-1 pl-2.5 text-[12px] text-white/75"
              title={t("continuing", { title: session.title })}
            >
              <CornerDownLeftIcon className="size-3 shrink-0" />
              <span className="truncate">{session.title || t("untitled")}</span>
              <button
                type="button"
                onClick={props.onLeaveSession}
                title={t("leaveSession")}
                className="rounded-full p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ) : (
            <Chip
              on={panel === "folders"}
              tint={inFolder ? "#34c77b" : needsFolder ? "#f5a524" : undefined}
              onClick={() => onPanel(panel === "folders" ? null : "folders")}
              title={needsFolder ? (chat.note ?? t("chatOnly")) : (folder ?? t("chatOnly"))}
            >
              {inFolder ? <FolderIcon className="size-3 shrink-0" /> : <MessageCircleIcon className="size-3 shrink-0" />}
              <span className="truncate">{folder ? folderName(folder) : t("chat")}</span>
            </Chip>
          )}
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
          <Chip
            on={panel === "models"}
            onClick={() => onPanel(panel === "models" ? null : "models")}
            title={t("answeringWith", { name: nameOf(answerId) })}
          >
            <ModelSelectorLogo provider={answerMeta.provider} className="size-3" />
            <span className="truncate">{nameOf(answerId)}</span>
            <ChevronDownIcon className={cn("size-3 shrink-0 transition-transform", panel === "models" && "rotate-180")} />
          </Chip>
          <span className="ml-auto min-w-0 truncate pl-2 text-right text-[11px] text-white/30">{t("composerHint")}</span>
          {chat.streaming || (inFolder && cowork.running) ? (
            <motion.button
              type="button"
              onClick={inFolder ? cowork.stop : chat.stop}
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
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_2px_10px_rgba(255,255,255,0.18)] transition-opacity disabled:opacity-30"
            >
              {cowork.running ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <ArrowUpIcon className="size-4" strokeWidth={2.5} />
              )}
            </motion.button>
          )}
        </div>
      </div>
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
  hint,
  onFolder,
  onClose,
}: {
  folder: string | null;
  hint?: string;
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
      <div className="shrink-0 border-b border-white/[0.06] px-4 py-2.5">
        <p className="text-[12px] text-white/50">{t("foldersIntro")}</p>
        {hint && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-amber-200/90">
            <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-amber-300/90" />
            <span>{hint}</span>
          </p>
        )}
      </div>
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

/**
 * Work in a folder: what was asked, the steps as they run, the answer as
 * it's written, and what changed. The folder is on the chip below and the
 * chat opens from "Open Mali" above, so the turns don't repeat them: only
 * the latest says it's done, and a turn that changed files keeps its review.
 */
function CoworkThread({
  turns: all,
  onOpenChat,
  session,
}: {
  turns: CoworkTurn[];
  onOpenChat: (chatId: string) => void;
  session?: NotchSession;
}) {
  const t = useNotchText();
  // A picked session shows only what was asked in it here.
  const turns = session ? all.filter((turn) => turn.chatId === session.id) : all;
  const last = turns.at(-1);
  const pages = last?.showcase?.reduce((n, s) => n + s.items.length, 0) ?? 0;
  const ref = useFollow(
    `${turns.length}:${last?.reply?.length}:${last?.steps.length}:${last?.status}:${pages}:${last?.edits?.length}`,
  );
  return (
    <motion.div ref={ref} className={THREAD} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col gap-4">
        {session && (session.asked || session.answer) && (
          // Where the session left off, so the next question reads in place.
          <div className="flex flex-col gap-1.5 border-b border-white/[0.06] pb-3 opacity-60">
            <span className="text-[10.5px] font-medium tracking-wide text-white/40 uppercase">{t("earlier")}</span>
            {session.asked && <Asked text={session.asked} files={[]} />}
            {session.answer && <p className="line-clamp-4 text-[12.5px] leading-relaxed text-white/70">{session.answer}</p>}
          </div>
        )}
        {turns.map((turn) => (
          <CoworkTurnView key={turn.id} turn={turn} latest={turn === last} onOpenChat={onOpenChat} onGrow={ref} />
        ))}
      </div>
    </motion.div>
  );
}

function CoworkTurnView({
  turn,
  latest,
  onOpenChat,
  onGrow,
}: {
  turn: CoworkTurn;
  latest: boolean;
  onOpenChat: (chatId: string) => void;
  onGrow: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useNotchText();
  const live = turn.status === "running";
  const writing = live && !!turn.reply;
  // Just finished: the answer may have come whole with the finish; write it out still.
  const fresh = live || (latest && !!turn.endedAt && Date.now() - turn.endedAt < FRESH_MS);
  return (
    <div className="flex flex-col gap-2">
      <Asked text={turn.prompt} files={turn.files} />
      {turn.status === "starting" && <Waiting text={t("checkingFolder")} />}
      {turn.status === "queued" && (
        <p className="flex items-center gap-2 text-[12px] text-white/50">
          <ClockIcon className="size-3.5" /> {t("queued")}
        </p>
      )}
      {/* While it works: its last few steps, each with what it touched; new ones roll in under. */}
      {live && <StepTrail turn={turn} writing={writing} />}
      {turn.reply && <TypedAnswer text={turn.reply} live={fresh} onGrow={onGrow} />}
      {/* What it wrote, as diffs: a few lines of each file. */}
      {turn.edits?.map((edit) => (
        <motion.div
          key={edit.id}
          className="rounded-xl bg-[#15151b] p-2 ring-1 ring-white/[0.06]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <EditLines edit={edit} lines={6} />
        </motion.div>
      ))}
      {turn.failed && <Failed text={turn.failed} />}
      {/* What it made: pages join the strip as the agent makes them. */}
      {turn.showcase?.map((showcase, i) => (
        <Showcase key={`${showcase.url ?? showcase.source ?? "pictures"}-${i}`} showcase={showcase} className="mt-1" />
      ))}
      {turn.status === "error" && <Failed text={turn.error} />}
      {turn.status === "stopped" && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-white/40">
          <SquareIcon className="size-2.5 fill-current" />
          {t("stopped")}
        </p>
      )}
      {turn.status === "done" && turn.chatId && (turn.changed || latest) && (
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="flex items-center gap-1 text-emerald-300/70">
            <CheckIcon className="size-3.5" />
            {turn.changed
              ? turn.changed === 1
                ? t("fileChanged")
                : t("filesChanged", { n: turn.changed })
              : t("done")}
          </span>
          {!!turn.changed && (
            <button
              type="button"
              onClick={() => onOpenChat(turn.chatId!)}
              className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-white/70 hover:bg-white/[0.16] hover:text-white"
            >
              {t("reviewUndo")}
              <ArrowUpRightIcon className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const STEP_BLUE = "#3aa3f5";
const STEP_ASK = "#0a84ff";
const STEP_AMBER = "#f5a524";

type TrailRow = {
  key: string;
  icon: LucideIcon;
  verb: string;
  /** What it worked on: a path, a command, a query. */
  rest?: string;
  state: "done" | "running" | "asking" | "waiting";
};

/** "bash npm test" → "Bash" and "npm test". */
function splitStep(title: string) {
  const [verb = "", ...rest] = title.trim().split(/\s+/);
  return { verb: verb.charAt(0).toUpperCase() + verb.slice(1), rest: rest.join(" ") || undefined };
}

function trailOf(turn: CoworkTurn, writing: boolean, t: ReturnType<typeof useNotchText>): TrailRow[] {
  const rows: TrailRow[] = turn.steps.map((step: NotchStep) => {
    // The question tool reads as what it is: the agent waiting on you.
    if (/^(question|ask)\b/i.test(step.title.trim())) {
      const state = step.done ? "done" : turn.question ? "asking" : "running";
      return { key: step.id, icon: CircleHelpIcon, verb: t("askingYou"), state };
    }
    return { key: step.id, icon: iconOf(step), ...splitStep(step.title), state: step.done ? "done" : "running" };
  });
  if (turn.question && !rows.some((row) => row.state === "asking")) {
    rows.push({ key: `question:${turn.question.id}`, icon: CircleHelpIcon, verb: t("waitingAnswer"), state: "asking" });
  } else if (turn.phase === "permission") {
    rows.push({ key: "permission", icon: ShieldAlertIcon, verb: t("waitingOk"), state: "waiting" });
  } else if (!rows.some((row) => row.state !== "done")) {
    const verb = writing ? t("writing") : t("starting");
    rows.push({ key: writing ? "writing" : "starting", icon: SparklesIcon, verb, state: "running" });
  }
  return rows.slice(-4);
}

/** A trail row's height and the gap under it; the bot steps down by both. */
const TRAIL_ROW = 24;
const TRAIL_GAP = 4;
/** The bot on the step at work, a little bigger than the icons. */
const TRAIL_BOT = 30;

/** What the bot does on the step at work. */
function poseOf(row: TrailRow): BotState {
  if (row.state === "asking") return "question";
  if (row.state === "waiting") return "permission";
  // At work, the bot always: "thinking" and "working" fold it into three dots now and then, a spinner again.
  return "tool";
}

/**
 * The steps a run is taking, as a short trail: done ones dim, a question in
 * blue. The bot stands on the step at work in place of a spinner; it's one
 * bot that moves down as steps come (an animation each would reload).
 */
function StepTrail({ turn, writing }: { turn: CoworkTurn; writing: boolean }) {
  const t = useNotchText();
  const rows = trailOf(turn, writing, t);
  let at = rows.length - 1;
  while (at >= 0 && rows[at].state === "done") at--;
  const live = rows[at];
  return (
    <div className="relative flex flex-col" style={{ gap: TRAIL_GAP }}>
      {/* The thread joining the steps. */}
      <span aria-hidden className="absolute top-3 bottom-3 left-[9.5px] w-px bg-white/[0.08]" />
      <AnimatePresence mode="popLayout" initial={false}>
        {rows.map((row, i) => (
          <StepRow key={row.key} row={row} latest={i === rows.length - 1} bot={i === at} />
        ))}
      </AnimatePresence>
      {live && (
        <motion.div
          className="pointer-events-none absolute top-0 z-10"
          style={{ left: (20 - TRAIL_BOT) / 2 }}
          initial={false}
          animate={{ y: at * (TRAIL_ROW + TRAIL_GAP) + (TRAIL_ROW - TRAIL_BOT) / 2 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        >
          <CoworkBot size={TRAIL_BOT} state={poseOf(live)} theme="dark" />
        </motion.div>
      )}
    </div>
  );
}

function StepRow({ row, latest, bot }: { row: TrailRow; latest: boolean; bot: boolean }) {
  const done = row.state === "done";
  const tint = row.state === "asking" ? STEP_ASK : row.state === "waiting" ? STEP_AMBER : STEP_BLUE;
  const chip: CSSProperties = done
    ? { background: "#26262d", color: "rgba(255,255,255,0.6)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }
    : { background: `color-mix(in srgb, ${tint} 22%, #1c1c22)`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}55` };
  return (
    <motion.div
      layout
      className="relative flex min-w-0 items-center gap-2 text-[12px]"
      style={{ height: TRAIL_ROW }}
      title={row.rest ? `${row.verb} ${row.rest}` : row.verb}
      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      animate={{ opacity: done && !latest ? 0.5 : 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
    >
      {bot ? (
        // The bot stands here (`StepTrail`).
        <span className="size-5 shrink-0" />
      ) : (
        <span className="relative flex size-5 shrink-0 items-center justify-center rounded-[7px]" style={chip}>
          <row.icon className="size-3" />
        </span>
      )}
      <span
        className={cn("shrink-0 font-medium", done ? "text-white/70" : "text-white/90")}
        // A question or an approval says so in its color.
        style={row.state === "asking" || row.state === "waiting" ? { color: tint } : undefined}
      >
        {row.verb}
      </span>
      {row.rest && <span className="min-w-0 truncate font-mono text-[11px] text-white/40">{row.rest}</span>}
      <span className="ml-auto flex shrink-0 items-center pl-2">
        {done ? (
          <CheckIcon className="size-3 text-emerald-300/70" />
        ) : row.state === "running" ? null : (
          <span
            className="notch-loop size-1.5 rounded-full"
            style={{ background: tint, animation: "notch-fade 1.4s ease-in-out infinite" }}
          />
        )}
      </span>
    </motion.div>
  );
}

/** The answer, written out as it arrives rather than in jumps (it comes from the app in pieces). */
function TypedAnswer({
  text,
  live,
  onGrow,
}: {
  text: string;
  live: boolean;
  onGrow: React.RefObject<HTMLDivElement | null>;
}) {
  const shown = useTypewriter(text, live);
  const typing = shown.length < text.length;
  // Keep the newest words in view as they're written.
  useEffect(() => {
    const thread = onGrow.current;
    if (thread && typing) thread.scrollTop = thread.scrollHeight;
  }, [shown, typing, onGrow]);
  return <Answer text={shown} streaming={live || typing} />;
}

/** A turn this recently finished still writes its answer out. */
const FRESH_MS = 1500;
/** Characters a second it writes at, and how fast it catches up when far behind. */
const TYPE_RATE = 90;
const CATCH_UP = 3;
/** Redraw at most this often: each draw lays out the answer's markdown again. */
const TYPE_FRAME_MS = 33;

/**
 * Text that writes itself out: an answer already done when it appears shows
 * whole; one being written grows smoothly toward what has arrived, faster
 * the further behind it is, so it never lags far.
 */
function useTypewriter(text: string, live: boolean) {
  const [count, setCount] = useState(() => (live ? 0 : text.length));
  const counted = useRef(count);
  useEffect(() => {
    if (counted.current >= text.length) {
      counted.current = Math.min(counted.current, text.length);
      return;
    }
    let frame = 0;
    let last = performance.now();
    let drawn = last;
    let carry = 0;
    const tick = (now: number) => {
      const behind = text.length - counted.current;
      carry += ((now - last) / 1000) * Math.max(TYPE_RATE, behind * CATCH_UP);
      last = now;
      const step = Math.floor(carry);
      carry -= step;
      counted.current = Math.min(text.length, counted.current + step);
      const done = counted.current >= text.length;
      if (done || now - drawn >= TYPE_FRAME_MS) {
        drawn = now;
        setCount(counted.current);
      }
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return text.slice(0, Math.min(count, text.length));
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

/** Not answering yet: the bot at work, in place of a spinner. */
function Waiting({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-white/50">
      <CoworkBot size={TRAIL_BOT} state="tool" theme="dark" className="-my-1 -ml-1" />
      {text}
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
