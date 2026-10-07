import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubItem,
    SidebarRail,
    useSidebar,
} from "@/components/animate-ui/components/radix/sidebar";
import { Checkbox, CheckboxIndicator } from "@/components/animate-ui/primitives/radix/checkbox";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/animate-ui/primitives/radix/collapsible";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
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
import {
    deleteChats,
    getRuns,
    isListedChat,
    newChatHomeUrl,
    pickAndImportSharedChat,
    sessionMode,
    TEMPORARY_CHAT_QUERY,
    useChatRuns,
    useChatSessions,
    type ChatSession,
} from "@/features/chat-history";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "@/features/i18n";
import { usePlugins } from "@/features/plugins";
import { useInboxAttention } from "@/features/tasks";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
    BotIcon,
    ChartColumnIcon,
    CheckSquareIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CodeXmlIcon,
    FilesIcon,
    FolderKanbanIcon,
    GhostIcon,
    ImagesIcon,
    InboxIcon,
    FileUpIcon,
    LayoutGridIcon,
    MoreVerticalIcon,
    PlusIcon,
    PuzzleIcon,
    SearchIcon,
    Settings2Icon,
    SparklesIcon,
    SquarePenIcon,
Trash2Icon,
    XIcon,
  } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ActiveIndicatorList } from "./active-indicator";
import { ChatHistoryItem } from "./chat-history-item";
import { sidebarItemClass } from "./sidebar-styles";
import { SidebarTokenFooter } from "./sidebar-token-footer";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** "⌘1" on a Mac, "Ctrl+1" elsewhere. */
const combo = (key: string) => (MAC ? `⌘${key}` : `Ctrl+${key}`);

/** Where each number key goes, in the order the nav lists them. */
const NAV_SHORTCUTS: Record<string, string> = {
  "1": "/?mode=chat",
  "2": newChatHomeUrl("chat", { temporary: true }),
  "3": "/?mode=cowork",
  "4": "/?mode=code",
  "5": "/visual",
  "6": "/bots",
  ",": "/settings",
};

/** Home (`/`): mode and temporary flag must both match so New chat ≠ Temporary chat. */
function homeNavActive(pathname: string, current: URLSearchParams, itemQuery: string) {
  if (pathname !== "/") return false;
  const item = new URLSearchParams(itemQuery);
  const mode = (p: URLSearchParams) => p.get("mode") ?? "chat";
  if (mode(current) !== mode(item)) return false;
  const temp = (p: URLSearchParams) => p.get(TEMPORARY_CHAT_QUERY) === "1";
  return temp(current) === temp(item);
}

/** A key hint that shows when the row is hovered. */
function Hint({ keys }: { keys: string }) {
  return (
    <kbd className="relative ml-auto hidden shrink-0 font-sans text-[10.5px] tracking-wide text-muted-foreground/70 group-hover/nav:inline group-data-[collapsible=icon]:hidden!">
      {keys}
    </kbd>
  );
}

/** A label that fades out, rather than vanishing, as the sidebar folds. */
const fadeLabel = "relative truncate transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0";

function NavItem({
  title,
  url,
  icon: Icon,
  badge,
  shortcut,
}: {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: number;
  shortcut?: string;
}) {
  const { pathname, search } = useLocation();
  const [path, query = ""] = url.split("?");
  const isActive =
    path === "/"
      ? homeNavActive(pathname, new URLSearchParams(search), query)
      : pathname.startsWith(path);

  return (
    <SidebarMenuItem>
      <NavLink to={url} title={shortcut ? `${title} (${shortcut})` : title} data-active={isActive} className={sidebarItemClass}>
        <Icon strokeWidth={1.75} />
        <span className={fadeLabel}>{title}</span>
        {!!badge && (
          <span className="relative ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold tabular-nums text-white group-hover/nav:hidden group-data-[collapsible=icon]:hidden">
            {badge}
          </span>
        )}
        {shortcut && <Hint keys={shortcut} />}
      </NavLink>
    </SidebarMenuItem>
  );
}

type SubItem = { title: string; url: string; icon: LucideIcon; badge?: number; shortcut?: string };

