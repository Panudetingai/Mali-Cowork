import { Textarea } from "@/components/ui/textarea";
import {
  deleteSkill,
  saveSkill,
  setCustomInstructions,
  toggleSkill,
  useInstructions,
} from "@/features/instructions";
import { useId } from "react";
import { SkillsManager } from "./skills/skills-manager";
import { Field, GroupLabel, SectionHeader, SettingsSection } from "./ui";

export function InstructionsSettings() {
  const { custom, skills } = useInstructions();
  const customId = useId();

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Instructions & skills"
        description="Teach the AI how you like to work. Applies to every model and both modes."
      />

      <SettingsSection>
        <GroupLabel>Custom instructions</GroupLabel>
        <Field
          label="Always keep in mind"
          htmlFor={customId}
          hint="About you, your work and how you want answers. Saved automatically."
        >
          <Textarea
            id={customId}
            value={custom}
            onChange={(event) => setCustomInstructions(event.target.value)}
            placeholder={"e.g. I'm a product designer. Keep answers short, use bullet points,\nand explain technical terms simply."}
            className="min-h-32 resize-y rounded-xl text-sm leading-relaxed"
          />
        </Field>
      </SettingsSection>

      <SettingsSection>
        <GroupLabel>Skills</GroupLabel>
        <p className="text-sm text-muted-foreground">
          A skill is a reusable how-to. The AI follows it when a task matches its “Use when”, or when you call it
          with <code className="rounded bg-muted px-1 text-xs">/name</code>. Import skills from GitHub, a link or a
          shared folder, and export yours as <code className="rounded bg-muted px-1 text-xs">SKILL.md</code> to
          share with your team.
        </p>
        <SkillsManager
          skills={skills}
          onSave={saveSkill}
          onToggle={toggleSkill}
          onDelete={deleteSkill}
          templates
        />
      </SettingsSection>
    </div>
  );
}
