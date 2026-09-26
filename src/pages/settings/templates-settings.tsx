"use client";

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
import { Switch } from "@/components/ui/switch";
import {
  addTemplate,
  exportTemplate,
  inspectTemplate,
  listTemplates,
  openTemplate,
  reloadTemplate,
  removeTemplate,
  updateTemplate,
  type Inspection,
  type TemplateInfo,
} from "@/features/templates";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  Field,
  GroupLabel,
  IconTile,
  Notice,
  SectionHeader,
  SettingsList,
  SettingsSection,
} from "@/pages/settings/ui";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CalculatorIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FileTextIcon,
  LoaderIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Field chips, the first few and "+N". */
function Fields({ fields, max = 8 }: { fields: string[]; max?: number }) {
  if (fields.length === 0) return <span className="text-xs text-amber-600 dark:text-amber-400">No {"{{fields}}"} yet</span>;
  const shown = fields.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <code
          key={f}
          title={f.startsWith("?") ? "Optional — its line is dropped when empty" : f.startsWith("item.") ? "A table row, repeated per item" : undefined}
          className={cn(
            "rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
            f.startsWith("?") ? "border-dashed text-muted-foreground" : "border-border/70 bg-muted/40",
          )}
        >
          {f}
        </code>
      ))}
      {fields.length > max && <span className="px-1 text-[11px] text-muted-foreground">+{fields.length - max}</span>}
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
      {children}
    </span>
  );
}

async function saveCopy(template: TemplateInfo) {
  const path = await save({
    title: `Save a copy of “${template.name}”`,
    defaultPath: `${template.name}.docx`,
    filters: [{ name: "Word document", extensions: ["docx"] }],
  });
  if (path) await exportTemplate(template.id, path);
}

type Draft = { path: string; inspection: Inspection; name: string; description: string };

export function TemplatesSettings() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [editing, setEditing] = useState<TemplateInfo>();
  const [busy, setBusy] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setTemplates(await listTemplates());
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const run = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await task();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const pick = async () => {
    const path = await open({ multiple: false, title: "Add a Word template", filters: [{ name: "Word document", extensions: ["docx"] }] });
    if (typeof path !== "string") return;
    setError(undefined);
    try {
      const inspection = await inspectTemplate(path);
      setDraft({ path, inspection, name: inspection.suggestedName, description: "" });
    } catch (e) {
      setError(String(e));
    }
  };

  const own = templates.filter((t) => !t.builtin);
  const builtin = templates.filter((t) => t.builtin);

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Document templates"
        description="Word layouts Mali fills in for you in Cowork — your company's quotation, a letter format, a form. Each one gets a / command in the chat box, and keeps its layout exactly."
        actions={
          <Button onClick={() => void pick()} className="gap-1.5">
            <FilePlusIcon className="size-4" />
            Add template
          </Button>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      <SettingsSection>
        <GroupLabel>Your templates</GroupLabel>
        {own.length === 0 ? (
          <EmptyState
            icon={<FileTextIcon />}
            title="No templates of your own yet"
            description={
              <>
                Open your document in Word, type <code>{"{{customer_name}}"}</code> where each detail goes, and add it here.
                No time? In a Cowork chat, ask Mali “ทำไฟล์นี้ให้เป็น template” and it marks the fields for you.
              </>
            }
            action={
              <Button variant="outline" onClick={() => void pick()} className="gap-1.5">
                <FilePlusIcon className="size-4" />
                Add a .docx
              </Button>
            }
          />
        ) : (
          <SettingsList>
            {own.map((t) => (
              <li key={t.id} className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-start", !t.enabled && "opacity-60")}>
                <IconTile className="bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <FileTextIcon />
                </IconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <code className="text-[11px] text-muted-foreground">/{t.name.trim().toLowerCase().replace(/\s+/g, "-")}</code>
                    {t.money && (
                      <Pill>
                        <CalculatorIcon className="size-3" />
                        Computes totals
                      </Pill>
                    )}
                  </div>
                  {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                  <Fields fields={t.fields} />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button size="icon-sm" variant="ghost" title="Rename or describe" onClick={() => setEditing(t)}>
                    <PencilIcon />
                  </Button>
                  <Button size="icon-sm" variant="ghost" title="Open in Word to change its look" onClick={() => void run(`open:${t.id}`, () => openTemplate(t.id))}>
                    <ExternalLinkIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Read the fields again (after editing it in Word)"
                    disabled={busy === `reload:${t.id}`}
                    onClick={() => void run(`reload:${t.id}`, () => reloadTemplate(t.id))}
                  >
                    {busy === `reload:${t.id}` ? <LoaderIcon className="animate-spin" /> : <RefreshCwIcon />}
                  </Button>
                  <Button size="icon-sm" variant="ghost" title="Save a copy" onClick={() => void run(`copy:${t.id}`, () => saveCopy(t))}>
                    <DownloadIcon />
                  </Button>
                  <Button
                    size={confirmDelete === t.id ? "sm" : "icon-sm"}
                    variant={confirmDelete === t.id ? "destructive" : "ghost"}
                    title="Remove"
                    onClick={() => {
                      if (confirmDelete !== t.id) {
                        setConfirmDelete(t.id);
                        setTimeout(() => setConfirmDelete((c) => (c === t.id ? undefined : c)), 3000);
                        return;
                      }
                      setConfirmDelete(undefined);
                      void run(`remove:${t.id}`, () => removeTemplate(t.id));
                    }}
                  >
                    <Trash2Icon />
                    {confirmDelete === t.id && "Remove?"}
                  </Button>
                  <Switch
                    className="ml-1"
                    checked={t.enabled}
                    aria-label={`Use ${t.name}`}
                    onCheckedChange={(on) => void run(`toggle:${t.id}`, () => updateTemplate(t.id, { enabled: on }))}
                  />
                </div>
              </li>
            ))}
          </SettingsList>
        )}
        <Notice tone="info">
          <span className="font-medium">Making a template:</span> type <code>{"{{field_name}}"}</code> for each detail
          (English letters, digits and _). A table row with <code>{"{{item.description}}"}</code>,{" "}
          <code>{"{{item.qty}}"}</code>, <code>{"{{item.unit_price}}"}</code>, <code>{"{{item.amount}}"}</code> repeats
          once per item. Put <code>?</code> in front for an optional field (<code>{"{{?note}}"}</code>) — its line goes
          when it's empty. With <code>{"{{total}}"}</code>, Mali computes the amounts, VAT 7% and the total in Thai words.
        </Notice>
      </SettingsSection>

      <SettingsSection>
        <GroupLabel>Built in</GroupLabel>
        <SettingsList>
          {builtin.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <IconTile className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <FileTextIcon />
              </IconTile>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <code className="text-[11px] text-muted-foreground">/{t.name}</code>
                  {t.money && (
                    <Pill>
                      <CalculatorIcon className="size-3" />
                      Computes totals
                    </Pill>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <Fields fields={t.fields} max={6} />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                title="Save it as a .docx to restyle in Word, then add it back as your own"
                onClick={() => void run(`copy:${t.id}`, () => saveCopy(t))}
              >
                <DownloadIcon className="size-3.5" />
                Save a copy
              </Button>
            </li>
          ))}
        </SettingsList>
      </SettingsSection>

      <AddDialog
        draft={draft}
        onChange={setDraft}
        onSave={(d) =>
          run("add", async () => {
            await addTemplate(d.path, d.name, d.description);
            setDraft(undefined);
          })
        }
        saving={busy === "add"}
      />
      <EditDialog
        template={editing}
        onClose={() => setEditing(undefined)}
        onSave={(t, name, description) =>
          run(`edit:${t.id}`, async () => {
            await updateTemplate(t.id, { name, description });
            setEditing(undefined);
          })
        }
      />
    </div>
  );
}

