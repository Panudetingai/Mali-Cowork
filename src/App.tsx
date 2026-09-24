import { UpdateDialog } from "@/features/updater/update-dialog";
import { AppLayout } from "@/layouts/app-layout";
import { OnboardingDialog, openOnboarding, isOnboardingDone, FORCE_ONBOARDING } from "@/features/onboarding";
import { useWeeklyRecapAutoOpen, WeeklyRecapDialog } from "@/features/work-receipt";
import { watchSkills } from "@/features/skills";
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ChatLayout from "./pages/chat/layout";
import OutputsPage from "./pages/outputs";
import ProjectsPage from "./pages/projects";
import ProjectPage from "./pages/projects/project-page";
import SettingsPage from "./pages/settings";
import VisualPage from "./pages/visual";
import ChatBlocksPreviewPage from "./pages/dev/chat-blocks-preview";

function App() {
  useEffect(() => {
    if (!isOnboardingDone() || FORCE_ONBOARDING) openOnboarding();
  }, []);

  // Keep the skill folders the agent reads in step with the library.
  useEffect(() => watchSkills(), []);

  // Auto-open weekly recap on the first visit each Monday.
  useWeeklyRecapAutoOpen();

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<ChatLayout />} />
          <Route path="chat/:chatId" element={<ChatLayout />} />
          <Route path="visual" element={<VisualPage />} />
          <Route path="outputs" element={<OutputsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {import.meta.env.DEV ? (
            <Route path="dev/chat-blocks" element={<ChatBlocksPreviewPage />} />
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <WeeklyRecapDialog />
    </>
  );
}

export default function AppWithOnboarding() {
  return (
    <>
      <OnboardingDialog />
      <UpdateDialog />
      <App />
    </>
  );
}
