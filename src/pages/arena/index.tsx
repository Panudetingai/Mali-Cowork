"use client";

/**
 * Agent Arena (Epic D): ask 2–3 models the same thing side by side, then keep
 * the answer you like — it carries on as a normal chat.
 */
import { MessageResponse } from "@/components/ai-elements/message";
import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { Button } from "@/components/ui/button";
import {
  discardArena,
  MAX_CONTENDERS,
  MIN_CONTENDERS,
  pickWinner,
  startArena,
  stopContender,
  useArenaRounds,
  useArenaWins,
  type ArenaContender,
  type ArenaRound,
} from "@/features/arena";
import { useChatRuns, useChatSessions } from "@/features/chat-history";
import { FilesChanged } from "@/features/checkpoints";
import { useDefaultCwd } from "@/features/opencode";
import { folderName, normalizeFolder } from "@/features/workspace";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { useModelCatalog } from "@/pages/chat/hooks/use-model-catalog";
import { findModel, loadSelectedModelId, type AiModel } from "@/pages/chat/models";
import type { ChatMessage } from "@/pages/chat/types";
import { EmptyState, SectionHeader, StatusPill } from "@/pages/settings/ui";
import {
  CheckIcon,
  CrownIcon,
  FolderIcon,
  LoaderIcon,
  MessageSquareIcon,
  PlusIcon,
  SquareIcon,
  SwordsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export default function ArenaPage() {
  const [mode, setMode] = useState<"chat" | "cowork">("chat");
  const defaultCwd = useDefaultCwd();
  const [pickedFolder, setPickedFolder] = useState<string>();
  const folder = normalizeFolder(pickedFolder ?? defaultCwd ?? "") || undefined;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const { catalog, loading } = useModelCatalog(mode);
  const usable = useMemo(() => catalog.filter((m) => !m.issue), [catalog]);
  const rounds = useArenaRounds();
  const wins = useArenaWins();
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  // Start from the Chat page's model plus the next different ones.
  const contenders: AiModel[] = useMemo(() => {
    if (picked.length) return picked.map((id) => findModel(usable, id));
    const first = findModel(usable, loadSelectedModelId(mode));
    const others = usable.filter((m) => m.id !== first.id && m.provider !== first.provider);
    return [first, ...others.slice(0, MIN_CONTENDERS - 1)];
  }, [picked, usable, mode]);

  const setContender = (index: number, model: AiModel) =>
    setPicked(contenders.map((m, i) => (i === index ? model.id : m.id)));
  const removeContender = (index: number) => setPicked(contenders.filter((_, i) => i !== index).map((m) => m.id));
  const addContender = () => {
    const next = usable.find((m) => !contenders.some((c) => c.id === m.id));
    if (next) setPicked([...contenders.map((m) => m.id), next.id]);
  };

  const distinct = new Set(contenders.map((m) => m.id)).size === contenders.length;
  const canStart =
    !!prompt.trim() && contenders.length >= MIN_CONTENDERS && distinct && !starting && (mode === "chat" || !!folder);

  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    setError(undefined);
    try {
      await startArena(prompt.trim(), contenders, mode, folder);
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const switchMode = (next: "chat" | "cowork") => {
    setMode(next);
    setPicked([]);
    setError(undefined);
  };

  const chooseFolder = async () => {
    const chosen = await openDialog({ directory: true, multiple: false, title: "Folder for the Arena" });
    if (typeof chosen === "string") setPickedFolder(chosen);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void start();
    }
  };

  const tally = Object.entries(wins)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, n]) => `${findModel(catalog, id).name} ${n}`);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-6 overflow-y-auto px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Arena"
        description="Give 2–3 models or agents the same task and compare side by side. Keep the best — it continues as a normal chat. In Cowork, each agent works on its own copy of the folder; only the one you keep changes your files."
        actions={tally.length ? <span className="text-xs text-muted-foreground">Wins here: {tally.join(" · ")}</span> : undefined}
      />

      <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-muted/60 p-0.5 text-xs">
            {(["chat", "cowork"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors",
                  mode === m ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "chat" ? "Chat" : "Cowork"}
              </button>
            ))}
          </div>
          {mode === "cowork" && (
            <button
              type="button"
              onClick={() => void chooseFolder()}
              title={folder}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1 text-xs hover:bg-muted/50"
            >
              <FolderIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate">{folder ? folderName(folder) : "Choose a folder"}</span>
            </button>
          )}
          {mode === "cowork" && (
            <span className="text-xs text-muted-foreground">Git repositories only · untracked files aren't copied</span>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={
            mode === "chat"
              ? "Ask something to compare — e.g. “Write a polite reply declining this meeting”"
              : "Give the agents a task — e.g. “Add input validation to the signup form, with tests”"
          }
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {contenders.map((model, i) => (
            <div key={`${i}-${model.id}`} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ModelPicker
                  appearance="field"
                  models={usable}
                  selected={model}
                  loading={loading}
                  onSelect={(next) => setContender(i, next)}
                />
              </div>
              {contenders.length > MIN_CONTENDERS && (
                <Button variant="ghost" size="icon-sm" onClick={() => removeContender(i)} aria-label="Remove model">
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
          {contenders.length < MAX_CONTENDERS && (
            <button
              type="button"
              onClick={addContender}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/80 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              <PlusIcon className="size-4" />
              Add a model
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {distinct
              ? `Costs about ${contenders.length}× one answer — every model answers in full.`
              : "Pick different models to compare."}
          </p>
          <Button onClick={() => void start()} disabled={!canStart} className="gap-1.5">
            {starting ? <LoaderIcon className="size-4 animate-spin" /> : <SwordsIcon className="size-4" />}
            Compare
            <span className="text-xs opacity-70">{isMac ? "⌘⏎" : "Ctrl+Enter"}</span>
          </Button>
        </div>
        {error && (
          <p className="rounded-lg bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-400">{error}</p>
        )}
      </section>

      {rounds.length === 0 ? (
        <EmptyState
          icon={<SwordsIcon />}
          title="No rounds yet"
          description="Type a question above, pick the models, and press Compare. Answers stream side by side."
        />
      ) : (
        rounds.map((round) => <RoundCard key={round.id} round={round} />)
      )}
    </div>
  );
}

function RoundCard({ round }: { round: ArenaRound }) {
  const navigate = useNavigate();
  const sessions = useChatSessions();
  const runs = useChatRuns();
  const [picking, setPicking] = useState<string>();
  const [pickError, setPickError] = useState<string>();
  const decided = !!round.winnerChatId;
  const shown = decided ? round.contenders.filter((c) => c.chatId === round.winnerChatId) : round.contenders;
  const anyRunning = round.contenders.some((c) => runs[c.chatId]);

  const keep = async (chatId: string) => {
    setPicking(chatId);
    setPickError(undefined);
    try {
      const kept = await pickWinner(round.id, chatId);
      if (kept) navigate(`/chat/${kept}`);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(undefined);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="line-clamp-2 text-sm font-medium">{round.prompt}</p>
          {round.mode === "cowork" && round.folder && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={round.folder}>
              <FolderIcon className="size-3.5" />
              {folderName(round.folder)}
              {decided && round.appliedFiles != null && ` · applied ${round.appliedFiles} file${round.appliedFiles === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
        {decided ? (
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Link to={`/chat/${round.winnerChatId}`}>
              <MessageSquareIcon className="size-3.5" />
              Open chat
            </Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          onClick={() => void discardArena(round.id)}
          aria-label={decided ? "Remove from Arena" : "Discard this round"}
          title={decided ? "Remove from Arena (the chat stays)" : "Discard this round and its answers"}
        >
          <Trash2Icon />
        </Button>
      </header>

      <div className={cn("grid grid-cols-1 gap-3", !decided && (shown.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"))}>
        {shown.map((contender) => {
          const chat = sessions.find((s) => s.id === contender.chatId);
          return (
            <ContenderColumn
              key={contender.chatId}
              contender={contender}
              messages={chat?.messages ?? []}
              running={!!runs[contender.chatId]}
              winner={round.winnerChatId === contender.chatId}
              decided={decided}
              picking={picking === contender.chatId}
              onKeep={() => void keep(contender.chatId)}
              othersRunning={anyRunning}
              cowork={round.mode === "cowork"}
            />
          );
        })}
      </div>
      {pickError && (
        <p className="rounded-lg bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-400">{pickError}</p>
      )}
    </article>
  );
}

function ContenderColumn({
  contender,
  messages,
  running,
  winner,
  decided,
  picking,
  othersRunning,
  cowork,
  onKeep,
}: {
  contender: ArenaContender;
  messages: ChatMessage[];
  running: boolean;
  winner: boolean;
  decided: boolean;
  picking: boolean;
  othersRunning: boolean;
  cowork: boolean;
  onKeep: () => void;
}) {
  const turnMessage = [...messages].reverse().find((m) => m.turn);
  const reply = [...messages].reverse().find((m) => m.role === "assistant");
  const error = [...messages].reverse().find((m) => m.role === "error");
  const failed = !running && !!error && !reply?.content;
  const seconds = reply?.durationMs ? `${(reply.durationMs / 1000).toFixed(1)}s` : undefined;
  const cost = reply?.usage?.cost != null ? `$${reply.usage.cost.toFixed(4)}` : undefined;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background",
        winner ? "border-amber-500/50" : "border-border/60",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <ModelSelectorLogo
          provider={contender.provider}
          className="size-4 shrink-0"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{contender.modelName}</span>
        {winner && <CrownIcon className="size-4 text-amber-500" />}
        {running ? (
          <StatusPill tone="pending">Answering</StatusPill>
        ) : failed ? (
          <StatusPill tone="danger">Failed</StatusPill>
        ) : (
          <span className="text-[11px] tabular-nums text-muted-foreground">{[seconds, cost].filter(Boolean).join(" · ")}</span>
        )}
      </div>

      <div className={cn("min-h-24 overflow-y-auto px-3 py-3 text-sm", decided ? "max-h-64" : "max-h-[28rem]")}>
        {reply?.content ? (
          <MarkdownSurface>
            <MessageResponse className="text-sm" isAnimating={running}>
              {reply.content}
            </MessageResponse>
          </MarkdownSurface>
        ) : failed ? (
          <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error?.content}</p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderIcon className="size-3.5 animate-spin" /> Waiting for the first words…
          </p>
        )}
      </div>

      {cowork && !running && turnMessage?.turn && !decided && (
        <div className="border-t border-border/60 px-2 py-2">
          <FilesChanged chatId={contender.chatId} messageId={turnMessage.id} turn={turnMessage.turn} />
        </div>
      )}
      {cowork && !running && !turnMessage?.turn && !failed && !decided && (
        <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">No file changes.</p>
      )}

      {!decided && (
        <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-3 py-2">
          {running && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void stopContender(contender.chatId)}>
              <SquareIcon className="size-3 fill-current" />
              Stop
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={running || failed || picking}
            onClick={onKeep}
            title={othersRunning && !running ? "The others will be stopped and removed" : undefined}
          >
            {picking ? <LoaderIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
            {cowork ? "Apply these changes" : "Keep this answer"}
          </Button>
        </div>
      )}
    </div>
  );
}
