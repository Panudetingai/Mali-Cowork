"use client";

import { OnboardingIntro } from "@/features/onboarding/onboarding-intro";
import { OnboardingPageGate } from "@/features/onboarding/onboarding-gate";
import { OnboardingShell } from "@/features/onboarding/onboarding-shell";
import { OnboardingBackdrop } from "@/features/onboarding/onboarding-ui";
import { useWindowDrag, WindowControls } from "@/features/onboarding/window-controls";
import { OnboardingWizard } from "@/features/onboarding/wizard";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { resetMainRootClip } from "@/features/notch/notch-mode";
import { clearNotchSetup } from "@/features/onboarding/notch-setup";
import { useEffect, useState } from "react";

export default function OnboardingPage() {
  const [started, setStarted] = useState(false);
  const drag = useWindowDrag();

  useEffect(
    () => () => {
      resetMainRootClip();
      clearNotchSetup();
    },
    [],
  );

  return (
    <OnboardingPageGate>
      <OnboardingShell>
        <MotionConfig reducedMotion="user">
          <OnboardingBackdrop />
          <div
            data-onboarding-ui
            onMouseDown={drag}
            className="relative z-10 h-[100dvh] w-full select-none overflow-hidden"
          >
            <WindowControls className="fixed right-4 top-4 z-50" />
            <AnimatePresence mode="wait">
              {!started ? (
                <motion.div
                  key="intro"
                  className="flex h-full w-full items-center justify-center overflow-y-auto px-6 py-10"
                  exit={{ opacity: 0, scale: 0.97, filter: "blur(4px)" }}
                  transition={{ duration: 0.35 }}
                >
                  <div className="w-full max-w-2xl">
                    <OnboardingIntro onDone={() => setStarted(true)} />
                  </div>
                </motion.div>
              ) : (
                <motion.div key="wizard" className="h-full w-full">
                  <OnboardingWizard />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </MotionConfig>
      </OnboardingShell>
    </OnboardingPageGate>
  );
}