function AddDialog({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft?: Draft;
  onChange: (d?: Draft) => void;
  onSave: (d: Draft) => void;
  saving: boolean;
}) {
  const noFields = draft && draft.inspection.fields.length === 0;
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onChange(undefined)}>
      <DialogContent className="sm:max-w-lg">
        {draft && (
          <>
            <DialogHeader>
              <DialogTitle>Add a template</DialogTitle>
              <DialogDescription>Mali keeps a copy, so it works from any folder.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <Field label="Name" hint="Also its / command in the chat box.">
                <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} autoFocus />
              </Field>
              <Field label="When to use it" hint="Helps the AI pick it, e.g. “ใบเสนอราคาสำหรับลูกค้าองค์กร”.">
                <Input value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Fields found</span>
                <Fields fields={draft.inspection.fields} max={20} />
              </div>
              {noFields && (
                <Notice tone="warning">
                  This document has no <code>{"{{fields}}"}</code>, so nothing would change when it's filled. Type them in
                  Word first — or add it anyway and, in a Cowork chat, ask Mali to turn it into a template.
                </Notice>
              )}
              <pre className="max-h-40 overflow-auto rounded-lg border border-border/60 bg-muted/30 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {draft.inspection.preview || "(empty document)"}
              </pre>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onChange(undefined)}>
                Cancel
              </Button>
              <Button onClick={() => onSave(draft)} disabled={!draft.name.trim() || saving} className="gap-1.5">
                {saving && <LoaderIcon className="size-4 animate-spin" />}
                Add template
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  template,
  onClose,
  onSave,
}: {
  template?: TemplateInfo;
  onClose: () => void;
  onSave: (t: TemplateInfo, name: string, description: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
  }, [template]);
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {template && (
          <>
            <DialogHeader>
              <DialogTitle>Edit “{template.name}”</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
              <Field label="When to use it">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => onSave(template, name, description)} disabled={!name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
