"use client";

import { createChat } from "@/features/chat-history";
import { CursorLoginDialog } from "@/features/cursor";
import { GitBar, GitPanel, GitProvider } from "@/features/git";
import { loadOpencodeSettings, ProviderKeyDialog } from "@/features/opencode";
import { FirstRunWizard } from "@/features/onboarding";
import { getProject, useProjects } from "@/features/projects";
import { folderName, normalizeFolder } from "@/features/workspace";
import { useChat } from "@/pages/chat/hooks/use-chat";
import { startTransition, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChatComposer } from "./components/chat-composer";
import { ChatMessagePanel } from "./components/chat-message-panel";
import ChatTitle from "./components/chat-title";
import { loadWorkMode, saveWorkMode, type WorkMode } from "./components/work-mode-toggle";

export default function ChatLayout() {
  const { chatId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requested = params.get("mode");
  const newChatMode: WorkMode =
    requested === "cowork" || requested === "chat" ? requested : loadWorkMode();
  useProjects(); // re-render when a project is renamed or deleted

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
  } = useChat(chatId, newChatMode, getProject(params.get("project") ?? undefined)?.id);
  const project = getProject(session ? session.projectId : (params.get("project") ?? undefined));
  const projectQuery = project ? `&project=${project.id}` : "";

  // A chat keeps its type; switching starts a new chat of the other type.
  const changeMode = (next: WorkMode) => {
    if (next === mode) return;
    saveWorkMode(next);
    startTransition(() => navigate(`/?mode=${next}${projectQuery}`, { replace: !chatId }));
  };
  const startNewChat = (options?: { cwd?: string }) => {
    if (options?.cwd && mode === "cowork") {
      const path = normalizeFolder(options.cwd);
      const chat = createChat(folderName(path), { mode: "cowork", cwd: path, projectId: project?.id });
      navigate(`/chat/${chat.id}?mode=cowork`);
      return;
    }
    navigate(`/?mode=${mode}${projectQuery}`);
  };

  // Cowork only: the Git panel works on the chat's folder.
  const gitFolder =
    mode === "cowork" ? normalizeFolder(session?.cwd || loadOpencodeSettings().cwd || "") || undefined : undefined;

  // A deleted or unknown chat falls back to a new one.
  if (chatId && !session) return <Navigate to={`/?mode=${newChatMode}`} replace />;

  // Git only appears when the folder is in a repository (see `useGitRepo`).
  const withGit = (children: ReactNode) =>
    gitFolder ? (
      <GitProvider folder={gitFolder} agentRunning={isLoading}>
        {children}
      </GitProvider>
    ) : (
      children
    );

  return withGit(
    <div className="flex h-full min-h-0 w-full min-w-0">
      <div
        className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden items-center gap-4 px-4 py-4 sm:gap-5 sm:py-5 ${hasMessages ? "justify-end" : "justify-center"}`}
      >
        {!hasMessages && <ChatTitle mode={mode} project={project} />}
        {!hasMessages && <FirstRunWizard />}

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
        />

        {gitFolder && <GitBar />}

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
        />

        <ProviderKeyDialog />
        <CursorLoginDialog />
      </div>
      {gitFolder && <GitPanel />}
    </div>,
  );
}
