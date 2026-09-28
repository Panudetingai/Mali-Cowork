"use client";

import { cn } from "@/lib/utils";
import { ChevronRightIcon, FolderInputIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeEntry } from "./api";
import { FileTypeIcon, FolderTypeIcon } from "./file-icon";
import { RECENT_MS } from "./use-code-workspace";

const AUTO_EXPAND_MS = 600;

type FileNode = { name: string; rel: string; dir: boolean; children: FileNode[] };

function buildTree(entries: CodeEntry[]): FileNode[] {
  const root: FileNode[] = [];
  const dirs = new Map<string, FileNode[]>([["", root]]);
    for (const entry of entries) {
    const slash = entry.rel.lastIndexOf("/");
    const parent = slash < 0 ? "" : entry.rel.slice(0, slash);
    const siblings = dirs.get(parent);
    if (!siblings) continue;
    const node: FileNode = { name: entry.rel.slice(slash + 1), rel: entry.rel, dir: entry.dir, children: [] };
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

type MenuState = { x: number; y: number; node: FileNode } | null;

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
  onRename?: (rel: string, newRel: string) => Promise<void>;
  onDelete?: (rel: string) => Promise<void>;
};

export function FileTree({ root, entries, active, recent, dirty, reviewing, onOpen, onRename, onDelete }: Props) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const [expanded, setExpanded] = useState(() => readExpanded(root));
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [draggingRel, setDraggingRel] = useState<string | null>(null);
  const [dropTargetRel, setDropTargetRel] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const dragStateRef = useRef<{ node: FileNode; startX: number; startY: number; moved: boolean } | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    return () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    };
  }, []);

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

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const doRename = async () => {
    if (!menu || !onRename) return;
    const { node } = menu;
    const parentSlash = node.rel.lastIndexOf("/");
    const parent = parentSlash < 0 ? "" : node.rel.slice(0, parentSlash + 1);
    const newName = window.prompt(`Rename “${node.name}” to:`, node.name);
    if (!newName || newName === node.name) {
      setMenu(null);
      return;
    }
    const clean = newName.replace(/[\\/]/g, "-").trim();
    if (!clean) {
      setMenu(null);
      return;
    }
    const newRel = parent + clean;
    setMenu(null);
    await onRename(node.rel, newRel);
  };

  const doDelete = async () => {
    if (!menu || !onDelete) return;
    const { node } = menu;
    if (!window.confirm(`Delete “${node.name}”?`)) {
      setMenu(null);
      return;
    }
    setMenu(null);
    await onDelete(node.rel);
  };

  const clearDrag = () => {
    dragStateRef.current = null;
    setDraggingRel(null);
    setDropTargetRel(null);
    setGhost(null);
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  const canDropInto = (dragged: string, targetRel: string) => {
    if (!dragged || dragged === targetRel) return false;
    return !targetRel.startsWith(`${dragged}/`);
  };

  const findDropTarget = (x: number, y: number): { rel: string; dir: boolean } | null => {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      const item = el.closest("[data-tree-rel]");
      if (item instanceof HTMLElement) {
        const rel = item.dataset.treeRel;
        const dir = item.dataset.treeDir === "true";
        if (rel) return { rel, dir };
      }
      if (el instanceof HTMLElement && el.dataset.treeRoot === "true") {
        return { rel: "", dir: true };
      }
    }
    return null;
  };

  const startMouseDrag = (e: React.MouseEvent, node: FileNode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStateRef.current = { node, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    const state = dragStateRef.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.moved && Math.sqrt(dx * dx + dy * dy) < 4) return;
    if (!state.moved) {
      state.moved = true;
      setDraggingRel(state.node.rel);
    }
    setGhost({ name: state.node.name, x: e.clientX + 12, y: e.clientY + 12 });
    const target = findDropTarget(e.clientX, e.clientY);
    if (target?.dir && canDropInto(state.node.rel, target.rel)) {
      setDropTargetRel(target.rel);
      if (!expanded.has(target.rel) && !expandTimerRef.current) {
        expandTimerRef.current = setTimeout(() => {
          setExpanded((prev) => {
            if (prev.has(target.rel)) return prev;
            const next = new Set(prev);
            next.add(target.rel);
            try {
              localStorage.setItem(expandedKey(root), JSON.stringify([...next]));
            } catch {}
            return next;
          });
          expandTimerRef.current = null;
        }, AUTO_EXPAND_MS);
      }
    } else {
      setDropTargetRel(null);
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    }
  };

  const onMouseUp = async (e: MouseEvent) => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    const state = dragStateRef.current;
    if (!state?.moved || !onRename) {
      clearDrag();
      return;
    }
    const target = findDropTarget(e.clientX, e.clientY);
    const rel = state.node.rel;
    const name = rel.split("/").pop() ?? rel;
    let newRel: string | null = null;
    if (target?.dir && canDropInto(rel, target.rel)) {
      newRel = target.rel ? `${target.rel}/${name}` : name;
    }
    clearDrag();
    if (newRel && newRel !== rel) await onRename(rel, newRel);
  };

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

  const render = (nodes: FileNode[], depth: number) =>
    nodes.map((node) => {
      const open = expanded.has(node.rel);
      const fresh = node.dir ? recentDirs.has(node.rel) : now - (recent[node.rel] ?? 0) < RECENT_MS;
      return (
        <div key={node.rel}>
          <div
            role="treeitem"
            tabIndex={0}
            aria-selected={active === node.rel}
            data-tree-rel={node.rel}
            data-tree-dir={node.dir ? "true" : "false"}
            onMouseDown={(e) => startMouseDrag(e, node)}
            onClick={() => (node.dir ? toggle(node.rel) : onOpen(node.rel))}
            onContextMenu={(e) => handleContextMenu(e, node)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                node.dir ? toggle(node.rel) : onOpen(node.rel);
              }
            }}
            title={node.rel}
            className={cn(
              "group flex h-7 w-full cursor-grab select-none items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-foreground/80 outline-none transition-all duration-150 hover:bg-muted active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring/50",
              active === node.rel && "bg-muted font-medium text-foreground",
              draggingRel === node.rel && "opacity-40",
              dropTargetRel === node.rel && "bg-primary/10 ring-1 ring-inset ring-primary/30",
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
          </div>
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

  return (
    <div
      data-tree-root="true"
      className={cn(
        "flex select-none flex-col py-1 transition-colors duration-150",
        draggingRel && draggingRel.includes("/") && "bg-primary/[0.02]",
      )}
    >
      {render(tree, 0)}
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <FileTypeIcon name={ghost.name} />
          <span className="max-w-[12rem] truncate">{ghost.name}</span>
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            onClick={doRename}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
          >
            <PencilIcon className="size-4 text-muted-foreground" />
            Rename
          </button>
          <button
            type="button"
            onClick={doDelete}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none hover:bg-destructive/10"
          >
            <Trash2Icon className="size-4" />
            Delete
          </button>
          {menu.node.dir && (
            <button
              type="button"
              onClick={doRename}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            >
              <FolderInputIcon className="size-4 text-muted-foreground" />
              Move / Rename
            </button>
          )}
        </div>
      )}
    </div>
  );
}
