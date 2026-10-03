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
import {
  speak,
  speakerState,
  stopSpeaking,
  subscribeSpeaker,
  useVoiceInput,
  useVoiceSettings,
  Waveform,
  type VoiceInput,
} from "@/features/voice";
import { THINKING_AFTER_MS, useQuietFor } from "@/hooks/use-quiet-for";
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
  MicIcon,
  PlusIcon,
  ShieldAlertIcon,
  SparklesIcon,
  SquareIcon,
  Volume2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import { whilePicking, type NotchCapture } from "./bridge";
import { Showcase } from "./notch-showcase";
import { useNotchText } from "./text";
import type { NotchGeometry, NotchLook, NotchSession, NotchStep } from "./types";
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
  /** Open pill look; light uses dark ink on pale surfaces. */
  look?: NotchLook;
};

function chatInk(look?: NotchLook) {
  const light = look === "light";
  return {
    thread: cn("min-h-0 flex-1 overflow-y-auto rounded-[20px] px-4 py-3", light ? "bg-black/[0.04]" : "bg-white/[0.04]"),
    panel: light ? "bg-black/[0.03]" : "bg-white/[0.04]",
    border: light ? "border-black/[0.08]" : "border-white/[0.06]",
    prose: light
      ? "text-[14px] text-[#16161b]/90 [&_.text-foreground]:text-[#16161b]/90 [&.chat-markdown]:text-[#16161b]/90"
      : "text-[14px] text-white/90",
    userBubble: light
      ? "rounded-2xl bg-black/[0.07] px-3 py-1.5 text-[13px] whitespace-pre-wrap text-[#16161b]/90"
      : "rounded-2xl bg-white/[0.1] px-3 py-1.5 text-[13px] whitespace-pre-wrap text-white/90",
    muted: light ? "text-[#16161b]/50" : "text-white/50",
    faint: light ? "text-[#16161b]/35" : "text-white/35",
    softer: light ? "text-[#16161b]/40" : "text-white/40",
    soft: light ? "text-[#16161b]/70" : "text-white/70",
    input: light ? "text-[#16161b] placeholder:text-[#16161b]/35" : "text-white placeholder:text-white/35",
    composer: light
      ? "rounded-[22px] bg-black/[0.05] ring-1 ring-black/[0.08] focus-within:ring-black/15"
      : "rounded-[22px] bg-white/[0.07] ring-1 ring-white/[0.07] focus-within:ring-white/20",
    // Solid, so the words under it don't show through while talking.
    voiceBar: light ? "rounded-[22px] bg-[#ececef] ring-1 ring-black/[0.1]" : "rounded-[22px] bg-[#1c1c22] ring-1 ring-white/[0.12]",
    chipOn: light ? "bg-black/[0.12] text-[#16161b]" : "bg-white/[0.16] text-white",
    chipOff: light
      ? "bg-black/[0.06] text-[#16161b]/60 hover:bg-black/[0.1] hover:text-[#16161b]"
      : "bg-white/[0.06] text-white/60 hover:bg-white/[0.12] hover:text-white",
    rowActive: light ? "bg-black/[0.08] text-[#16161b]" : "bg-white/[0.1] text-white",
    rowIdle: light
      ? "text-[#16161b]/75 hover:bg-black/[0.04] hover:text-[#16161b]"
      : "text-white/75 hover:bg-white/[0.06] hover:text-white",
    rowIcon: light ? "text-[#16161b]/55" : "text-white/60",
    done: light ? "text-emerald-700/80" : "text-emerald-300/70",
    quickAsk: light
      ? "bg-black/[0.07] text-[#16161b]/80 hover:bg-black/[0.12] hover:text-[#16161b]"
      : "bg-white/[0.1] text-white/80 hover:bg-white/[0.18] hover:text-white",
    hintNote: light ? "text-amber-900/90" : "text-amber-100/90",
    hintIcon: light ? "text-amber-700" : "text-amber-300/90",
    sessionBadge: light ? "bg-black/[0.07] text-[#16161b]/75" : "bg-white/[0.08] text-white/75",
    iconBtn: light ? "text-[#16161b]/55 hover:bg-black/[0.08] hover:text-[#16161b]" : "text-white/60 hover:bg-white/[0.1] hover:text-white",
    stopBtn: light ? "bg-black/[0.1] text-[#16161b]" : "bg-white/[0.14] text-white",
    composerHint: light ? "text-[#16161b]/30" : "text-white/30",
    trailLine: light ? "bg-black/[0.1]" : "bg-white/[0.08]",
    stepDone: light ? "text-[#16161b]/65" : "text-white/70",
    stepLive: light ? "text-[#16161b]/90" : "text-white/90",
    stepRest: light ? "text-[#16161b]/40" : "text-white/40",
    botTheme: (light ? "light" : "dark") as "light" | "dark",
  };
}

