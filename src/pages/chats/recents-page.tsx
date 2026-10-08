"use client";

import { Checkbox, CheckboxIndicator } from "@/components/animate-ui/primitives/radix/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  deleteChats,
  getRuns,
  isArchivedChat,
  isListedChat,
  isSharedChat,
  pickAndImportSharedChat,
  sessionMode,
  setChatArchived,
  useChatRuns,
  useChatSessions,
  type ChatSession,
} from "@/features/chat-history";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { CheckSquareIcon, FileUpIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/sonner";

type Tab = "active" | "shared" | "archived";

function formatWhen(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 86_400_000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (diff < 7 * 86_400_000) {
    const days = Math.floor(diff / 86_400_000);
    return days <= 1 ? "Yesterday" : `${days} days ago`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function matches(session: ChatSession, q: string) {
  if (!q) return true;
  const hay = `${session.title} ${session.messages.map((m) => m.content).join(" ")}`.toLowerCase();
  return hay.includes(q);
}

export default function RecentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sessions = useChatSessions();
  const runs = useChatRuns();
  const [tab, setTab] = useState<Tab>("active");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sessions
      .filter((s) => {
        if (tab === "active") return isListedChat(s);
        if (tab === "shared") return isSharedChat(s);
        return isArchivedChat(s);
      })
      .filter((s) => matches(s, q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [sessions, tab, query]);

  const selectableIds = useMemo(
    () => filtered.filter((s) => !runs[s.id]).map((s) => s.id),
    [filtered, runs],
  );
  const deletable = useMemo(() => selectableIds.filter((id) => selected.has(id)), [selectableIds, selected]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedCount = deletable.length;

  const toggleSession = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const handleDelete = () => {
    const running = getRuns();
    const ids = deletable.filter((id) => !running[id]);
    const active = sessions.find((s) => ids.includes(s.id) && pathname === `/chat/${s.id}`);
    deleteChats(ids);
    setConfirmDelete(false);
    exitSelection();
    if (active) navigate(`/?mode=${active.view ?? sessionMode(active)}`, { replace: true });
  };

  const importShare = async () => {
    try {
      const chat = await pickAndImportSharedChat();
      if (!chat) return;
      toast.success(t("recentsImportOk"));
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-10">
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground">{t("recentsTitle")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" className="h-9 rounded-full px-4" onClick={importShare}>
              <FileUpIcon className="size-4" />
              {t("recentsImport")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 rounded-full px-4"
              onClick={() => {
                setSelecting((v) => !v);
                setSelected(new Set());
              }}
            >
              <CheckSquareIcon className="size-4" />
              {selecting ? t("doneSelecting") : t("selectChats")}
            </Button>
            <Button type="button" size="sm" className="h-9 rounded-full px-4" onClick={() => navigate("/?mode=chat")}>
              <PlusIcon className="size-4" />
              {t("recentsNewSession")}
            </Button>
          </div>
        </div>

        <ToggleGroup
          type="single"
          value={tab}
          onValueChange={(v) => v && setTab(v as Tab)}
          className="justify-start gap-1"
        >
          <ToggleGroupItem value="active" className="rounded-full px-4 data-[state=on]:bg-muted">
            {t("recentsActive")}
          </ToggleGroupItem>
          <ToggleGroupItem value="shared" className="rounded-full px-4 data-[state=on]:bg-muted">
            {t("recentsShared")}
          </ToggleGroupItem>
          <ToggleGroupItem value="archived" className="rounded-full px-4 data-[state=on]:bg-muted">
            {t("recentsArchived")}
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="relative max-w-md">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchChatsPlaceholder")}
            className="h-10 rounded-full pl-10"
          />
        </div>
      </header>

      <ul className="divide-y divide-border border-t border-border">
        {filtered.length === 0 && (
          <li className="py-12 text-center text-sm text-muted-foreground">
            {tab === "shared"
              ? t("recentsSharedEmpty")
              : query.trim()
                ? t("noChatsMatch", { query: query.trim() })
                : t("recentsEmpty")}
          </li>
        )}
        {filtered.map((session) => {
          const running = !!runs[session.id];
          const active = pathname === `/chat/${session.id}`;
          const row = (
            <>
              {selecting && !running && (
                <Checkbox
                  checked={selected.has(session.id)}
                  onCheckedChange={() => toggleSession(session.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${session.title}`}
                >
                  <CheckboxIndicator className="size-3.5" />
                </Checkbox>
              )}
              <span className="min-w-0 flex-1 truncate text-[15px]">{session.title}</span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{formatWhen(session.updatedAt)}</span>
            </>
          );
          return (
            <li key={session.id}>
              {selecting && !running ? (
                <button
                  type="button"
                  onClick={() => toggleSession(session.id)}
                  className={cn(
                    "flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-muted/40",
                    selected.has(session.id) && "bg-muted/30",
                  )}
                >
                  {row}
                </button>
              ) : (
                <Link
                  to={`/chat/${session.id}`}
                  className={cn(
                    "flex items-center gap-3 py-4 transition-colors hover:bg-muted/40",
                    active && "bg-muted/25",
                  )}
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {selecting && selectedCount > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border bg-background p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll}>
              <CheckboxIndicator className="size-3.5" />
            </Checkbox>
            <span className="text-sm font-medium">
              {selectedCount} {t("selected")}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {tab === "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const id of deletable) setChatArchived(id, true);
                  exitSelection();
                }}
              >
                {t("recentsArchive")}
              </Button>
            )}
            {tab === "archived" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  for (const id of deletable) setChatArchived(id, false);
                  exitSelection();
                }}
              >
                {t("recentsRestore")}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={exitSelection}>
              <XIcon className="size-4" />
            </Button>
            <Button variant="destructive" size="sm" className="gap-1" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon className="size-4" />
              {t("delete")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteChatsTitle")}</DialogTitle>
            <DialogDescription>{t("deleteChatsDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