/** "More": the places that aren't for starting work, folded away. */
function NavItemWithSub({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: SubItem[] }) {
  const { pathname } = useLocation();
  const childActive = items.some((item) => pathname.startsWith(item.url.split("?")[0]));
  const [open, setOpen] = useState(childActive);
  const badge = items.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" data-active={childActive && !open} className={sidebarItemClass}>
            <Icon strokeWidth={1.75} />
            <span className={fadeLabel}>{title}</span>
            {!open && badge > 0 && (
              <span className="relative ml-auto size-2 shrink-0 rounded-full bg-amber-500 group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1" />
            )}
            <ChevronRightIcon
              strokeWidth={1.75}
              className={cn(
                "relative size-4! shrink-0 text-muted-foreground transition-transform duration-200 group-data-[collapsible=icon]:hidden",
                !(!open && badge > 0) && "ml-auto",
                open && "rotate-90",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 gap-0.5 border-sidebar-border/80 py-0.5 pr-0">
            {items.map((item) => {
              const SubIcon = item.icon;
              const active = pathname.startsWith(item.url.split("?")[0]);
              return (
                <SidebarMenuSubItem key={item.title}>
                  <NavLink
                    to={item.url}
                    title={item.shortcut ? `${item.title} (${item.shortcut})` : item.title}
                    data-active={active}
                    className={cn(sidebarItemClass, "h-8")}
                  >
                    <SubIcon strokeWidth={1.75} className="size-4!" />
                    <span className="relative truncate">{item.title}</span>
                    {!!item.badge && (
                      <span className="relative ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-semibold tabular-nums text-white group-hover/nav:hidden">
                        {item.badge}
                      </span>
                    )}
                    {item.shortcut && <Hint keys={item.shortcut} />}
                  </NavLink>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function matches(session: ChatSession, query: string) {
  if (!query) return true;
  if (session.title.toLowerCase().includes(query)) return true;
  return session.messages.some((m) => m.content.toLowerCase().includes(query));
}

type Day = "today" | "yesterday" | "week" | "month" | "older";

/** Which "Today / Yesterday / 7 days…" heading a chat goes under. */
function dayOf(time: number, now = new Date()): Day {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (time >= start) return "today";
  if (time >= start - day) return "yesterday";
  if (time >= start - 7 * day) return "week";
  if (time >= start - 30 * day) return "month";
  return "older";
}

/** Rows shown before "Show N more". */
const FOLDED = { pinned: 4, other: 8 };

function HistoryGroup({
  label,
  sessions,
  selecting,
  selected,
  onToggleSession,
  onToggleGroup,
  limit,
  actions,
}: {
  label: string;
  sessions: ChatSession[];
  selecting: boolean;
  selected: Set<string>;
  onToggleSession: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  /** Rows shown folded; all of them when searching. */
  limit?: number;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const runs = useChatRuns();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  if (sessions.length === 0) return null;

  const selectableIds = sessions.filter((s) => !runs[s.id]).map((s) => s.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id)) && !allSelected;
  // The open chat always shows, even past the fold.
  const cut = limit && !all ? limit : sessions.length;
  const shown = sessions.filter((s, i) => i < cut || pathname === `/chat/${s.id}`);
  const hidden = sessions.length - shown.length;

  return (
    <SidebarGroup className="py-1.5">
      <div className="group/label flex h-7 items-center gap-1 pr-1 pl-1">
        {selecting && selectableIds.length > 0 && (
          <Checkbox
            checked={someSelected ? "indeterminate" : allSelected}
            onCheckedChange={() => onToggleGroup(selectableIds)}
            aria-label={`Select all ${label.toLowerCase()}`}
            className="mr-1"
          >
            <CheckboxIndicator className="size-3.5" />
          </Checkbox>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs font-medium text-sidebar-foreground/55 hover:text-sidebar-foreground"
        >
          <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
          <span className="truncate">{label}</span>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {open && (
        <SidebarGroupContent className="pt-0.5">
          <SidebarMenu className="gap-1">
            {shown.map((session) => (
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
          {(hidden > 0 || all) && limit && sessions.length > limit && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground"
            >
              <ChevronDownIcon className={cn("size-3.5", all && "rotate-180")} />
              {all ? t("showLess") : t("showMore", { count: String(hidden) })}
            </button>
          )}
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

/** A small square button in a group's heading (+, ⋮). */
function GroupAction({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

/**
 * The sidebar's keys: "/" jumps to the search (opening a folded sidebar
 * first), ⌘1–⌘6 to the nav rows in order, ⌘, to Settings.
 */
function useShortcuts(search: RefObject<HTMLInputElement | null>, collapsed: boolean, expand: () => void) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const mod = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (mod && !event.shiftKey && !event.altKey && NAV_SHORTCUTS[event.key]) {
        event.preventDefault();
        navigate(NAV_SHORTCUTS[event.key]);
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      event.preventDefault();
      if (collapsed) {
        expand();
        // After the sidebar has opened and the box is back.
        setTimeout(() => search.current?.focus(), 320);
      } else search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, collapsed, expand, navigate]);
}

/** Parts that leave as the sidebar folds, and come back as it opens. */
function Unfolded({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className={className}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.24, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ opacity: 0, x: -10, transition: { duration: 0.14 } }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppSidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inboxAttention = useInboxAttention();
  const hasPanels = usePlugins().plugins.some((p) => p.enabled && p.panels.length > 0);
  const sessions = useChatSessions();
  const runs = useChatRuns();
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const { state: sidebarState, isMobile, setOpen } = useSidebar();
  const collapsed = sidebarState === "collapsed" && !isMobile;
  useShortcuts(searchRef, collapsed, () => setOpen(true));

  const { pinned, days, visibleSessions } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = sessions
      // Background tasks live in the Inbox (and on the chat they came from).
      .filter((s) => isListedChat(s) && matches(s, q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const now = new Date();
    const days: Record<Day, ChatSession[]> = { today: [], yesterday: [], week: [], month: [], older: [] };
    for (const s of sorted) if (!s.pinned) days[dayOf(s.updatedAt, now)].push(s);
    return { pinned: sorted.filter((s) => s.pinned), days, visibleSessions: sorted };
  }, [sessions, query]);

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
    setConfirmDelete(false);
    exitSelection();
    // If the open chat was deleted, fall back to a new chat of the same mode.
    if (active) {
      navigate(`/?mode=${active.view ?? sessionMode(active)}`, { replace: true });
    }
  };

  const searching = !!query.trim();
  const nothingFound = sessions.length > 0 && visibleSessions.length === 0;
  const dayGroups: { id: Day; label: string }[] = [
    { id: "today", label: t("historyToday") },
    { id: "yesterday", label: t("historyYesterday") },
    { id: "week", label: t("historyWeek") },
    { id: "month", label: t("historyMonth") },
    { id: "older", label: t("historyOlder") },
  ];
  const firstGroup = pinned.length > 0 ? "pinned" : dayGroups.find((g) => days[g.id].length > 0)?.id;

  const importShare = () => {
    void pickAndImportSharedChat()
      .then((chat) => {
        if (!chat) return;
        toast.success(t("recentsImportOk"));
        navigate(`/chat/${chat.id}`);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };

  // "+" and "⋮" ride on the first history heading (Today when nothing is pinned).
  const headActions = (
    <>
      <GroupAction label={t("newChat")} onClick={() => navigate("/?mode=chat")}>
        <PlusIcon />
      </GroupAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("more")}
            className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent"
          >
            <MoreVerticalIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="z-50 w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
          <DropdownMenuItem
            className={menuItemClass}
            onSelect={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
          >
            <CheckSquareIcon className="size-4 text-muted-foreground" />
            {selecting ? t("doneSelecting") : t("selectChats")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
          <DropdownMenuItem className={menuItemClass} onSelect={() => navigate("/chats")}>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
            {t("recentsTitle")}
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItemClass} onSelect={importShare}>
            <FileUpIcon className="size-4 text-muted-foreground" />
            {t("recentsImport")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="top-(--titlebar-height) bottom-0 h-auto max-h-[calc(100svh-var(--titlebar-height))] border-r-0"
      >
        <SidebarHeader className="gap-2.5 px-3 pt-3 pb-1 group-data-[collapsible=icon]:px-2">
          <Unfolded show={!collapsed} className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
              placeholder={t("searchChatsPlaceholder")}
              aria-label={t("searchChats")}
              className="h-9 rounded-lg border-sidebar-border bg-background pr-9 pl-9 text-[13px] shadow-none dark:bg-sidebar-accent/60"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("cancel")}
                className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-md border border-sidebar-border bg-sidebar px-1 font-mono text-[11px] text-muted-foreground">
                /
              </kbd>
            )}
          </Unfolded>

          <ActiveIndicatorList>
          <SidebarMenu className="gap-0.5">
            <NavItem title={t("newChat")} url="/?mode=chat" icon={SquarePenIcon} shortcut={combo("1")} />
            <NavItem title={t("newTemporaryChat")} url={newChatHomeUrl("chat", { temporary: true })} icon={GhostIcon} shortcut={combo("2")} />
            <NavItem title={t("cowork")} url="/?mode=cowork" icon={SparklesIcon} shortcut={combo("3")} />
            <NavItem title={t("code")} url="/?mode=code" icon={CodeXmlIcon} shortcut={combo("4")} />
            <NavItem title={t("visual")} url="/visual" icon={ImagesIcon} shortcut={combo("5")} />
            <NavItem title={t("botStudio")} url="/bots" icon={BotIcon} shortcut={combo("6")} />
            <NavItemWithSub
              title={t("more")}
              icon={LayoutGridIcon}
              items={[
                { title: t("inbox"), url: "/inbox", icon: InboxIcon, badge: inboxAttention },
                { title: t("outputs"), url: "/outputs", icon: FilesIcon },
                { title: t("usage"), url: "/usage", icon: ChartColumnIcon },
                { title: t("projects"), url: "/projects", icon: FolderKanbanIcon },
                // Only once a plugin brings a page to open.
                ...(hasPanels ? [{ title: t("plugins"), url: "/plugins", icon: PuzzleIcon }] : []),
                { title: t("settings"), url: "/settings", icon: Settings2Icon, shortcut: combo(",") },
              ]}
            />
          </SidebarMenu>
          </ActiveIndicatorList>
        </SidebarHeader>

        <SidebarContent className="relative gap-0 px-1 pt-1 pb-3">
          <Unfolded show={!collapsed} className="flex flex-col">
          <ActiveIndicatorList className="flex flex-col">
          {/* {sessions.some(isListedChat) && !collapsed && (
            <NavLink
              to="/chats"
              className="mx-1 mb-1 flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <MessageCircle className="size-3.5 shrink-0 opacity-60" />
              {t("recentsTitle")}
            </NavLink>
          )} */}
          <HistoryGroup
            label={t("pinned")}
            sessions={pinned}
            selecting={selecting}
            selected={selected}
            onToggleSession={toggleSession}
            onToggleGroup={toggleGroup}
            limit={searching ? undefined : FOLDED.pinned}
            actions={firstGroup === "pinned" ? headActions : undefined}
          />
          {dayGroups.map((group) => (
            <HistoryGroup
              key={group.id}
              label={group.label}
              sessions={days[group.id]}
              selecting={selecting}
              selected={selected}
              onToggleSession={toggleSession}
              onToggleGroup={toggleGroup}
              limit={searching ? undefined : FOLDED.other}
              actions={firstGroup === group.id ? headActions : undefined}
            />
          ))}

          {!firstGroup && (
            <div className="flex h-7 items-center justify-between pr-1 pl-2 pt-1.5">
              <span className="text-xs font-medium text-sidebar-foreground/55">{t("chats")}</span>
              <span className="flex items-center gap-0.5">{headActions}</span>
            </div>
          )}
          {sessions.length === 0 && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {t("yourChatsWillShowUpHere")}
            </p>
          )}
          {nothingFound && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {t("noChatsMatch")} “{query.trim()}”.
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
                    {selectedCount} {t("selected")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-7" onClick={exitSelection} title={t("cancel")}>
                    <XIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2Icon className="size-3.5" />
                    {t("delete")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          </ActiveIndicatorList>
          </Unfolded>
        </SidebarContent>

        <SidebarTokenFooter />
        <SidebarRail />
      </Sidebar>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("deleteChatsTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("deleteChatsDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
