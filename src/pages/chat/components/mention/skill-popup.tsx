"use client";

import { skillSlug, type Skill } from "@/features/instructions";
import { BotIcon, CheckIcon, ListCollapseIcon, PaperclipIcon, ScrollTextIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { PickerRow, PickerShell } from "./picker-shell";

export type SlashItem = { kind: "files" } | { kind: "summary" } | { kind: "bot" } | { kind: "skill"; skill: Skill };

/** "Add files" and "Make a bot" while the query could still mean them, then the matching skills. */
export function slashItems(matches: Skill[], query: string, { canSummarize = false } = {}): SlashItem[] {
  const q = query.toLowerCase();
  const summary =
    canSummarize && (!q || ["summarize", "summary", "compact", "สรุป"].some((word) => word.startsWith(q)));
  const files = !q || "add files".startsWith(q) || "files".startsWith(q);
  const bot = !q || "bot".startsWith(q) || "make a bot".startsWith(q) || "new bot".startsWith(q) || "สร้างบอท".startsWith(q);
  return [
    ...(files ? [{ kind: "files" as const }] : []),
    ...(summary ? [{ kind: "summary" as const }] : []),
    ...(bot ? [{ kind: "bot" as const }] : []),
    ...matches.map((skill) => ({ kind: "skill" as const, skill })),
  ];
}

type Props = {
  items: SlashItem[];
  hasSkills: boolean;
  picked: string[];
  active: number;
  onActiveChange: (index: number) => void;
  onSelect: (item: SlashItem) => void;
};

/** The `/` picker; the composer owns keyboard navigation. */
export function SkillPopup({ items, hasSkills, picked, active, onActiveChange, onSelect }: Props) {
  const current = items[active];
  const detail =
    current?.kind === "skill"
      ? current.skill.description || undefined
      : current?.kind === "summary"
        ? "Summarize everything so far now. The model remembers the summary instead of the full messages; you keep them on screen and can open the summary in the chat."
        : current?.kind === "bot"
          ? "Type what the bot should do and send. Mali writes three bots right here in the chat: open each to see how it works, and save the one you like."
          : undefined;

  return (
    <PickerShell
      label="Use a skill"
      idPrefix="skill-item"
      active={active}
      detail={detail}
      footer={
        !hasSkills ? (
          <>
            No skills yet —{" "}
            <Link to="/settings?tab=skills" className="underline underline-offset-2">
              add one
            </Link>
          </>
        ) : items.every((i) => i.kind !== "skill") ? (
          "No matching skill"
        ) : undefined
      }
    >
      {items.map((item, i) =>
        item.kind === "summary" ? (
          <PickerRow
            key="summary"
            id={`skill-item-${i}`}
            active={i === active}
            onHover={() => onActiveChange(i)}
            onPick={() => onSelect(item)}
            icon={<ListCollapseIcon className="size-4" />}
          >
            <span className="truncate">Summarize the chat</span>
            <span className="ml-1 truncate text-xs text-muted-foreground">— and keep going here</span>
          </PickerRow>
        ) : item.kind === "bot" ? (
          <PickerRow
            key="bot"
            id={`skill-item-${i}`}
            active={i === active}
            onHover={() => onActiveChange(i)}
            onPick={() => onSelect(item)}
            icon={<BotIcon className="size-4" />}
          >
            <span className="truncate">Make a bot</span>
            <span className="ml-1 truncate text-xs text-muted-foreground">— say what it should do</span>
          </PickerRow>
        ) : item.kind === "files" ? (
          <PickerRow
            key="files"
            id={`skill-item-${i}`}
            active={i === active}
            onHover={() => onActiveChange(i)}
            onPick={() => onSelect(item)}
            icon={<PaperclipIcon className="size-4" />}
          >
            Add files
          </PickerRow>
        ) : (
          <PickerRow
            key={item.skill.id}
            id={`skill-item-${i}`}
            active={i === active}
            onHover={() => onActiveChange(i)}
            onPick={() => onSelect(item)}
            icon={<ScrollTextIcon className="size-4" />}
            trailing={picked.includes(skillSlug(item.skill)) && <CheckIcon className="size-4 text-primary" />}
          >
            <span className="truncate">{skillSlug(item.skill)}</span>
          </PickerRow>
        ),
      )}
    </PickerShell>
  );
}
