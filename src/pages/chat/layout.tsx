"use client";

import {
  createChat,
  isTemporaryChatIntent,
  newChatHomeUrl,
  useChatSessions,
} from "@/features/chat-history";
import { CursorLoginDialog } from "@/features/cursor";
import { GitBar, GitPanel, GitProvider } from "@/features/git";
import { ProviderKeyDialog, saveOpencodeSettings, useDefaultCwd } from "@/features/opencode";
import { FirstRunWizard } from "@/features/onboarding";
import { SmartSuggestions } from "@/features/smart-start";
import { getProject, useProjects } from "@/features/projects";
import { carriedConversation, ChatTasksStrip, enqueueTask, TaskChatNote } from "@/features/tasks";
import { folderName, normalizeFolder, requestFolderAccess } from "@/features/workspace";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { turnInputFor, useChat, type SendMessage } from "@/pages/chat/hooks/use-chat";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { startTransition, useRef, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChatComposer } from "./components/chat-composer";
import { ChatMessagePanel } from "./components/chat-message-panel";
import { MoveToCoworkDialog } from "./components/cowork-handoff-ui";
import { requestMoveToCowork } from "./move-to-cowork";
import { ChatModeNav } from "./components/chat-mode-nav";
import ChatTitle from "./components/chat-title";
import { CodeView } from "./components/code-view";
import { AnimationBotMali } from "./components/animation-bot-mali";
import { loadViewMode, saveWorkMode, type ViewMode } from "./components/work-mode-toggle";

const VIEW_ORDER: Record<ViewMode, number> = { chat: 0, cowork: 1, code: 2 };

const viewEase = MALI_EASE;

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
  const initialOpen = params.get("open") ?? undefined;
  const newChatView: ViewMode =
    requested === "cowork" || requested === "chat" || requested === "code" ? requested : loadViewMode();
  // Code runs the Cowork agent; only the page around it differs.
  const newChatMode = newChatView === "code" ? "cowork" : newChatView;
  const defaultCwd = useDefaultCwd();
  useProjects(); // re-render when a project is renamed or deleted

  const project = getProject(params.get("project") ?? undefined);
  const sessions = useChatSessions();
  const sessionPreview = chatId ? sessions.find((s) => s.id === chatId) : undefined;
  const temporaryChat = isTemporaryChatIntent(params, sessionPreview);
  const chat = useChat(
    chatId,
    newChatMode,
    project?.id,
    newChatView === "code" ? "code" : undefined,
    temporaryChat,
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
    editAndResend,
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
  const activeTemporary = isTemporaryChatIntent(params, session);
  const view: ViewMode = session ? (session.view === "code" ? "code" : mode) : newChatView;
  const reduceMotion = useReducedMotion();
  const viewSlide = useRef(0);

  const openNewChatIn = (next: ViewMode) => {
    viewSlide.current = Math.sign(VIEW_ORDER[next] - VIEW_ORDER[view]);
    saveWorkMode(next);
    startTransition(() =>
      navigate(newChatHomeUrl(next, { projectId: project?.id }), { replace: !chatId }),
    );
  };
  // Switching starts a new chat of the other type — except Chat → Cowork in
  // a chat that has started: that one can move over with its conversation.
  const changeMode = (next: ViewMode) => {
    if (next === view) return;
    if (session && view === "chat" && next === "cowork" && session.messages.length > 0 && !isLoading) {
      requestMoveToCowork({ chatId: session.id, fromSwitch: true });
      return;
    }
    openNewChatIn(next);
  };
  const startNewChat = (options?: { cwd?: string }) => {
    if (options?.cwd && mode === "cowork") {
      const path = normalizeFolder(options.cwd);
      const chat = createChat(folderName(path), {
        mode: "cowork",
        view: view === "code" ? "code" : undefined,
        cwd: path,
        projectId: project?.id,
        ephemeral: activeTemporary,
      });
      navigate(`/chat/${chat.id}?mode=${view}`);
      return;
    }
    navigate(newChatHomeUrl(view, { projectId: project?.id, temporary: activeTemporary }));
  };

  const setTemporaryChat = (on: boolean) => {
    if (hasMessages) return;
    navigate(newChatHomeUrl(view, { projectId: project?.id, temporary: on }), { replace: true });
  };

  // Cowork only: the Git panel works on the chat's folder.
  const coworkFolder = mode === "cowork" ? normalizeFolder(session?.cwd || defaultCwd || "") || undefined : undefined;

  // Task Inbox: the prompt runs as its own background task in this folder,
  // and this chat stays free; the strip above the composer tracks it.
  const sendInBackground = async (payload: SendMessage) => {
    if (!coworkFolder || !(await requestFolderAccess(coworkFolder))) return false;
    const input = turnInputFor(payload);
    // The task starts in a new chat: bring this conversation so "the content
    // above" still means something to the agent.
    const earlier = session?.messages.length
      ? carriedConversation(session.messages, session.title, payload.budget.maxTokens)
      : "";
    if (earlier) input.context = (input.context ?? "") + earlier;
    enqueueTask({
      input,
      folder: coworkFolder,
      projectId: project?.id,
      from: session ? { id: session.id, title: session.title } : undefined,
    });
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
      <MoveToCoworkDialog onNewCoworkChat={() => openNewChatIn("cowork")} />
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
            initialOpen={initialOpen}
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
                // Empty: centred while it fits; on a short window it scrolls instead of running under the bars below.
                hasMessages ? "flex min-h-0 flex-col overflow-hidden" : "flex flex-col overflow-x-hidden overflow-y-auto",
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
                    className="my-auto flex w-full flex-col items-center gap-4 py-2 [@media(max-height:720px)]:gap-2"
                  >

                    {/* The bots play around these, never over them. */}
                    <div data-bot-avoid="children" className="flex flex-col items-center gap-4">
                      <ChatTitle mode={mode} project={project} temporary={activeTemporary} />
                    </div>
                    <div data-bot-avoid>
                      <FirstRunWizard />
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={`empty-suggestions-${mode}`}
                        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                        transition={{ duration: 0.2, ease: viewEase }}
                        className="w-full min-w-0 shrink-0 self-stretch px-2"
                        data-bot-avoid="children"
                      >
                        <SmartSuggestions
                          folder={coworkFolder}
                          mode={mode}
                          motionKey={`${mode}-${viewShellKey}`}
                          className="w-full"
                        />
                      </motion.div>
                    </AnimatePresence>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {!hasMessages && <AnimationBotMali key={`bots-${mode}`} />}

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
                  onEdit={(id, text) => void editAndResend(id, text)}
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
              {session?.inboxTask || session?.taskFrom ? (
                <TaskChatNote from={session.taskFrom} />
              ) : (
                mode === "cowork" && <ChatTasksStrip chatId={session?.id} />
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
                temporaryChat={activeTemporary}
                onTemporaryChatChange={setTemporaryChat}
                canChangeTemporary={!hasMessages}
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
