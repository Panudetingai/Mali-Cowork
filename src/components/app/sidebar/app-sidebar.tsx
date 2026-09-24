import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/animate-ui/components/radix/sidebar";
import { SidebarTokenFooter } from "./sidebar-token-footer";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxIndicator } from "@/components/animate-ui/primitives/radix/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteChats, getRuns, sessionMode, useChatRuns, useChatSessions, type ChatSession } from "@/features/chat-history";
import { useProjects, type Project } from "@/features/projects";
import { useInboxAttention } from "@/features/tasks";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquareIcon,
  CodeXmlIcon,
  FilesIcon,
  InboxIcon,
  SwordsIcon,
  FolderKanbanIcon,
  ImagesIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, useLocation, useMatch, useNavigate } from "react-router-dom";
import { ChatHistoryItem } from "./chat-history-item";
import { sidebarItemClass } from "./sidebar-styles";

function NavItem({ title, url, icon: Icon, badge }: { title: string; url: string; icon: LucideIcon; badge?: number }) {
  const { pathname, search } = useLocation();
  const [path, query = ""] = url.split("?");
  const isActive =
    path === "/"
      ? pathname === "/" && new URLSearchParams(search).get("mode") === new URLSearchParams(query).get("mode")
      : pathname.startsWith(path);

  return (
    <SidebarMenuItem>
      <NavLink to={url} title={title} data-active={isActive} className={sidebarItemClass}>
        <Icon strokeWidth={1.75} />
        <span className="truncate group-data-[collapsible=icon]:hidden">{title}</span>
        {!!badge && (
          <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold tabular-nums text-white group-data-[collapsible=icon]:hidden">
            {badge}
          </span>
        )}
      </NavLink>
    </SidebarMenuItem>
  );
}

function matches(session: ChatSession, query: string) {
  if (!query) return true;
  if (session.title.toLowerCase().includes(query)) return true;
  return session.messages.some((m) => m.content.toLowerCase().includes(query));
}

