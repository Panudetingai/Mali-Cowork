import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { Skill } from "@/features/instructions";
import { cn } from "@/lib/utils";
import { BookOpenIcon, SparklesIcon, TerminalIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Field } from "../ui";

export type SkillDraft = Omit<Skill, "id"> & { id?: string };

export const EMPTY_SKILL: SkillDraft = { name: "", description: "", instructions: "", enabled: true };

export function SkillDialog({
  draft,
  onSave,
  onClose,
}: {
  draft: SkillDraft | null;
  onSave: (skill: SkillDraft) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SkillDraft>(EMPTY_SKILL);
  const ids = { name: useId(), description: useId(), instructions: useId() };

  useEffect(() => {
    if (draft) setForm(draft);
  }, [draft]);

  const valid = form.name.trim() && form.instructions.trim();
  const slug = form.name.trim().toLowerCase().replace(/\s+/g, "-");
  const lineCount = useMemo(
    () => (form.instructions ? form.instructions.split(/\r?\n/).length : 0),
    [form.instructions],
  );
  const statusText = valid ? "Ready to save" : "Name and instructions are required";

  const save = () => {
    if (!valid) return;
    onSave({ ...form, name: form.name.trim(), description: form.description.trim() });
    onClose();
  };

  const isEdit = Boolean(draft?.id);

  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="shrink-0 border-b border-border/60 bg-gradient-to-br from-violet-500/[0.07] via-transparent to-amber-500/[0.05] px-6 pt-5 pb-4">
          <div className="flex gap-3.5 pr-8">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-700 shadow-sm ring-1 ring-violet-500/20 dark:text-violet-300">
              <SparklesIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                {isEdit ? "Edit skill" : "New skill"}
              </DialogTitle>
              <p className="text-sm leading-snug text-muted-foreground">
                Write it like a short guide for a new teammate — steps, format, and examples the AI should follow.
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          <section className="shrink-0 rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <BookOpenIcon className="size-3.5" />
              Overview
            </p>
            <div className="grid grid-cols-1 gap-4">
              <Field label="Name" htmlFor={ids.name} hint={slug ? `Call in chat with /${slug}` : "Use a short, memorable name."}>
                <Input
                  id={ids.name}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. weekly-report"
                  className="rounded-lg bg-background"
                />
              </Field>
              <Field
                label="Use when"
                htmlFor={ids.description}
                optional
                hint="The AI reads this to decide when the skill applies."
              >
                <Input
                  id={ids.description}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. The user asks for a weekly status report"
                  className="rounded-lg bg-background"
                />
              </Field>
            </div>
          </section>

          <section className="flex min-h-[min(280px,45vh)] flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-2">
              <label htmlFor={ids.instructions} className="text-sm font-medium">
                Instructions
              </label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {lineCount > 0 ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : "Markdown supported"}
              </span>
            </div>
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col rounded-xl border border-border/80 bg-background",
                "ring-1 ring-foreground/[0.03] focus-within:border-violet-500/40 focus-within:ring-violet-500/20",
              )}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
                <TerminalIcon className="size-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium text-muted-foreground">Skill body</span>
              </div>
              <Textarea
                id={ids.instructions}
                value={form.instructions}
                onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                placeholder={"# What to do\n\n1. Ask for missing details\n2. Use this format…\n\n## Examples\n…"}
                className="min-h-[180px] flex-1 resize-none rounded-none border-0 bg-transparent px-3 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
              />
              <p className="shrink-0 border-t border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Tip: headings, lists, and tables help the model follow long workflows.
              </p>
            </div>
          </section>
        </div>

        <Separator />
        <DialogFooter className="shrink-0 flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className={cn("text-xs", valid ? "text-foreground/70" : "text-amber-700 dark:text-amber-400")}>
            {statusText}
          </p>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={!valid} className="min-w-[7rem]">
              Save skill
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
