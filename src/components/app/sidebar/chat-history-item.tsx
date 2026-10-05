import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { SidebarMenuItem } from "@/components/animate-ui/components/radix/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Checkbox,
  CheckboxIndicator,
} from "@/components/animate-ui/primitives/radix/checkbox";
import {
  deleteChat,
  moveChatToProject,
  renameChat,
  sessionMode,
  togglePinChat,
  type ChatSession,
} from "@/features/chat-history";
import { useProjects } from "@/features/projects";
import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  FolderInputIcon,
  FolderKanbanIcon,
  FolderMinusIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, useMatch, useNavigate } from "react-router-dom";
import { activeBackdropClass, chatRowClass } from "./sidebar-styles";

const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

/** Only what needs a glance: still working, or it failed. */
function StatusMark({ session, running }: { session: ChatSession; running: boolean }) {
  if (running) return <LoaderCircleIcon strokeWidth={2} className="relative size-3.5 shrink-0 animate-spin text-sky-500" />;
  const last = session.messages[session.messages.length - 1];
  if (last?.role === "error") return <span className="relative size-1.5 shrink-0 rounded-full bg-red-500" title="Failed" />;
  return null;
}

export function ChatHistoryItem({
  session,
  running,
  selecting = false,
  selected = false,
  onToggleSelected,
}: {
  session: ChatSession;
  running: boolean;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}) {
  const navigate = useNavigate();
  const url = `/chat/${session.id}`;
  const isActive = !!useMatch(url);
  const selectable = selecting && !running;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const projects = useProjects();

  useEffect(() => {
    if (!renaming) return;
    // Wait for the options menu to close before taking focus.
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(id);
  }, [renaming]);

  const commitRename = () => {
    renameChat(session.id, draft);
    setRenaming(false);
  };

  const handleDelete = () => {
    deleteChat(session.id);
    setConfirmDelete(false);
    if (isActive) navigate(`/?mode=${session.view ?? sessionMode(session)}`, { replace: true });
  };

  return (
    <SidebarMenuItem className="group/chat relative">
      {renaming ? (
        <div data-active className={chatRowClass}>
          <span className={activeBackdropClass} />
          <input
            ref={inputRef}
            value={draft}
            aria-label="Chat title"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(false);
            }}
            className="relative min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>
      ) : selectable ? (
        // The checkbox is the control (focusable, labelled); clicking the rest
        // of the row is a mouse shortcut for it. A button here would nest one
        // button inside another.
        <div
          onClick={onToggleSelected}
          title={session.title}
          className={cn(
            chatRowClass,
            "cursor-pointer pr-8 text-left",
            selected && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelected}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${session.title}`}
          >
            <CheckboxIndicator className="size-3.5" />
          </Checkbox>
          <span className="truncate">{session.title}</span>
        </div>
      ) : (
        <NavLink
          to={url}
          title={session.title}
          data-active={isActive}
          className={cn(chatRowClass, "pr-8")}
        >
          <span className="relative min-w-0 flex-1 truncate">{session.title}</span>
          <StatusMark session={session} running={running} />
        </NavLink>
      )}

      {!renaming && !selecting && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${session.title}`}
              className={cn(
                "absolute top-1/2 right-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground",
                "opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100",
                "group-hover/chat:opacity-100 data-[state=open]:opacity-100",
              )}
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            sideOffset={6}
            // Keep focus in the rename field instead of returning it to the trigger.
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="z-50 w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            <DropdownMenuItem className={menuItemClass} onSelect={() => togglePinChat(session.id)}>
              {session.pinned ? (
                <PinOffIcon className="size-4 text-muted-foreground" />
              ) : (
                <PinIcon className="size-4 text-muted-foreground" />
              )}
              {session.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItemClass}
              onSelect={() => {
                setDraft(session.title);
                setRenaming(true);
              }}
            >
              <PencilIcon className="size-4 text-muted-foreground" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={cn(menuItemClass, "data-[state=open]:bg-accent")}>
                <FolderInputIcon className="size-4 text-muted-foreground" />
                Move to project
                <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={6}
                className="z-50 max-h-72 w-52 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                {projects.length === 0 && (
                  <DropdownMenuItem className={menuItemClass} onSelect={() => navigate("/projects")}>
                    <FolderKanbanIcon className="size-4 text-muted-foreground" />
                    Create a project…
                  </DropdownMenuItem>
                )}
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    className={menuItemClass}
                    disabled={project.id === session.projectId}
                    onSelect={() => moveChatToProject(session.id, project.id)}
                  >
                    <FolderKanbanIcon className="size-4 text-muted-foreground" />
                    <span className="truncate">{project.name}</span>
                    {project.id === session.projectId && (
                      <CircleCheckIcon className="ml-auto size-3.5 text-muted-foreground" />
                    )}
                  </DropdownMenuItem>
                ))}
                {session.projectId && (
                  <>
                    <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                    <DropdownMenuItem
                      className={menuItemClass}
                      onSelect={() => moveChatToProject(session.id, undefined)}
                    >
                      <FolderMinusIcon className="size-4 text-muted-foreground" />
                      Remove from project
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
            <DropdownMenuItem
              className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive")}
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2Icon className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              “{session.title}” and its messages will be removed from this device
              {sessionMode(session) === "cowork" || session.opencodeSessionId
                ? ", along with its OpenCode session. Files the agent changed stay as they are."
                : "."}
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
    </SidebarMenuItem>
  );
}
