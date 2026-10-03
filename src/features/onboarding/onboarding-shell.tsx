"use client";

import { ThemeProvider } from "@/components/theme-provider";
import type { ReactNode } from "react";

/** Onboarding always renders in light mode on a white canvas (independent of app theme). */
export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider forcedTheme="light" enableSystem={false} disableTransitionOnChange>
      <div className="light onboarding-light h-[100dvh] overflow-hidden bg-white text-neutral-900">{children}</div>
    </ThemeProvider>
  );
}
