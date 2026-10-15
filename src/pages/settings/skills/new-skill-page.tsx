import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveSkill, type SkillDraft } from "@/features/instructions";
import { openSkillEditor, SkillsAccessError } from "@/features/skills";
import { cn } from "@/lib/utils";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Field, PageHeader, SettingsGroup } from "../ui";
import { EMPTY_SKILL } from "./skill-dialog";

/**
 * Settings → Skills → New. A page of its own rather than a dialog: a skill is
 * a guide the AI reads in full, so it needs room, and Back returns to the
 * library the same way as Discover does.
 */
export function NewSkillPage({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<SkillDraft>(EMPTY_SKILL);
  const [saving, setSaving] = useState(false);
  const ids = { name: useId(), description: useId(), instructions: useId() };

  const name = form.name.trim();
  const valid = Boolean(name && form.instructions.trim());
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const lineCount = useMemo(() => (form.instructions ? form.instructions.split(/\r?\n/).length : 0), [form.instructions]);

  // Saving writes the skill's folder and opens it in the code editor, as before.
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await openSkillEditor(navigate, { ...form, name, description: form.description.trim() }, saveSkill);
    } catch (error) {
      setSaving(false);
      if (error instanceof SkillsAccessError) {
        toast.error("Cowork can’t write to the skills folder", { description: error.message });
      } else {
        toast.error("Something went wrong", { description: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader
        back={{ label: "Skills", onClick: onBack }}
        title="New skill"
        description="A short guide for the AI: when it applies, then the steps to follow."
      />

      <SettingsGroup title="Basics" description="What to call it, and when the AI should reach for it.">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field
            label="Name"
            htmlFor={ids.name}
            hint={slug ? (
              <>
                Call it in chat with <code className="rounded bg-muted px-1 font-mono text-[11px]">/{slug}</code>
              </>
            ) : (
              "A short name, like weekly-report."
            )}
          >
            <Input
              id={ids.name}
              value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              placeholder="weekly-report"
              className="h-10 rounded-lg bg-background"
              autoFocus
            />
          </Field>
          <Field label="Use when" htmlFor={ids.description} optional hint="The AI reads this to decide when to use it.">
            <Input
              id={ids.description}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              placeholder="The user asks for a weekly status report"
              className="h-10 rounded-lg bg-background"
            />
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Instructions"
        description="Write it like a guide for a new teammate: the steps, the format, and an example or two."
        actions={
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {lineCount > 0 ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : "Markdown supported"}
          </span>
        }
        footer="Headings, lists and tables help the model follow longer workflows."
      >
        <Textarea
          id={ids.instructions}
          value={form.instructions}
          onChange={(event) => setForm((f) => ({ ...f, instructions: event.target.value }))}
          placeholder={"# What to do\n\n1. Ask for missing details\n2. Use this format…\n\n## Example\n…"}
          spellCheck={false}
          className="min-h-[340px] rounded-xl bg-background px-4 py-3 font-mono text-[13px] leading-relaxed"
        />
      </SettingsGroup>

      <div
        className={cn(
          "sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-border/60",
          "bg-background/95 px-1 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        )}
      >
        <p className={cn("text-[13px]", valid ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
          {valid ? "Ready. Saving opens the skill’s folder in the editor." : "Add a name and the instructions to save."}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!valid || saving} className="min-w-[8rem]">
            {saving ? "Saving…" : "Save skill"}
          </Button>
        </div>
      </div>
    </div>
  );
}
