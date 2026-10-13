/**
 * Dev only (/dev/feedback): the real review popup in every state,
 * without waiting for N launches.
 */
import { FeedbackDialogView } from "@/features/feedback";
import { FEEDBACK_PROMPT_AFTER_LAUNCHES } from "@/features/feedback/feedback-store";
import { SectionHeader, SettingsSection } from "@/pages/settings/ui";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Link } from "react-router-dom";

type Case = "rate" | "high" | "low" | "thanks-high" | "thanks-low";

const CASES: { id: Case; label: string }[] = [
  { id: "rate", label: "Not rated" },
  { id: "high", label: "5 stars" },
  { id: "low", label: "2 stars" },
  { id: "thanks-high", label: "Sent (5 stars)" },
  { id: "thanks-low", label: "Sent (2 stars)" },
];

const INITIAL: Record<Case, { stars: number; sent: boolean }> = {
  rate: { stars: 0, sent: false },
  high: { stars: 5, sent: false },
  low: { stars: 2, sent: false },
  "thanks-high": { stars: 5, sent: true },
  "thanks-low": { stars: 2, sent: true },
};

export default function FeedbackPreviewPage() {
  const [active, setActive] = useState<Case>("rate");
  const [open, setOpen] = useState(true);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  const pick = (id: Case) => {
    setActive(id);
    setStars(INITIAL[id].stars);
    setSent(INITIAL[id].sent);
    setComment(id === "low" || id === "thanks-low" ? "A bit slow to open with many files." : "");
    setOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Review popup (preview)"
        description={
          <>
            The real <code className="rounded bg-muted px-1 font-mono text-[11px]">FeedbackDialogView</code>, shown in the
            bottom-left corner — in the app it appears by itself after {FEEDBACK_PROMPT_AFTER_LAUNCHES} launches.
          </>
        }
        actions={
          <Link
            to="/"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Back to chat
          </Link>
        }
      />

      <SettingsSection className="mt-8">
        <h3 className="text-sm font-medium text-foreground">State</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {CASES.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-sm",
                c.id === active && "bg-foreground text-background",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </SettingsSection>

      <div className="mt-6">
        {!open ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-sm">
            <span className="text-muted-foreground">Closed (Not now, ×, or Escape).</span>
            <button
              onClick={() => setOpen(true)}
              className="rounded-md border px-2 py-1 font-medium hover:bg-muted"
            >
              Show again
            </button>
          </div>
        ) : (
          <FeedbackDialogView
            stars={stars}
            comment={comment}
            sent={sent}
            topics={topics}
            onStars={setStars}
            onComment={setComment}
            onTopics={setTopics}
            onLater={() => setOpen(false)}
            onSend={() => setSent(true)}
            onClose={() => setOpen(false)}
          />
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Submit opens a mail draft to{" "}
        <code className="font-mono">CONTACT_EMAIL</code> in{" "}
        <code className="font-mono">src/features/feedback/feedback-dialog.tsx</code>.
      </p>
    </div>
  );
}
