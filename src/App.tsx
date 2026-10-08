import { getInstructions, saveSkill, seedThaiTemplateSkills } from "@/features/instructions";
import { syncMcpServers } from "@/features/mcp";
import { FORCE_ONBOARDING, openOnboarding } from "@/features/onboarding";
import { OnboardingGate } from "@/features/onboarding/onboarding-gate";
import { watchSkills } from "@/features/skills";
import { UpdateDialog } from "@/features/updater/update-dialog";
import { useWeeklyRecapAutoOpen, WeeklyRecapDialog } from "@/features/work-receipt";
import { AppLayout } from "@/layouts/app-layout";
// Registers plugin instructions with every chat; loaded with the app.
import { onOpenTeam, playMainReturn, startNotchRelay, useMainAwake } from "@/features/notch";
import "@/features/plugins";
import { listenForQuickSaves, onOpenChatRequest, onOpenQuickSettings, serveQuickTheme } from "@/features/quick";
import { startTaskQueue } from "@/features/tasks";
import { RemoteBridge } from "@/features/remote";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import BotStudioPage from "./pages/bot-studio";
import ChatLayout from "./pages/chat/layout";
import RecentsPage from "./pages/chats/recents-page";
import ChatBlocksPreviewPage from "./pages/dev/chat-blocks-preview";
import MarkdownPreviewPage from "./pages/dev/markdown-preview";
import NotchPreviewPage from "./pages/dev/notch-preview";
import InboxPage from "./pages/inbox";
import OnboardingPage from "./pages/onboarding";
import OutputsPage from "./pages/outputs";
import PluginsPage from "./pages/plugins";
import ProjectsPage from "./pages/projects";
import ProjectPage from "./pages/projects/project-page";
import SettingsPage from "./pages/settings";
import UsagePage from "./pages/usage";
import VisualPage from "./pages/visual";

function App() {
  useEffect(() => {
    if (FORCE_ONBOARDING) openOnboarding();
  }, []);

  // Keep the skill folders the agent reads in step with the library.
  useEffect(() => watchSkills(), []);

  // Background Cowork tasks (Inbox): recover after a restart and keep the queue moving.
  useEffect(() => startTaskQueue(), []);
  // The notch pill shows the agent's step and approvals while this window is away.
  useEffect(() => startNotchRelay(), []);
  // Coming back from notch mode, the window opens out of the drop.
  useEffect(() => playMainReturn(), []);
  // Thai work templates (quotation, invoice, official letter…) join the skills once.
  useEffect(() => seedThaiTemplateSkills(getInstructions().skills, saveSkill), []);
  // Connectors belong to Mali: hand them to its hub (the `mali` gateway serves
  // them to CLI agents) and take back what older versions wrote into other apps.
  useEffect(() => {
    void syncMcpServers().catch((e) => console.warn("[mcp] startup sync failed", e));
  }, []);


  // Auto-open weekly recap on the first visit each Monday.
  useWeeklyRecapAutoOpen();

  // "Open in Mali" from the Quick bar.
  const navigate = useNavigate();
  useEffect(() => {
    const stop = onOpenChatRequest((chatId) => navigate(`/chat/${encodeURIComponent(chatId)}`));
    return () => void stop.then((unlisten) => unlisten());
  }, [navigate]);

  // Keep Quick bar threads as chats (this window owns history).
  useEffect(() => listenForQuickSaves(), []);
  useEffect(() => onOpenQuickSettings(() => navigate("/settings?tab=notch")), [navigate]);
  // "New bot" in the notch: Settings → Team, with the new-bot form open.
  useEffect(
    () => onOpenTeam(({ create }) => navigate(`/settings?tab=team${create ? "&new=1" : ""}`)),
    [navigate],
  );

  // The Quick bar follows this window's theme.
  const { resolvedTheme } = useTheme();
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;
  const pushTheme = useRef(() => {});
  useEffect(() => {
    const served = serveQuickTheme(() => themeRef.current);
    pushTheme.current = served.push;
    return served.stop;
  }, []);
  useEffect(() => pushTheme.current(), [resolvedTheme]);

  // Started at login in the notch: nothing to draw until the window is opened.
  if (!useMainAwake()) return null;
  return (
    <>
      <Routes>
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route element={<OnboardingGate />}>
          <Route element={<AppLayout />}>
          <Route index element={<ChatLayout />} />
          <Route path="chat/:chatId" element={<ChatLayout />} />
          <Route path="chats" element={<RecentsPage />} />
          <Route path="visual" element={<VisualPage />} />
          <Route path="bots" element={<BotStudioPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="outputs" element={<OutputsPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="settings/*" element={<SettingsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="plugins/:pluginId/:panelId" element={<PluginsPage />} />
          {import.meta.env.DEV ? (
            <>
              <Route path="dev/chat-blocks" element={<ChatBlocksPreviewPage />} />
              <Route path="dev/notch" element={<NotchPreviewPage />} />
              <Route path="dev/markdown" element={<MarkdownPreviewPage />} />
            </>
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
      <WeeklyRecapDialog />
    </>
  );
}

export default function AppWithOnboarding() {
  const awake = useMainAwake();
  return (
    <>
      {awake && <UpdateDialog />}
      {/* <UpdateDialog /> */}
      {/* The phone remote works in notch mode too, so it isn't gated on awake. */}
      <RemoteBridge />
      <App />
    </>
  );
}
