import { Textarea } from "@/components/ui/textarea";
import { setCustomInstructions, useInstructions } from "@/features/instructions";
import { WandSparklesIcon } from "lucide-react";
import { useId } from "react";
import { useSearchParams } from "react-router-dom";
import { Field, GroupLabel, SectionHeader, SettingsSection } from "./ui";

export function InstructionsSettings() {
  const { custom, skills } = useInstructions();
  const [, setParams] = useSearchParams();
  const customId = useId();

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Instructions"
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
          Custom instructions apply to everything. A skill applies to one kind of task — a report you
          write every week, the way your team reviews code — and the AI picks it up when the task
          matches.
        </p>
        <button
          type="button"
          onClick={() => setParams({ tab: "skills" }, { replace: true })}
          className="flex items-center gap-2.5 self-start rounded-xl border border-border/70 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
        >
          <WandSparklesIcon className="size-4 text-muted-foreground" />
          <span className="font-medium">
            {skills.length > 0
              ? `Your skills (${skills.length})`
              : "Add your first skill"}
          </span>
          <span className="text-muted-foreground">→</span>
        </button>
      </SettingsSection>
    </div>
  );
}
