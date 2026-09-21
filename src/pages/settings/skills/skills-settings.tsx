import { deleteSkill, saveSkill, toggleSkill, useInstructions } from "@/features/instructions";
import { libraryDir } from "@/features/skills";
import { useEffect, useState } from "react";
import { SkillsManager } from "./skills-manager";

/**
 * Settings → Skills.
 *
 * A skill is a short guide the AI follows when a task matches its "Use when".
 * Each one is a folder on disk — its SKILL.md, plus any scripts and reference
 * files it came with — so in Cowork the AI is told what the library holds and
 * opens a skill only when it needs one. Fifty skills then cost a few lines of
 * the prompt instead of fifty guides.
 */
export function SkillsSettings() {
  const { skills } = useInstructions();
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    libraryDir()
      .then((path) => live && setDir(path))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Skills</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reusable how-tos the AI follows when a task matches. Install them from GitHub or write your
          own, and call one directly with <code className="rounded bg-muted px-1 text-xs">/name</code>.
        </p>
      </header>

      <SkillsManager
        skills={skills}
        onSave={saveSkill}
        onToggle={toggleSkill}
        onDelete={deleteSkill}
        discover
        templates
        emptyText="No skills yet. Write one, or browse Discover for skills other people have published."
      />

      <footer className="text-xs leading-relaxed text-muted-foreground">
        In Cowork the AI reads a skill’s folder when a task matches it, so a long skill costs nothing
        until it’s used. In Chat there are no file tools, so skills travel with the prompt and the
        longest ones may be summarised.
        {dir && (
          <>
            {" "}
            Everything lives in <code className="font-mono [overflow-wrap:anywhere]">{dir}</code>.
          </>
        )}
      </footer>
    </div>
  );
}
