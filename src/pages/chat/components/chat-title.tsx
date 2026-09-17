import type { WorkMode } from "@/features/opencode";

const COPY: Record<WorkMode, { title: string; subtitle: string }> = {
  chat: {
    title: "Welcome to Mali Cowork AI",
    subtitle: "Ask anything — Chat answers without touching your files.",
  },
  cowork: {
    title: "What should we work on?",
    subtitle: "Cowork reads and changes files in the folders you allow.",
  },
};

export default function ChatTitle({ mode }: { mode: WorkMode }) {
  const { title, subtitle } = COPY[mode];
  return (
    <div className="flex flex-col items-center justify-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
