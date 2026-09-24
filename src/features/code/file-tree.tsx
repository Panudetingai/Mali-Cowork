"use client";

import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { CodeEntry } from "./api";
import { FileTypeIcon, FolderTypeIcon } from "./file-icon";
import { RECENT_MS } from "./use-code-workspace";

type Node = { name: string; rel: string; dir: boolean; children: Node[] };

function buildTree(entries: CodeEntry[]): Node[] {
  const root: Node[] = [];
  const dirs = new Map<string, Node[]>([["", root]]);
  for (const entry of entries) {
    const slash = entry.rel.lastIndexOf("/");
    const parent = slash < 0 ? "" : entry.rel.slice(0, slash);
    const siblings = dirs.get(parent);
    if (!siblings) continue;
    const node: Node = { name: entry.rel.slice(slash + 1), rel: entry.rel, dir: entry.dir, children: [] };
    siblings.push(node);
    if (entry.dir) dirs.set(entry.rel, node.children);
  }
  return root;
}

const expandedKey = (root: string) => `code_expanded:${root}`;

function readExpanded(root: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(expandedKey(root)) ?? "[]"));
  } catch {
    return new Set();
  }
}

type Props = {
  root: string;
  entries: CodeEntry[];
  active?: string;
  recent: Record<string, number>;
  /** Files with unsaved edits. */
  dirty: Set<string>;
  /** Files of the agent's last turn still waiting for review, by change kind. */
  reviewing?: Map<string, "added" | "modified" | "deleted">;
  onOpen: (rel: string) => void;
};

export function FileTree({ root, entries, active, recent, dirty, reviewing, onOpen }: Props) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const [expanded, setExpanded] = useState(() => readExpanded(root));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setExpanded(readExpanded(root)), [root]);

  // "Just changed" fades on its own.
  const hasRecent = Object.keys(recent).length > 0;
  useEffect(() => {
    setNow(Date.now());
    if (!hasRecent) return;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [hasRecent, recent]);

  // Show the open file, and folders the agent is working in.
  useEffect(() => {
    const wanted = [active, ...Object.keys(recent)].filter(Boolean) as string[];
    setExpanded((prev) => {
      let next: Set<string> | undefined;
      for (const rel of wanted) {
        const parts = rel.split("/");
        for (let i = 1; i < parts.length; i++) {
          const dir = parts.slice(0, i).join("/");
          if (!prev.has(dir)) (next ??= new Set(prev)).add(dir);
        }
      }
      return next ?? prev;
    });
  }, [active, recent]);

  const toggle = (rel: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(rel)) next.add(rel);
      try {
        localStorage.setItem(expandedKey(root), JSON.stringify([...next]));
      } catch {
        // Lasts for this session only.
      }
      return next;
    });

  // Folders holding a just-changed file get a dot too, so it can be found collapsed.
  const recentDirs = useMemo(() => {
    const out = new Set<string>();
    for (const [rel, at] of Object.entries(recent)) {
      if (now - at > RECENT_MS) continue;
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("/"));
    }
    return out;
  }, [recent, now]);

  const render = (nodes: Node[], depth: number) =>
    nodes.map((node) => {
      const open = expanded.has(node.rel);
      const fresh = node.dir ? recentDirs.has(node.rel) : now - (recent[node.rel] ?? 0) < RECENT_MS;
      return (
        <div key={node.rel}>
          <button
            type="button"
            onClick={() => (node.dir ? toggle(node.rel) : onOpen(node.rel))}
            title={node.rel}
            className={cn(
              "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-foreground/80 transition-colors duration-150 hover:bg-muted",
              active === node.rel && "bg-muted font-medium text-foreground",
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            {node.dir ? (
              <>
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                    open && "rotate-90",
                  )}
                />
                <FolderTypeIcon open={open} />
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileTypeIcon name={node.name} />
              </>
            )}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {reviewing?.has(node.rel) && (
              <span
                className={cn(
                  "shrink-0 font-mono text-[10px] font-semibold",
                  reviewing.get(node.rel) === "added" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                )}
                title="Changed by the agent — waiting for review"
              >
                {reviewing.get(node.rel) === "added" ? "A" : reviewing.get(node.rel) === "deleted" ? "D" : "M"}
              </span>
            )}
            {dirty.has(node.rel) && <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" title="Unsaved" />}
            {fresh && (
              <span
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                title="Changed just now"
              />
            )}
          </button>
          <AnimatePresence initial={false}>
            {node.dir && open && (
              <motion.div
                key="children"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                {render(node.children, depth + 1)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });

  return <div className="flex flex-col py-1">{render(tree, 0)}</div>;
}