function HistoryGroup({
  label,
  sessions,
  selecting,
  selected,
  onToggleSession,
  onToggleGroup,
}: {
  label: string;
  sessions: ChatSession[];
  selecting: boolean;
  selected: Set<string>;
  onToggleSession: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}) {
  const runs = useChatRuns();
  if (sessions.length === 0) return null;

  const selectableIds = sessions.filter((s) => !runs[s.id]).map((s) => s.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id)) && !allSelected;

  return (
    <SidebarGroup className="py-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="flex h-7 items-center gap-2 text-xs font-normal text-sidebar-foreground/55">
        {selecting && selectableIds.length > 0 && (
          <Checkbox
            checked={someSelected ? "indeterminate" : allSelected}
            onCheckedChange={() => onToggleGroup(selectableIds)}
            aria-label={`Select all ${label.toLowerCase()}`}
          >
            <CheckboxIndicator className="size-3.5" />
          </Checkbox>
        )}
        <span>{label}</span>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {sessions.map((session) => (
            <ChatHistoryItem
              key={session.id}
              session={session}
              running={!!runs[session.id]}
              selecting={selecting}
              selected={selected.has(session.id)}
              onToggleSelected={() => onToggleSession(session.id)}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Most recently used projects; the rest are on the Projects page. */
const SIDEBAR_PROJECTS = 5;

function ProjectsGroup({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null;
  return (
    <SidebarGroup className="py-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="h-7 text-xs font-normal text-sidebar-foreground/55">Projects</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {projects.slice(0, SIDEBAR_PROJECTS).map((project) => (
            <ProjectItem key={project.id} project={project} />
          ))}
          {projects.length > SIDEBAR_PROJECTS && (
            <SidebarMenuItem>
              <NavLink to="/projects" className={sidebarItemClass}>
                <span className="truncate pl-6 text-muted-foreground">All projects ({projects.length})</span>
              </NavLink>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ProjectItem({ project }: { project: Project }) {
  const url = `/projects/${project.id}`;
  const isActive = !!useMatch(url);
  return (
    <SidebarMenuItem>
      <NavLink to={url} title={project.name} data-active={isActive} className={sidebarItemClass}>
        <FolderKanbanIcon strokeWidth={1.75} className="text-muted-foreground" />
        <span className="truncate">{project.name}</span>
      </NavLink>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inboxAttention = useInboxAttention();
  const sessions = useChatSessions();
  const projects = useProjects();
  const runs = useChatRuns();
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recentProjects = useMemo(() => {
    // A project counts as used when it or one of its chats changed.
    const lastUsed = new Map(projects.map((p) => [p.id, p.updatedAt]));
    for (const s of sessions) {
      if (s.projectId && lastUsed.has(s.projectId)) {
        lastUsed.set(s.projectId, Math.max(lastUsed.get(s.projectId) ?? 0, s.updatedAt));
      }
    }
    return [...projects].sort((a, b) => (lastUsed.get(b.id) ?? 0) - (lastUsed.get(a.id) ?? 0));
  }, [projects, sessions]);

  const { pinned, chats, cowork, code } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = sessions
      // Arena contenders live on the Arena page until one is picked, and
      // background tasks in the Inbox (and on the chat they came from).
      .filter((s) => !s.arenaId && !s.inboxTask && !s.taskFrom && matches(s, q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const unpinned = sorted.filter((s) => !s.pinned);
    return {
      pinned: sorted.filter((s) => s.pinned),
      chats: unpinned.filter((s) => sessionMode(s) === "chat"),
      cowork: unpinned.filter((s) => sessionMode(s) === "cowork" && s.view !== "code"),
      code: unpinned.filter((s) => s.view === "code"),
    };
  }, [sessions, query]);

  const visibleSessions = useMemo(() => [...pinned, ...chats, ...cowork, ...code], [pinned, chats, cowork, code]);
  const selectableIds = useMemo(
    () => visibleSessions.filter((s) => !runs[s.id]).map((s) => s.id),
    [visibleSessions, runs],
  );
  // Only chats on screen and not running can be deleted: a selection hidden by
  // the search, or a chat that started running after it was ticked, is left alone.
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

  const toggleGroup = (ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allInGroup = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allInGroup) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(() => {
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const handleDelete = () => {
    // Checked again now: a run may have started while the dialog was open.
    const running = getRuns();
    const ids = deletable.filter((id) => !running[id]);
    // Looked up before deleting, among all chats: the open one may be hidden by the search.
    const active = sessions.find((s) => ids.includes(s.id) && pathname === `/chat/${s.id}`);
    deleteChats(ids);
    setSelected(new Set());
    setConfirmDelete(false);
    // If the open chat was deleted, fall back to a new chat of the same mode.
    if (active) {
      navigate(`/?mode=${active.view ?? sessionMode(active)}`, { replace: true });
    }
  };

  const nothingFound = sessions.length > 0 && pinned.length + chats.length + cowork.length + code.length === 0;

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="top-(--titlebar-height) bottom-0 h-auto max-h-[calc(100svh-var(--titlebar-height))] border-r-0"
      >
        <SidebarHeader className="gap-1 pb-1">
          <SidebarMenu className="gap-0.5">
            <NavItem title="New chat" url="/?mode=chat" icon={SquarePenIcon} />
            <NavItem title="Cowork" url="/?mode=cowork" icon={SparklesIcon} />
            <NavItem title="Code" url="/?mode=code" icon={CodeXmlIcon} />
            <NavItem title="Visual" url="/visual" icon={ImagesIcon} />
            <NavItem title="Inbox" url="/inbox" icon={InboxIcon} badge={inboxAttention} />
            <NavItem title="Arena" url="/arena" icon={SwordsIcon} />
            <NavItem title="Outputs" url="/outputs" icon={FilesIcon} />
            <NavItem title="Projects" url="/projects" icon={FolderKanbanIcon} />
            <NavItem title="Settings" url="/settings" icon={Settings2Icon} />
          </SidebarMenu>
          <div className="relative mt-1 group-data-[collapsible=icon]:hidden">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder="Search chats"
              aria-label="Search chat history"
              className="h-8 rounded-lg border-transparent bg-sidebar-accent/70 pl-8 pr-8 text-[13px] shadow-none focus-visible:bg-background"
            />
            <button
              type="button"
              onClick={() => {
                setSelecting((v) => !v);
                setSelected(new Set());
              }}
              title={selecting ? "Done selecting" : "Select chats"}
              className={cn(
                "absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md",
                selecting
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <CheckSquareIcon className="size-3.5" />
            </button>
          </div>
        </SidebarHeader>

        <SidebarContent className="relative gap-0 pb-3">
          {!query.trim() && <ProjectsGroup projects={recentProjects} />}
          <HistoryGroup
            label="Pinned"
            sessions={pinned}
            selecting={selecting}
            selected={selected}
            onToggleSession={toggleSession}
            onToggleGroup={toggleGroup}
          />
          <HistoryGroup
            label="Chats"
            sessions={chats}
            selecting={selecting}
            selected={selected}
            onToggleSession={toggleSession}
            onToggleGroup={toggleGroup}
          />
          <HistoryGroup
            label="Cowork"
            sessions={cowork}
            selecting={selecting}
            selected={selected}
            onToggleSession={toggleSession}
            onToggleGroup={toggleGroup}
          />
          <HistoryGroup
            label="Code"
            sessions={code}
            selecting={selecting}
            selected={selected}
            onToggleSession={toggleSession}
            onToggleGroup={toggleGroup}
          />

          {sessions.length === 0 && (
            <p className="px-4 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              Your chats will show up here.
            </p>
          )}
          {nothingFound && (
            <p className="px-4 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              No chats match “{query.trim()}”.
            </p>
          )}

          {selecting && selectedCount > 0 && (
            <div className="sticky bottom-2 z-10 mx-2 mt-auto rounded-xl border border-border/60 bg-background p-2 shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all chats">
                    <CheckboxIndicator className="size-3.5" />
                  </Checkbox>
                  <span className="text-xs font-medium">
                    {selectedCount} selected
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-7" onClick={exitSelection} title="Cancel">
                    <XIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SidebarContent>

        <SidebarTokenFooter />
        <SidebarRail />
      </Sidebar>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {selectedCount} {selectedCount === 1 ? "chat" : "chats"}?
            </DialogTitle>
            <DialogDescription>
              The selected chats and their messages will be removed from this device. Agent sessions will also be
              stopped where applicable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
