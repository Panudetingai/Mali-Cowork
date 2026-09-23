"use client";

import { skillSlug, type Skill } from "@/features/instructions";
import { CheckIcon, PaperclipIcon, ScrollTextIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { PickerRow, PickerShell } from "./picker-shell";

export type SlashItem = { kind: "files" } | { kind: "skill"; skill: Skill };

/** "Add files" while the query could still mean it, then the matching skills. */
export function slashItems(matches: Skill[], query: string): SlashItem[] {
  const q = query.toLowerCase();
  const files = !q || "add files".startsWith(q) || "files".startsWith(q);
  return [...(files ? [{ kind: "files" as const }] : []), ...matches.map((skill) => ({ kind: "skill" as const, skill }))];
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
  const detail = current?.kind === "skill" ? current.skill.description || undefined : undefined;

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
        ) : items.every((i) => i.kind === "files") ? (
          "No matching skill"
        ) : undefined
      }
    >
      {items.map((item, i) =>
        item.kind === "files" ? (
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
