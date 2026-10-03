"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AutolinkText } from "@/components/autolink-text";
import { MessageAttachment, MessageImageAttachments, type Attachment } from "@/features/attachments";
import { skillSlug, useInstructions } from "@/features/instructions";
import { McpToolIcon, useInstalledConnectors } from "@/features/mcp";
import { useProjects } from "@/features/projects";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, CopyIcon, CornerDownLeftIcon, PencilIcon, PlugIcon, ScrollTextIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExpandableClamp } from "./expandable-clamp";

type Props = {
  content: string;
  attachments?: Attachment[];
  /** Skills (by slug) picked for this prompt. */
  skills?: string[];
  /** Connector ids picked for this prompt. */
  connectors?: string[];
  /** The chat's project, whose skills join the global ones. */
  projectId?: string;
  /** Send the edited text again as a new message. Undefined: not editable (e.g. while a reply runs). */
  onEdit?: (content: string) => void;
};

export function UserMessage({ content, attachments, skills, connectors, projectId, onEdit }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(content);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A run that starts elsewhere (or a chat switch) closes the editor.
  useEffect(() => {
    if (!onEdit) setIsEditing(false);
  }, [onEdit]);

  useEffect(() => {
    if (!isEditing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);

  const startEdit = () => {
    setEditText(content);
    setIsEditing(true);
  };

  const handleSend = () => {
    const trimmed = editText.trim();
    if (!trimmed || !onEdit) return;
    setIsEditing(false);
    onEdit(trimmed);
  };

  const handleCancel = () => {
    setEditText(content);
    setIsEditing(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Nothing to show; the text is still selectable.
    }
  };

  const images = attachments?.filter((a) => a.kind === "image") ?? [];
  const files = attachments?.filter((a) => a.kind !== "image") ?? [];

  return (
    <Message from="user" className="group/user py-3">
      {(images.length > 0 || files.length > 0) && (
        <div className="flex max-w-[min(85%,100%)] flex-col items-end gap-2 self-end">
          <MessageImageAttachments attachments={images} />
          {files.map((attachment) => (
            <MessageAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      <MessageContent
        className={cn(
          "relative max-w-[min(85%,100%)] rounded-2xl rounded-tr-sm bg-neutral-900/[0.07] px-5 py-3 text-neutral-900 dark:bg-primary/20 dark:text-white",
          "wrap-break-word",
          isEditing && "w-full bg-card! px-3 py-2.5 ring-1 ring-primary/40",
        )}
      >
        {isEditing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                // Thai input methods compose with Enter; only a finished line sends.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancel();
                }
              }}
              className="max-h-64 min-h-16 resize-none border-0 bg-transparent p-1 text-[15px] text-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
              rows={3}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                Sends as a new message — the replies below it are replaced.
              </span>
              <Button type="button" size="xs" variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="button" size="xs" onClick={handleSend} disabled={!editText.trim()} className="gap-1">
                Send
                <CornerDownLeftIcon className="size-3" />
              </Button>
            </div>
          </div>
        ) : (
          <ExpandableClamp
            maxHeightClass="max-h-48"
            className="[&_button]:text-foreground/80 [&_button:hover]:text-foreground dark:text-white"
          >
            <p className="whitespace-pre-wrap">
              <AutolinkText text={content} linkClassName="text-foreground/90" />
            </p>
          </ExpandableClamp>
        )}
      </MessageContent>

      {!isEditing && <PickedTools skills={skills} connectors={connectors} projectId={projectId} />}

      {!isEditing && (
        <div className="-mt-1 flex items-center justify-end gap-0.5 self-end opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
          <IconAction label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          </IconAction>
          {onEdit && (
            <IconAction label="Edit and send again" onClick={startEdit}>
              <PencilIcon className="size-3.5" />
            </IconAction>
          )}
        </div>
      )}
    </Message>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** Shown before the rest fold into "+N". */
const MAX_PICKS = 3;

type PickChip = { key: string; label: string; title: string; icon: ReactNode; muted?: boolean };

/** The skills and connectors picked for a prompt, as chips under it. */
function PickedTools({
  skills = [],
  connectors = [],
  projectId,
}: Pick<Props, "skills" | "connectors" | "projectId">) {
  const { skills: globalSkills } = useInstructions();
  const projects = useProjects();
  const installed = useInstalledConnectors();
  const [expanded, setExpanded] = useState(false);

  const picks = useMemo<PickChip[]>(() => {
    const projectSkills = projects.find((p) => p.id === projectId)?.skills ?? [];
    const all = [...projectSkills, ...globalSkills];
    const skillPicks = skills.map((slug): PickChip => {
      const skill = all.find((k) => skillSlug(k) === slug);
      return {
        key: `skill-${slug}`,
        label: skill?.name ?? slug,
        title: skill?.description ? `Skill · ${skill.description}` : "Skill",
        icon: <ScrollTextIcon className="size-3 shrink-0 text-violet-500" />,
        muted: !skill,
      };
    });
    const connectorPicks = connectors.map((id): PickChip => {
      const connector = installed.find((c) => c.id === id);
      return {
        key: `mcp-${id}`,
        label: connector?.name ?? id,
        title: connector ? `Connector · ${connector.name}` : "Connector (no longer installed)",
        icon: connector ? (
          <McpToolIcon mcp={connector.ref} size={12} />
        ) : (
          <PlugIcon className="size-3 shrink-0 text-muted-foreground" />
        ),
        muted: !connector,
      };
    });
    return [...skillPicks, ...connectorPicks];
  }, [skills, connectors, projectId, projects, globalSkills, installed]);

  if (picks.length === 0) return null;
  const shown = expanded ? picks : picks.slice(0, MAX_PICKS);
  const rest = picks.slice(MAX_PICKS);

  return (
    <div className="flex max-w-[min(85%,100%)] flex-wrap items-center justify-end gap-1 self-end">
      <AnimatePresence initial={false}>
        {shown.map((pick) => (
          <motion.span
            key={pick.key}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            title={pick.title}
            className={cn(
              "inline-flex h-6 max-w-44 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] font-medium text-foreground/80",
              pick.muted && "opacity-60",
            )}
          >
            {pick.icon}
            <span className="truncate">{pick.label}</span>
          </motion.span>
        ))}
      </AnimatePresence>
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? "Show fewer" : rest.map((p) => p.label).join(", ")}
          className="inline-flex h-6 items-center gap-0.5 rounded-full border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
        >
          {expanded ? (
            <XIcon className="size-3" />
          ) : (
            <span className="tabular-nums">+{rest.length}</span>
          )}
        </button>
      )}
    </div>
  );
}