type ChatInk = ReturnType<typeof chatInk>;
const ChatLookCtx = createContext<ChatInk>(chatInk());
function useChatInk() {
  return useContext(ChatLookCtx);
}

/** Step trail + panels: ease instead of bouncy springs (reads smoother while streaming). */
const FLOW: Transition = { duration: 0.38, ease: [0.22, 1, 0.36, 1] };
const FLOW_SPRING: Transition = { type: "spring", stiffness: 280, damping: 32, mass: 1.05 };

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
  const ink = chatInk(props.look);

  // Voice: a task said out loud, and (per Settings → Voice) the reply read back.
  const voiceSettings = useVoiceSettings();
  /** The words came from the mic, not the keyboard. */
  const fromVoice = useRef(false);
  /** The last ask that was spoken: its reply is read aloud. */
  const spokenAsk = useRef<string>(undefined);
  const voice = useVoiceInput({
    autoStop: voiceSettings.autoSend,
    onStart: () => stopSpeaking(),
    onText: (text) => {
      fromVoice.current = true;
      onInput(text);
    },
    onTranscribed: (text) => {
      if (voiceSettings.autoSend) void submit(text);
    },
  });
  // System dictation streams words; it's sent when the user stops it.
  const wasListening = useRef(false);
  useEffect(() => {
    if (voice.engine === "system" && wasListening.current && !voice.listening && voiceSettings.autoSend && input.trim()) {
      void submit();
    }
    wasListening.current = voice.listening;
  }, [voice.listening]);
  useEffect(() => {
    if (!voice.error) return;
    chat.setNote(voice.error);
    voice.clearError();
  }, [voice.error, voice, chat]);

  const lastAsk = chat.turns.at(-1);
  const lastWork = cowork.turns.at(-1);
  const spoken = useRef<Set<string> | null>(null);
  // Replies already there when the notch opened aren't read out.
  spoken.current ??= new Set([lastAsk?.id, lastWork?.id].filter((id): id is string => !!id));
  useEffect(() => {
    const mode = voiceSettings.speakReplies;
    const finished = [
      lastAsk?.status === "done" ? { id: lastAsk.id, asked: lastAsk.display, reply: lastAsk.answer } : null,
      lastWork?.status === "done" ? { id: lastWork.id, asked: lastWork.prompt, reply: lastWork.reply ?? "" } : null,
    ];
    for (const turn of finished) {
      if (!turn || spoken.current!.has(turn.id) || !turn.reply.trim()) continue;
      spoken.current!.add(turn.id);
      if (mode === "always" || (mode === "voice" && turn.asked.trim() === spokenAsk.current?.trim())) void speak(turn.reply);
    }
  }, [lastAsk?.id, lastAsk?.status, lastWork?.id, lastWork?.status, voiceSettings.speakReplies]);
  // The notch closing ends what it was saying.
  useEffect(() => () => stopSpeaking(), []);

  const submit = async (ask?: string) => {
    const text = (ask ?? input).trim();
    if (busy || (!text && chat.files.length === 0)) return;
    if (!inFolder && chatIssueOf(answerMeta)) {
      chat.setNote(`${answerMeta.name} ต้องเลือกโฟลเดอร์ก่อนส่ง — เลือกจากรายการด้านบน`);
      onPanel("folders");
      return;
    }
    spokenAsk.current = fromVoice.current ? text : undefined;
    fromVoice.current = false;
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
    const picked = await whilePicking(() => open({ multiple: true })).catch(() => null);
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) void chat.addFiles(paths);
  };

  return (
    <ChatLookCtx.Provider value={ink}>
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
            transition={FLOW}
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
            className="flex h-13 shrink-0 items-center gap-2 overflow-x-auto"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <AnimatePresence initial={false}>
              {chat.files.map((file) => (
                <FileThumb key={file.id} file={file} onRemove={() => chat.removeFile(file.id)} />
              ))}
            </AnimatePresence>
            {chat.importing > 0 && <Loader2Icon className={cn("size-3.5 shrink-0 animate-spin", ink.muted)} />}
            {props.captured && (
              <span className={cn("shrink-0 truncate text-[11px]", ink.softer)} title={props.captured.title}>
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
                    className={cn("h-7 rounded-full px-2.5 text-[12px] transition-colors", ink.quickAsk)}
                  >
                    {t(q.label)}
                  </motion.button>
                ))}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <SpeakingPill />
      <AnimatePresence initial={false}>
        {inputNote && (
          <motion.div
            key="note"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex shrink-0 items-start gap-1.5 rounded-xl bg-amber-400/10 px-2.5 py-1.5 ring-1 ring-amber-400/20"
          >
            <CircleAlertIcon className={cn("mt-px size-3.5 shrink-0", ink.hintIcon)} />
            <p className={cn("line-clamp-2 text-[11px] leading-snug", ink.hintNote)}>{chat.note}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {/* The composer: the words on top (the bot sits in its corner), the buttons under them. */}
      <div className={cn("relative flex shrink-0 flex-col justify-between px-2 pt-2 pb-2 transition-shadow", ink.composer)} style={{ height: CHAT_INPUT }}>
        <AnimatePresence>
          {voice.phase !== "idle" && (
            <VoiceBar
              voice={voice}
              autoSend={voiceSettings.autoSend}
              onDone={voice.stop}
              onCancel={() => {
                voice.cancel();
                fromVoice.current = false;
              }}
            />
          )}
        </AnimatePresence>
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
          className={cn("h-[34px] w-full resize-none bg-transparent py-1.5 pr-2 text-[14.5px] leading-snug outline-none", ink.input)}
          style={{ paddingLeft: CHAT_BOT + 12 }}
          spellCheck={false}
        />
        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton title={t("attach")} onClick={() => void pick()}>
            <PlusIcon className="size-4" />
          </IconButton>
          {session ? (
            <span
              className={cn("flex h-7 max-w-52 min-w-0 shrink items-center gap-1 rounded-full pr-1 pl-2.5 text-[12px]", ink.sessionBadge)}
              title={t("continuing", { title: session.title })}
            >
              <CornerDownLeftIcon className="size-3 shrink-0" />
              <span className="truncate">{session.title || t("untitled")}</span>
              <button
                type="button"
                onClick={props.onLeaveSession}
                title={t("leaveSession")}
                className={cn("rounded-full p-0.5", ink.muted, "hover:bg-black/[0.06] hover:opacity-100")}
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
                className={cn("rounded-full p-0.5", ink.muted, "hover:bg-black/[0.06] hover:opacity-100")}
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
          <span className={cn("ml-auto min-w-0 truncate pl-2 text-right text-[11px]", ink.composerHint)}>{t("composerHint")}</span>
          {chat.streaming || (inFolder && cowork.running) ? (
            <motion.button
              type="button"
              onClick={inFolder ? cowork.stop : chat.stop}
              whileTap={{ scale: 0.92 }}
              title={t("stop")}
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", ink.stopBtn)}
            >
              <SquareIcon className="size-3 fill-current" />
            </motion.button>
          ) : !busy && !input.trim() && chat.files.length === 0 && voice.supported ? (
            <motion.button
              type="button"
              onClick={() => void voice.start()}
              whileTap={{ scale: 0.92 }}
              title={t("voiceSpeak")}
              aria-label={t("voiceSpeak")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_2px_10px_rgba(255,255,255,0.18)]"
            >
              <MicIcon className="size-4" strokeWidth={2.25} />
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
    </ChatLookCtx.Provider>
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
  const ink = useChatInk();
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 max-w-36 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors",
        on ? ink.chipOn : ink.chipOff,
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
  const ink = useChatInk();
  const choose = async () => {
    const picked = await whilePicking(() => open({ directory: true, multiple: false })).catch(() => null);
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
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px]", ink.panel)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={FLOW}
    >
      <div className={cn("shrink-0 border-b px-4 py-2.5", ink.border)}>
        <p className={cn("text-[12px]", ink.muted)}>{t("foldersIntro")}</p>
        {hint && (
          <p className={cn("mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug", ink.hintNote)}>
            <CircleAlertIcon className={cn("mt-px size-3.5 shrink-0", ink.hintIcon)} />
            <span>{hint}</span>
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Row icon={<MessageCircleIcon className="size-3.5" />} active={!folder} onClick={() => pickFolder(null)}>
          <span className="flex-1">{t("chatOnly")}</span>
          <span className={cn("text-[11px]", ink.faint)}>{t("noFiles")}</span>
        </Row>
        {allowed.map((f) => (
          <Row key={f.path} icon={<FolderIcon className="size-3.5" />} active={folder === f.path} onClick={() => pickFolder(f.path)}>
            <span className="min-w-0 flex-1 truncate" title={f.path}>
              {f.name}
              <span className={cn("ml-2 text-[11px]", ink.faint)}>{f.path}</span>
            </span>
            <span className={cn("shrink-0 text-[11px]", ink.faint)}>{f.access === "write" ? t("readWrite") : t("readOnly")}</span>
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
  const ink = useChatInk();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition-colors",
        active ? ink.rowActive : ink.rowIdle,
      )}
    >
      <span className={cn("shrink-0", ink.rowIcon)}>{icon}</span>
      {children}
      {active && <CheckIcon className={cn("size-3.5 shrink-0", ink.soft)} />}
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

function Thread({ turns, answeredBy }: { turns: QuickTurn[]; answeredBy: Record<string, RosterBot> }) {
  const t = useNotchText();
  const ink = useChatInk();
  const last = turns.at(-1);
  const ref = useFollow(`${turns.length}:${last?.answer.length}`);
  return (
    <motion.div ref={ref} className={ink.thread} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
              <ThinkingWait />
            ) : null}
            {turn.status === "error" && <Failed text={turn.error} />}
            {turn.status === "stopped" && <p className={cn("text-[11px]", ink.faint)}>{t("stopped")}</p>}
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
  const ink = useChatInk();
  // A picked session shows only what was asked in it here.
  const turns = session ? all.filter((turn) => turn.chatId === session.id) : all;
  const last = turns.at(-1);
  const pages = last?.showcase?.reduce((n, s) => n + s.items.length, 0) ?? 0;
  const ref = useFollow(
    `${turns.length}:${last?.reply?.length}:${last?.steps.length}:${last?.status}:${pages}:${last?.edits?.length}`,
  );
  return (
    <motion.div ref={ref} className={ink.thread} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col gap-4">
        {session && (session.asked || session.answer) && (
          // Where the session left off, so the next question reads in place.
          <div className={cn("flex flex-col gap-1.5 border-b pb-3 opacity-60", ink.border)}>
            <span className={cn("text-[10.5px] font-medium tracking-wide uppercase", ink.softer)}>{t("earlier")}</span>
            {session.asked && <Asked text={session.asked} files={[]} />}
            {session.answer && <p className={cn("line-clamp-4 text-[12.5px] leading-relaxed", ink.soft)}>{session.answer}</p>}
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
  const ink = useChatInk();
  const live = turn.status === "running";
  const writing = live && !!turn.reply;
  // Just finished: the answer may have come whole with the finish; write it out still.
  const fresh = live || (latest && !!turn.endedAt && Date.now() - turn.endedAt < FRESH_MS);
  return (
    <div className="flex flex-col gap-2">
      <Asked text={turn.prompt} files={turn.files} />
      {turn.status === "starting" && <Waiting text={t("checkingFolder")} />}
      {turn.status === "queued" && (
        <p className={cn("flex items-center gap-2 text-[12px]", ink.muted)}>
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
        <p className="flex items-center gap-1.5 text-[11.5px] text-primary">
          <SquareIcon className="size-2.5 fill-current" />
          {t("stopped")}
        </p>
      )}
      {turn.status === "done" && turn.chatId && (turn.changed || latest) && (
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className={cn("flex items-center gap-1", ink.done)}>
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
              className={cn("flex items-center gap-1 rounded-full px-2.5 py-0.5", ink.sessionBadge, "hover:opacity-100")}
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

function trailOf(turn: CoworkTurn, writing: boolean, quietFor: number, t: ReturnType<typeof useNotchText>): TrailRow[] {
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
    // Between steps the model is thinking; a long think says how long, so it doesn't look stuck.
    const seconds = Math.floor(quietFor / 1000);
    if (writing && quietFor < THINKING_AFTER_MS) {
      rows.push({ key: "writing", icon: SparklesIcon, verb: t("writing"), state: "running" });
    } else if (!writing && rows.length === 0 && seconds < SHOW_SECONDS_FROM) {
      rows.push({ key: "starting", icon: SparklesIcon, verb: t("starting"), state: "running" });
    } else {
      const rest = seconds >= SHOW_SECONDS_FROM ? `${seconds}s` : undefined;
      rows.push({ key: "thinking", icon: SparklesIcon, verb: t("thinking"), rest, state: "running" });
    }
  }
  return rows.slice(-4);
}

/** A wait shows its seconds from here on. */
const SHOW_SECONDS_FROM = 3;

/** A trail row's height and the gap under it; the bot steps down by both. */
const TRAIL_ROW = 24;
const TRAIL_GAP = 4;
/** The bot on the step at work, a little bigger than the icons. */
const TRAIL_BOT = 30;

/** What the bot does on the step at work. */
function poseOf(row: TrailRow): BotState {
  if (row.state === "asking") return "question";
  if (row.state === "waiting") return "permission";
  if (row.key === "thinking") return "thinking";
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
  const ink = useChatInk();
  // The trail alone re-checks twice a second, not the answer under it.
  const quietFor = useQuietFor((turn.reply?.length ?? 0) + turn.steps.length);
  const rows = trailOf(turn, writing, quietFor, t);
  let at = rows.length - 1;
  while (at >= 0 && rows[at].state === "done") at--;
  const live = rows[at];
  return (
    <div className="relative flex flex-col" style={{ gap: TRAIL_GAP }}>
      {/* The thread joining the steps. */}
      <span aria-hidden className={cn("absolute top-3 bottom-3 left-[9.5px] w-px", ink.trailLine)} />
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
          transition={FLOW_SPRING}
        >
          <CoworkBot size={TRAIL_BOT} state={poseOf(live)} theme={ink.botTheme} />
        </motion.div>
      )}
    </div>
  );
}

function StepRow({ row, latest, bot }: { row: TrailRow; latest: boolean; bot: boolean }) {
  const ink = useChatInk();
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: done && !latest ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={FLOW}
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
        className={cn("shrink-0 font-medium", done ? ink.stepDone : ink.stepLive)}
        // A question or an approval says so in its color.
        style={row.state === "asking" || row.state === "waiting" ? { color: tint } : undefined}
      >
        {row.verb}
      </span>
      {row.rest && <span className={cn("min-w-0 truncate font-mono text-[11px]", ink.stepRest)}>{row.rest}</span>}
      <span className="ml-auto flex shrink-0 items-center pl-2">
        {done ? (
          <CheckIcon className={cn("size-3", ink.done)} />
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
const TYPE_FRAME_MS = 48;

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
  const ink = useChatInk();
  return (
    <div className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
      {files.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {files.map((file) => (
            <FileThumb key={file.id} file={file} size={40} />
          ))}
        </div>
      )}
      <p className={ink.userBubble}>{text}</p>
    </div>
  );
}

function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  const ink = useChatInk();
  return (
    <MarkdownSurface>
      <MessageResponse className={ink.prose} isAnimating={streaming} animated={false}>
        {text}
      </MessageResponse>
    </MarkdownSurface>
  );
}

/** Not answering yet: the bot at work, in place of a spinner. */
function Waiting({ text }: { text: string }) {
  const ink = useChatInk();
  return (
    <div className={cn("flex items-center gap-2 text-[12px]", ink.muted)}>
      <CoworkBot size={TRAIL_BOT} state="tool" theme={ink.botTheme} className="-my-1 -ml-1" />
      {text}
    </div>
  );
}

/** Waiting on the first words: thinking, and after a few seconds for how long. */
function ThinkingWait() {
  const t = useNotchText();
  const ink = useChatInk();
  const seconds = Math.floor(useQuietFor(0) / 1000);
  return (
    <div role="status" className={cn("flex items-center gap-2 text-[12px]", ink.muted)}>
      <CoworkBot size={TRAIL_BOT} state="thinking" theme={ink.botTheme} className="-my-1 -ml-1" />
      {t("thinking")}
      {seconds >= SHOW_SECONDS_FROM && <span className="tabular-nums opacity-70">{seconds}s</span>}
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

/**
 * Talking to the notch: it covers the composer while listening — a live
 * waveform, how long, and ✕ / ✓ — then says it's writing the words down.
 */
function VoiceBar({
  voice,
  autoSend,
  onDone,
  onCancel,
}: {
  voice: VoiceInput;
  autoSend: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useNotchText();
  const ink = useChatInk();
  const listening = voice.phase === "listening";
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!listening) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [listening]);

  return (
    <motion.div
      className={cn("absolute inset-0 z-10 flex items-center gap-3 px-3", ink.voiceBar)}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={FLOW}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center">
        {listening && (
          <motion.span
            className="absolute inset-0 rounded-full bg-red-500/25"
            animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span className={cn("relative flex size-7 items-center justify-center rounded-full", listening ? "bg-red-500 text-white" : "bg-white/10")}>
          {listening ? <MicIcon className="size-3.5" /> : <Loader2Icon className={cn("size-3.5 animate-spin", ink.muted)} />}
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn("flex items-center gap-2 text-[13px] font-medium", ink.input)}>
          {listening ? t("voiceListening") : t("voiceWriting")}
          {listening && <span className={cn("text-[11px] font-normal tabular-nums", ink.muted)}>{`0:${String(seconds).padStart(2, "0")}`}</span>}
        </span>
        <span className={cn("truncate text-[11px]", ink.muted)}>
          {listening ? (autoSend ? t("voiceHint") : t("voiceHintManual")) : "\u00a0"}
        </span>
      </div>
      <Waveform
        level={listening ? voice.level : undefined}
        bars={14}
        className={cn("h-6 shrink-0 gap-[3px]", listening ? "text-red-400" : ink.muted)}
        barClassName="w-[3px]"
      />
      {listening && (
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            title={t("voiceCancel")}
            aria-label={t("voiceCancel")}
            className={cn("flex size-8 items-center justify-center rounded-full transition-colors", ink.iconBtn)}
          >
            <XIcon className="size-4" />
          </button>
          <motion.button
            type="button"
            onClick={onDone}
            whileTap={{ scale: 0.92 }}
            title={t("voiceDone")}
            aria-label={t("voiceDone")}
            className="flex size-9 items-center justify-center rounded-full bg-white text-black"
          >
            <CheckIcon className="size-4" strokeWidth={2.5} />
          </motion.button>
        </span>
      )}
    </motion.div>
  );
}

/** While a reply is read aloud: what's happening, bars that breathe, and Stop. */
function SpeakingPill() {
  const t = useNotchText();
  const ink = useChatInk();
  const state = useSyncExternalStore(subscribeSpeaker, speakerState);
  const on = state.speaking || state.loading;
  return (
    <AnimatePresence initial={false}>
      {on && (
        <motion.div
          key="speaking"
          className={cn("flex shrink-0 items-center gap-2 self-start rounded-full py-1 pr-1 pl-2.5", ink.quickAsk)}
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.96 }}
          transition={FLOW}
          role="status"
        >
          {state.loading ? <Loader2Icon className="size-3.5 animate-spin" /> : <Volume2Icon className="size-3.5" />}
          <span className="text-[12px]">{state.loading ? t("voicePreparing") : t("voiceSpeaking")}</span>
          {state.speaking && <Waveform bars={5} className="h-3 gap-[2px]" barClassName="w-[2px]" />}
          <button
            type="button"
            onClick={stopSpeaking}
            className={cn("ml-0.5 flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium", ink.chipOn)}
          >
            <SquareIcon className="size-2.5 fill-current" />
            {t("voiceStop")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
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
  const ink = useChatInk();
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn("flex shrink-0 items-center justify-center rounded-full transition-colors", ink.iconBtn, big ? "size-9" : "size-6")}
    >
      {children}
    </button>
  );
}
