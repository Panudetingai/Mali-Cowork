"use client";

import { createChat } from "@/features/chat-history";
import { CursorLoginDialog } from "@/features/cursor";
import { GitBar, GitPanel, GitProvider } from "@/features/git";
import { ProviderKeyDialog, saveOpencodeSettings, useDefaultCwd } from "@/features/opencode";
import { FirstRunWizard } from "@/features/onboarding";
import { getProject, useProjects } from "@/features/projects";
import { enqueueTask } from "@/features/tasks";
import { folderName, normalizeFolder, requestFolderAccess } from "@/features/workspace";
import { cn } from "@/lib/utils";
import { turnInputFor, useChat, type SendMessage } from "@/pages/chat/hooks/use-chat";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChatComposer } from "./components/chat-composer";
import { ChatMessagePanel } from "./components/chat-message-panel";
import { ChatModeNav } from "./components/chat-mode-nav";
import ChatTitle from "./components/chat-title";
import { CodeView } from "./components/code-view";
import { loadViewMode, saveWorkMode, type ViewMode } from "./components/work-mode-toggle";

const VIEW_ORDER: Record<ViewMode, number> = { chat: 0, cowork: 1, code: 2 };

const viewEase = [0.22, 1, 0.36, 1] as const;

function ViewShell({
  viewKey,
  reduceMotion,
  slide,
  className,
  children,
}: {
  viewKey: string;
  reduceMotion: boolean | null;
  slide: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      key={viewKey}
      className={className}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: slide * 20, y: 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: viewEase }}
    >
      {children}
    </motion.div>
  );
}

