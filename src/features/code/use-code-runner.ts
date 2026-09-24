"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { codeApi, type CodeTask } from "./api";
import { parseProblems, type Problem } from "./problems";

/** Lines kept from one run; older ones scroll away. */
const MAX_LINES = 5000;

export type RunLine = { stream: "stdout" | "stderr" | "info"; text: string };

export type CodeRun = {
  id: string;
  task: CodeTask;
  lines: RunLine[];
  startedAt: number;
  /** Set once it ended; `null` code means it was stopped or crashed. */
  exit?: { code: number | null; durationMs: number };
  problems: Problem[];
};

export type RunResult = { ok: boolean; run: CodeRun };

const taskKey = (root: string) => `code_task:${root}`;
const customKey = (root: string) => `code_custom_tasks:${root}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Lasts for this session only.
  }
}

/** Pick the task that tells fastest whether the code is broken. */
function defaultTask(tasks: CodeTask[]) {
  return tasks.find((t) => t.kind === "check") ?? tasks.find((t) => t.kind === "build") ?? tasks[0];
}

/** Build / check / test commands for a project, and the one running now. */
export function useCodeRunner(root: string | undefined) {
  const [tasks, setTasks] = useState<CodeTask[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [run, setRun] = useState<CodeRun>();
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    setRun(undefined);
    if (!root) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    void codeApi
      .detect(root)
      .catch(() => [] as CodeTask[])
      .then((found) => {
        if (cancelled) return;
        const all = [...found, ...readJson<CodeTask[]>(customKey(root), [])];
        setTasks(all);
        const saved = readJson<string | undefined>(taskKey(root), undefined);
        setSelectedId(all.some((t) => t.id === saved) ? saved : defaultTask(all)?.id);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (root) writeJson(taskKey(root), id);
    },
    [root],
  );

  /** Add a command of the user's own, remembered for this project. */
  const addCustom = useCallback(
    (command: string) => {
      if (!root || !command.trim()) return;
      const task: CodeTask = { id: `custom::${command}`, label: command, command, kind: "build", cwd: "" };
      const custom = readJson<CodeTask[]>(customKey(root), []).filter((t) => t.id !== task.id);
      writeJson(customKey(root), [...custom, task]);
      setTasks((prev) => [...prev.filter((t) => t.id !== task.id), task]);
      select(task.id);
    },
    [root, select],
  );

  const selected = tasks.find((t) => t.id === selectedId);

  const start = useCallback(
    async (task: CodeTask | undefined = selected): Promise<RunResult | undefined> => {
      if (!root || !task || (runRef.current && !runRef.current.exit)) return undefined;
      const id = crypto.randomUUID();
      const lines: RunLine[] = [{ stream: "info", text: `$ ${task.command}${task.cwd ? `   (in ${task.cwd})` : ""}` }];
      let current: CodeRun = { id, task, lines, startedAt: Date.now(), problems: [] };
      setRun(current);
      // Output arrives line by line; render at most once a frame.
      let frame = 0;
      const flush = () => {
        frame = 0;
        setRun((prev) => (prev?.id === id ? { ...current, lines: [...current.lines] } : prev));
      };
      const push = (line: RunLine) => {
        current.lines.push(line);
        if (current.lines.length > MAX_LINES) current.lines.splice(1, current.lines.length - MAX_LINES);
        frame ||= requestAnimationFrame(flush);
      };
      let code: number | null = null;
      try {
        code = await codeApi.run(id, root, task.command, task.cwd, (event) => {
          if (event.type === "line") push({ stream: event.stream, text: event.text });
        });
      } catch (error) {
        push({ stream: "stderr", text: String(error) });
      }
      if (frame) cancelAnimationFrame(frame);
      const durationMs = Date.now() - current.startedAt;
      const output = current.lines.filter((l) => l.stream !== "info").map((l) => l.text);
      current = {
        ...current,
        lines: [...current.lines],
        exit: { code, durationMs },
        problems: parseProblems(output),
      };
      setRun((prev) => (prev?.id === id ? current : prev));
      return { ok: code === 0, run: current };
    },
    [root, selected],
  );

  const stop = useCallback(() => {
    const current = runRef.current;
    if (current && !current.exit) void codeApi.kill(current.id);
  }, []);

  // Don't leave a dev server running after leaving the project.
  useEffect(
    () => () => {
      const current = runRef.current;
      if (current && !current.exit) void codeApi.kill(current.id);
    },
    [root],
  );

  return { tasks, selected, select, addCustom, run, start, stop, running: !!run && !run.exit };
}

export type CodeRunner = ReturnType<typeof useCodeRunner>;
