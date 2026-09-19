import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Skill } from "@/features/instructions";
import { useEffect, useId, useState } from "react";
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
  const save = () => {
    if (!valid) return;
    onSave({ ...form, name: form.name.trim(), description: form.description.trim() });
    onClose();
  };

  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit skill" : "New skill"}</DialogTitle>
          <DialogDescription>Write it like a short guide for a new teammate.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor={ids.name}>
            <Input
              id={ids.name}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Weekly report"
            />
          </Field>
          <Field label="Use when" htmlFor={ids.description} hint="The AI reads this to decide when the skill applies.">
            <Input
              id={ids.description}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. The user asks for a weekly status report"
            />
          </Field>
          <Field label="Instructions" htmlFor={ids.instructions}>
            <Textarea
              id={ids.instructions}
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              placeholder={"Steps, format, tone, examples…"}
              className="max-h-72 min-h-40 font-mono text-xs"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!valid}>
            Save skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
