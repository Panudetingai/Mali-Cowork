import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/animate-ui/primitives/radix/collapsible";
import { TextShimmer } from "@/components/ui/text-shimmer";
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
import { McpToolIcon, mcpToolOf } from "@/features/mcp";
import { useState } from "react";
import type { ActivityItem } from "../../types";
import { StepDetail } from "./step-detail";

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

/**
 * An MCP call reads as its server plus the tool (`Notion` · `search`) rather
 * than the raw wire name (`custom-notion_notion-search`).
 */
function labelOf(title: string) {
  const mcp = mcpToolOf(title);
  if (mcp) return { verb: mcp.serverName, subject: mcp.tool, mcp };
  return { ...splitTitle(title), mcp: undefined };
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

/** Home-directory prefixes read as `~`; the full text stays in the tooltip. */
function tidyPath(text: string) {
  return text.replace(/(?:\/Users|\/home)\/[^/\s"'`]+/g, "~");
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const isFailed = (step: ActivityItem) => /\(failed\)$/.test(step.title);

function StatusIcon({ failed, done, running }: { failed: boolean; done: boolean; running: boolean }) {
  if (running) return <LoaderIcon className="size-3.5 animate-spin text-foreground" />;
  if (failed) return <XIcon className="size-3.5 text-red-500" />;
  if (done) return <CheckIcon className="size-3.5 text-emerald-600/80 dark:text-emerald-400/80" />;
  return <CircleIcon className="size-2 text-muted-foreground/60" />;
}

function StepRow({ step, running }: { step: ActivityItem; running: boolean }) {
  const title = step.title.replace(/ \(failed\)$/, "");
  const { verb, subject, mcp } = labelOf(title);
  const detail = step.detail?.trim();
  const failed = isFailed(step);
  const Icon = kindIcon(step);
  // MCP server names ("Sequential Thinking") need more room than verbs.
  const verbWidth = mcp ? "max-w-32" : "w-12";

  const label = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StatusIcon failed={failed} done={step.done} running={running} />
      </span>
      {mcp ? (
        <McpToolIcon mcp={mcp} className="opacity-80" />
      ) : (
        <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      )}
      {running ? (
        <TextShimmer duration={2} className={cn(verbWidth, "shrink-0 truncate font-normal")}>
          {verb}
        </TextShimmer>
      ) : (
        <span className={cn(verbWidth, "shrink-0 truncate text-muted-foreground")}>{verb}</span>
      )}
      {subject &&
        (running ? (
          <TextShimmer duration={2} className="min-w-0 flex-1 truncate font-mono text-[11px] font-normal">
            {tidyPath(subject)}
          </TextShimmer>
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[11px]",
              failed ? "text-red-600 dark:text-red-400" : "text-foreground/75",
            )}
          >
            {tidyPath(subject)}
          </span>
        ))}
      {step.durationMs != null && (
        <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-muted-foreground/70">
          {formatDuration(step.durationMs)}
        </span>
      )}
    </>
  );

  const row = "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs";
  if (!detail) {
    return (
      <div className={row} title={title}>
        {label}
      </div>
    );
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className={cn(row, "group hover:bg-muted/60")} title={title}>
        {label}
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-data-[state=open]:rotate-90 group-data-[state=open]:opacity-100",
            step.durationMs == null && "ml-auto",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <StepDetail detail={detail} verb={verb} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Longer runs start folded once finished; the header sums them up. */
const FOLD_AFTER = 4;

function summarize(steps: ActivityItem[]) {
  const counts = new Map<string, number>();
  for (const step of steps) {
    // MCP calls collapse to their server, so three Notion tools read "Notion 3".
    const { verb, mcp } = labelOf(step.title.replace(/ \(failed\)$/, ""));
    const key = mcp ? verb : verb.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kinds = [...counts].sort((a, b) => b[1] - a[1]).map(([verb, n]) => `${verb} ${n}`);
  const failed = steps.filter(isFailed).length;
  const totalMs = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  return { kinds, failed, totalMs };
}

/** The steps an agent ran between two pieces of its reply. */
export function AgentSteps({ steps, runningIndex }: { steps: ActivityItem[]; runningIndex?: number }) {
  const [toggled, setToggled] = useState<boolean>();
  const running = runningIndex !== undefined && runningIndex >= 0 && runningIndex < steps.length;

  const rows = steps.map((step, index) => (
    <StepRow key={step.id ?? `${index}-${step.title}`} step={step} running={index === runningIndex} />
  ));

  if (steps.length === 1) {
    return <div className="not-prose my-2 -mx-2">{rows}</div>;
  }

  const open = toggled ?? (running || steps.length <= FOLD_AFTER);
  const { kinds, failed, totalMs } = summarize(steps);

  return (
    <Collapsible
      open={open}
      onOpenChange={setToggled}
      className=""
    >
      <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 py-2 text-left text-xs hover:bg-muted/50">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusIcon failed={failed > 0} done={steps.every((step) => step.done)} running={running} />
        </span>
        {running ? (
          <TextShimmer duration={2} className="shrink-0">
            Running {steps.length} steps
          </TextShimmer>
        ) : (
          <span className="shrink-0 font-medium text-foreground/90">Ran {steps.length} steps</span>
        )}
        <span className="min-w-0 truncate text-muted-foreground">
          {kinds.join(" · ")}
          {failed > 0 && <span className="text-red-500"> · {failed} failed</span>}
        </span>
        {totalMs > 0 && (
          <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-muted-foreground/70">
            {formatDuration(totalMs)}
          </span>
        )}
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition group-data-[state=open]:rotate-90",
            totalMs === 0 && "ml-auto",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col border-t px-1 py-1">{rows}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