export default function ChatLayout() {
  const { chatId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requested = params.get("mode");
  const newChatView: ViewMode =
    requested === "cowork" || requested === "chat" || requested === "code" ? requested : loadViewMode();
  // Code runs the Cowork agent; only the page around it differs.
  const newChatMode = newChatView === "code" ? "cowork" : newChatView;
  const defaultCwd = useDefaultCwd();
  useProjects(); // re-render when a project is renamed or deleted

  const chat = useChat(
    chatId,
    newChatMode,
    getProject(params.get("project") ?? undefined)?.id,
    newChatView === "code" ? "code" : undefined,
  );
  const {
    session,
    mode,
    messages,
    isLoading,
    hasMessages,
    containerRef,
    atBottom,
    scrollToBottom,
    promptInputRef,
    sendMessage,
    retryMessage,
    rateMessage,
    summarizeAndContinue,
    permissions,
    replyPermission,
    allowFolder,
    questions,
    answerQuestion,
    canStop,
    stop,
  } = chat;
  const project = getProject(session ? session.projectId : (params.get("project") ?? undefined));
  const projectQuery = project ? `&project=${project.id}` : "";

  const view: ViewMode = session ? (session.view === "code" ? "code" : mode) : newChatView;
  const reduceMotion = useReducedMotion();
  const viewSlide = useRef(0);

  // A chat keeps its type; switching starts a new chat of the other type.
  const changeMode = (next: ViewMode) => {
    if (next === view) return;
    viewSlide.current = Math.sign(VIEW_ORDER[next] - VIEW_ORDER[view]);
    saveWorkMode(next);
    startTransition(() => navigate(`/?mode=${next}${projectQuery}`, { replace: !chatId }));
  };
  const startNewChat = (options?: { cwd?: string }) => {
    if (options?.cwd && mode === "cowork") {
      const path = normalizeFolder(options.cwd);
      const chat = createChat(folderName(path), {
        mode: "cowork",
        view: view === "code" ? "code" : undefined,
        cwd: path,
        projectId: project?.id,
      });
      navigate(`/chat/${chat.id}?mode=${view}`);
      return;
    }
    navigate(`/?mode=${view}${projectQuery}`);
  };

  // Cowork only: the Git panel works on the chat's folder.
  const coworkFolder = mode === "cowork" ? normalizeFolder(session?.cwd || defaultCwd || "") || undefined : undefined;

  // Task Inbox: the prompt runs as its own background task in this folder,
  // and this chat stays free.
  const [queued, setQueued] = useState<string>();
  useEffect(() => {
    if (!queued) return;
    const timer = setTimeout(() => setQueued(undefined), 5000);
    return () => clearTimeout(timer);
  }, [queued]);
  const sendInBackground = async (payload: SendMessage) => {
    if (!coworkFolder || !(await requestFolderAccess(coworkFolder))) return false;
    const task = enqueueTask({ input: turnInputFor(payload), folder: coworkFolder, projectId: project?.id });
    setQueued(task.title);
    return true;
  };
  const gitFolder = coworkFolder;

  // A deleted or unknown chat falls back to a new one.
  if (chatId && !session) return <Navigate to={`/?mode=${newChatView}`} replace />;

  // Git only appears when the folder is in a repository (see `useGitRepo`).
  const withGit = (children: ReactNode) =>
    gitFolder ? (
      <GitProvider folder={gitFolder} agentRunning={isLoading}>
        {children}
      </GitProvider>
    ) : (
      children
    );

  const slide = viewSlide.current;
  const viewShellKey = view === "code" ? "code" : view;

  const dialogs = (
    <>
      <ProviderKeyDialog />
      <CursorLoginDialog />
    </>
  );

  return withGit(
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {view === "code" ? (
        <ViewShell
          viewKey={viewShellKey}
          reduceMotion={reduceMotion}
          slide={slide}
          className="flex h-full min-h-0 w-full flex-col"
        >
          <CodeView
            chat={chat}
            chatId={chatId}
            project={project}
            root={coworkFolder}
            withGit={!!gitFolder}
            onModeChange={changeMode}
            onNewChat={startNewChat}
            onPickDefaultFolder={(path) => saveOpencodeSettings({ cwd: path })}
          />
        </ViewShell>
      ) : (
        <ViewShell
          viewKey={viewShellKey}
          reduceMotion={reduceMotion}
          slide={slide}
          className="flex h-full min-h-0 w-full min-w-0"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pt-6 pb-4 sm:px-6">
            <ChatModeNav mode={view} onModeChange={changeMode} />

            <div
              className={cn(
                "relative mt-5 min-h-0 flex-1",
                hasMessages ? "flex min-h-0 flex-col overflow-hidden" : "flex items-center justify-center overflow-hidden",
              )}
            >
              <AnimatePresence initial={false}>
                {!hasMessages ? (
                  <motion.div
                    key={`empty-${mode}`}
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                    transition={{ duration: 0.2, ease: viewEase }}
                    className="flex flex-col items-center gap-4"
                  >
                    <ChatTitle mode={mode} project={project} />
                    <FirstRunWizard />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Always mounted so scroll/follow keeps a container ref when the first reply arrives. */}
              <ChatMessagePanel
                messages={messages}
                isLoading={isLoading}
                containerRef={containerRef}
                atBottom={atBottom}
                onScrollToBottom={scrollToBottom}
                session={session}
                project={project}
                continuedFrom={session?.continuedFrom}
                onRetry={(id) => void retryMessage(id)}
                onRate={rateMessage}
                className={cn(
                  hasMessages ? "min-h-0 flex-1" : "pointer-events-none absolute inset-0 overflow-hidden opacity-0",
                )}
              />
            </div>

            {gitFolder && (
              <div className="mt-3 shrink-0">
                <GitBar />
              </div>
            )}

            <div className="relative mt-4 shrink-0">
              {queued && (
                <div className="absolute -top-9 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm">
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="truncate text-muted-foreground">
                    Queued in Inbox: <span className="text-foreground">{queued}</span>
                  </span>
                  <Link to="/inbox" className="shrink-0 font-medium text-amber-600 hover:underline dark:text-amber-400">
                    Open Inbox
                  </Link>
                </div>
              )}
              <ChatComposer
                key={`${chatId ?? "new"}:${mode}:${project?.id ?? ""}`}
                mode={mode}
                projectId={project?.id}
                session={session}
                messages={messages}
                isLoading={isLoading}
                canStop={canStop}
                promptInputRef={promptInputRef}
                permissions={permissions}
                questions={questions}
                placeholder={hasMessages ? "Ask a follow-up" : undefined}
                onReplyPermission={replyPermission}
                onAnswerQuestion={answerQuestion}
                onAllowFolder={allowFolder}
                onStop={stop}
                onNewChat={startNewChat}
                onSummarize={summarizeAndContinue}
                onModeChange={changeMode}
                onSubmit={sendMessage}
                onSubmitBackground={sendInBackground}
              />
            </div>
          </div>
          {gitFolder && <GitPanel />}
        </ViewShell>
      )}
      {dialogs}
    </div>,
  );
}
