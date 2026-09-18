import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleIcon,
  FileTextIcon,
  GlobeIcon,
  HammerIcon,
  LoaderIcon,
  LockIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import type { ActivityItem } from "../../types";

/** A reply cut at its steps: text, the steps run there, more text, … */
export type ReplySegment =
  | { type: "text"; text: string }
  | { type: "steps"; steps: ActivityItem[]; first: number };

/**
 * Interleave the reply text with the steps at the offsets they started at.
 * Replies saved without offsets show all their steps first, as before.
 */
export function segmentReply(content: string, activities: ActivityItem[] = []): ReplySegment[] {
  const segments: ReplySegment[] = [];
  let pos = 0;
  activities.forEach((step, index) => {
    const at = Math.min(Math.max(step.offset ?? 0, pos), content.length);
    const text = content.slice(pos, at);
    if (text.trim()) segments.push({ type: "text", text });
    pos = at;
    const last = segments.at(-1);
    if (last?.type === "steps") last.steps.push(step);
    else segments.push({ type: "steps", steps: [step], first: index });
  });
  const rest = content.slice(pos);
  if (rest.trim()) segments.push({ type: "text", text: rest });
  return segments;
}

/** `Verb: subject` titles show the subject as code; others stay plain. */
function splitTitle(title: string) {
  const at = title.indexOf(": ");
  if (at <= 0 || at > 24) return { verb: title, subject: undefined };
  return { verb: title.slice(0, at), subject: title.slice(at + 2) };
}

function kindIcon(step: ActivityItem): LucideIcon {
  const verb = splitTitle(step.title).verb.toLowerCase();
  if (/^(run|bash|shell|exec|command)/.test(verb)) return TerminalIcon;
  if (/^(read|list|find|glob)/.test(verb)) return FileTextIcon;
  if (/^(write|edit|patch|update|create)/.test(verb)) return PencilIcon;
  if (/^(search|grep)/.test(verb)) return SearchIcon;
  if (/^(fetch|web)/.test(verb)) return GlobeIcon;
  switch (step.kind) {
    case "permission":
      return LockIcon;
    case "search":
      return SearchIcon;
    case "file":
      return FileTextIcon;
    case "system":
      return SparklesIcon;
    case "step":
      return TerminalIcon;
    default:
      return HammerIcon;
  }
}

function StatusIcon({ step, running }: { step: ActivityItem; running: boolean }) {
  if (running) return <LoaderIcon className="size-3.5 animate-spin text-foreground" />;
  if (/\(failed\)$/.test(step.title)) return <XIcon className="size-3.5 text-red-500" />;
  if (step.done) return <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />;
  return <CircleIcon className="size-2 text-muted-foreground/60" />;
}

function StepRow({ step, running }: { step: ActivityItem; running: boolean }) {
  const { verb, subject } = splitTitle(step.title.replace(/ \(failed\)$/, ""));
  const detail = step.detail?.trim();
  const Icon = kindIcon(step);

  const label = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StatusIcon step={step} running={running} />
      </span>
      <Icon className="size-3.5 shrink-0 opacity-60" />
      <span className={cn("shrink-0 font-medium", running ? "text-foreground" : "text-foreground/80")}>
        {verb}
      </span>
      {subject && (
        <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {subject}
        </code>
      )}
    </>
  );

  if (!detail) {
    return <div className="flex min-w-0 items-center gap-2 py-1 text-xs">{label}</div>;
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-xs hover:bg-muted/50">
        {label}
        <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 mb-2 ml-6 max-h-60 overflow-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
          {detail}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The steps an agent ran between two pieces of its reply. */
export function AgentSteps({ steps, runningIndex }: { steps: ActivityItem[]; runningIndex?: number }) {
  return (
    <div className="not-prose my-2 flex flex-col border-l-2 border-border pl-3">
      {steps.map((step, index) => (
        <StepRow
          key={step.id ?? `${index}-${step.title}`}
          step={step}
          running={index === runningIndex}
        />
      ))}
    </div>
  );
}
