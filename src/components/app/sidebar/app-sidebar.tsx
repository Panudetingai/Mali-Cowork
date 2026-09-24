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
import { Input } from "@/components/ui/input";
import { sessionMode, useChatRuns, useChatSessions, type ChatSession } from "@/features/chat-history";
import { useProjects, type Project } from "@/features/projects";
import { useInboxAttention } from "@/features/tasks";
import type { LucideIcon } from "lucide-react";
import {
  CodeXmlIcon,
  FilesIcon,
  InboxIcon,
  FolderKanbanIcon,
  ImagesIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
  SquarePenIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, useLocation, useMatch } from "react-router-dom";
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

function HistoryGroup({ label, sessions }: { label: string; sessions: ChatSession[] }) {
  const runs = useChatRuns();
  if (sessions.length === 0) return null;

  return (
    <SidebarGroup className="py-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="h-7 text-xs font-normal text-sidebar-foreground/55">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {sessions.map((session) => (
            <ChatHistoryItem key={session.id} session={session} running={!!runs[session.id]} />
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
  const inboxAttention = useInboxAttention();
  const sessions = useChatSessions();
  const projects = useProjects();
  const [query, setQuery] = useState("");
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
      .filter((s) => matches(s, q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const unpinned = sorted.filter((s) => !s.pinned);
    return {
      pinned: sorted.filter((s) => s.pinned),
      chats: unpinned.filter((s) => sessionMode(s) === "chat"),
      cowork: unpinned.filter((s) => sessionMode(s) === "cowork" && s.view !== "code"),
      code: unpinned.filter((s) => s.view === "code"),
    };
  }, [sessions, query]);

  const nothingFound = sessions.length > 0 && pinned.length + chats.length + cowork.length + code.length === 0;

  return (
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
            className="h-8 rounded-lg border-transparent bg-sidebar-accent/70 pl-8 text-[13px] shadow-none focus-visible:bg-background"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-3">
        {!query.trim() && <ProjectsGroup projects={recentProjects} />}
        <HistoryGroup label="Pinned" sessions={pinned} />
        <HistoryGroup label="Chats" sessions={chats} />
        <HistoryGroup label="Cowork" sessions={cowork} />
        <HistoryGroup label="Code" sessions={code} />

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
      </SidebarContent>

      <SidebarTokenFooter />
      <SidebarRail />
    </Sidebar>
  );
}
