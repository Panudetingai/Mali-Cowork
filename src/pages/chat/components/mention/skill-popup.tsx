"use client";

import { skillSlug, type Skill } from "@/features/instructions";
import { cn } from "@/lib/utils";
import { SparklesIcon } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";

type Props = {
  matches: Skill[];
  hasSkills: boolean;
  active: number;
  onActiveChange: (index: number) => void;
  onSelect: (skill: Skill) => void;
};

/** The `/` picker; the composer owns keyboard navigation. */
export function SkillPopup({ matches, hasSkills, active, onActiveChange, onSelect }: Props) {
  useEffect(() => {
    document.getElementById(`skill-item-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      role="listbox"
      aria-label="Use a skill"
      className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg"
    >
      <p className="border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        {matches.length > 0 ? "Skills — Tab/Enter to use" : hasSkills ? "No matching skill" : "No skills yet"}
      </p>
      {matches.length > 0 ? (
        <ul className="max-h-56 overflow-auto p-1">
          {matches.map((skill, i) => (
            <li key={skill.id}>
              <button
                id={`skill-item-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  // Select before the textarea loses focus.
                  e.preventDefault();
                  onSelect(skill);
                }}
                onMouseEnter={() => onActiveChange(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <SparklesIcon className="size-4 shrink-0 text-violet-500" />
                <span className="shrink-0 font-mono text-[13px]">/{skillSlug(skill)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{skill.description}</span>
                {!skill.enabled && <span className="shrink-0 text-[10px] text-muted-foreground">off</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Create skills in{" "}
          <Link to="/settings?tab=instructions" className="underline underline-offset-2">
            Settings → Instructions
          </Link>
          .
        </p>
      )}
    </div>
  );
}
