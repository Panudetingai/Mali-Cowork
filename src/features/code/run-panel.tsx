"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  CircleXIcon,
  LoaderIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CodeRun } from "./use-code-runner";
import type { Problem } from "./problems";

type Tab = "output" | "problems";

type Props = {
  run?: CodeRun;
  /** Can the agent be asked to fix things now (no reply running)? */
  canFix: boolean;
  onFix: () => void;
  onOpenProblem: (problem: Problem) => void;
};

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function RunStatus({ run }: { run?: CodeRun }) {
  if (!run) return null;
  if (!run.exit) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        Running…
      </span>
    );
  }
  const ok = run.exit.code === 0;
  const errors = run.problems.filter((p) => p.severity === "error").length;
  return (
    <span className={cn("flex items-center gap-1.5 text-xs", ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
      {ok ? <CheckCircle2Icon className="size-3.5" /> : <CircleXIcon className="size-3.5" />}
      {ok ? "Passed" : run.exit.code == null ? "Stopped" : `Failed${errors ? ` · ${errors} error${errors > 1 ? "s" : ""}` : ""}`}
      <span className="text-muted-foreground">· {formatDuration(run.exit.durationMs)}</span>
    </span>
  );
}

export function RunPanel({ run, canFix, onFix, onOpenProblem }: Props) {
  const [tab, setTab] = useState<Tab>("output");
  const outputRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const problems = run?.problems ?? [];
  const failed = !!run?.exit && run.exit.code !== 0;

  // A failed run with problems opens on them.
  useEffect(() => {
    if (run?.exit) setTab(run.exit.code !== 0 && run.problems.length > 0 ? "problems" : "output");
    else if (run) setTab("output");
  }, [run?.id, !!run?.exit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the output unless the user scrolled up.
  useEffect(() => {
    const el = outputRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [run?.lines.length, tab]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {(["output", "problems"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs",
              tab === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "output" ? <SquareTerminalIcon className="size-3.5" /> : <TriangleAlertIcon className="size-3.5" />}
            {value === "output" ? "Output" : "Problems"}
            {value === "problems" && problems.length > 0 && (
              <span className="rounded bg-destructive/15 px-1 text-[10px] text-destructive">{problems.length}</span>
            )}
          </button>
        ))}
        <div className="ml-2">
          <RunStatus run={run} />
        </div>
        {failed && (
          <Button size="xs" variant="outline" className="ml-auto gap-1.5" disabled={!canFix} onClick={onFix}>
            <WandSparklesIcon className="size-3.5" />
            Fix with AI
          </Button>
        )}
      </div>

      {tab === "output" ? (
        <div
          ref={outputRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 select-text"
        >
          {!run ? (
            <p className="text-muted-foreground">Run a check to build the project and catch errors before you ship.</p>
          ) : (
            run.lines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "break-all whitespace-pre-wrap",
                  line.stream === "info" && "text-muted-foreground",
                  line.stream === "stderr" && "text-amber-700 dark:text-amber-300",
                )}
              >
                {line.text || " "}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {problems.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {run?.exit ? "No problems found in the output." : "Problems from the last run show here."}
            </p>
          ) : (
            problems.map((problem, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onOpenProblem(problem)}
                className="flex w-full items-start gap-2 px-3 py-1 text-left text-xs hover:bg-muted"
              >
                {problem.severity === "error" ? (
                  <CircleXIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : (
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{problem.message}</span>{" "}
                  <span className="font-mono text-muted-foreground">
                    {problem.file}:{problem.line}
                    {problem.column ? `:${problem.column}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
