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
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { Field, Notice, SectionHeader, SettingsGroup, SettingsPage, Steps } from "@/pages/settings/ui";
import { menuClass, menuItemClass } from "@/pages/settings/skills/skill-row";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CalculatorIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FileTextIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
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
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
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

const slashName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

const fail = (e: unknown) =>
  toast.error("Something went wrong", { description: e instanceof Error ? e.message : String(e) });

export function TemplatesSettings() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [editing, setEditing] = useState<TemplateInfo>();
  const [busy, setBusy] = useState<string>();
  const [removing, setRemoving] = useState<TemplateInfo>();

  const reload = useCallback(async () => {
    try {
      setTemplates(await listTemplates());
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const run = async (key: string, task: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await task();
      await reload();
      if (done) toast.success(done);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  };

  const pick = async () => {
    const path = await open({ multiple: false, title: "Add a Word template", filters: [{ name: "Word document", extensions: ["docx"] }] });
    if (typeof path !== "string") return;
    try {
      const inspection = await inspectTemplate(path);
      setDraft({ path, inspection, name: inspection.suggestedName, description: "" });
    } catch (e) {
      fail(e);
    }
  };

  const own = templates.filter((t) => !t.builtin);
  const builtin = templates.filter((t) => t.builtin);

  const menu = (t: TemplateInfo) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`More for ${t.name}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
        <DropdownMenuItem className={menuItemClass} onSelect={() => setEditing(t)}>
          <PencilIcon className="size-4 text-muted-foreground" />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItemClass} onSelect={() => void run(`open:${t.id}`, () => openTemplate(t.id))}>
          <ExternalLinkIcon className="size-4 text-muted-foreground" />
          Open in Word
        </DropdownMenuItem>
        <DropdownMenuItem
          className={menuItemClass}
          onSelect={() => void run(`reload:${t.id}`, () => reloadTemplate(t.id), "Fields updated")}
        >
          <RefreshCwIcon className="size-4 text-muted-foreground" />
          Re-read fields
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItemClass} onSelect={() => void run(`copy:${t.id}`, () => saveCopy(t))}>
          <DownloadIcon className="size-4 text-muted-foreground" />
          Save a copy…
        </DropdownMenuItem>
        <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
        <DropdownMenuItem
          className={cn(menuItemClass, "text-destructive data-[highlighted]:text-destructive")}
          onSelect={() => setRemoving(t)}
        >
          <Trash2Icon className="size-4" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <SettingsPage>
      <SectionHeader
        title="Document templates"
        description="Word documents Mali fills in for you in Cowork — your quotation, letter or form. The layout stays exactly as you designed it."
        actions={
          <Button onClick={() => void pick()} size="sm" className="h-9 gap-1.5">
            <PlusIcon className="size-4" />
            Add template
          </Button>
        }
      />

      <div className="pb-7">
        <Steps
          steps={[
            {
              title: "Mark the blanks in Word",
              description: (
                <>
                  Type <code className="font-mono">{"{{customer_name}}"}</code> wherever a detail goes.
                </>
              ),
            },
            { title: "Add the .docx here", description: "Mali keeps its own copy, so it works from any folder." },
            { title: "Use it in a chat", description: "Type / and its name in a Cowork chat, and Mali fills it in." },
          ]}
        />
      </div>

      <SettingsGroup wide title={`Your templates${own.length ? ` · ${own.length}` : ""}`}>
        {own.length === 0 ? (
          <button
            type="button"
            onClick={() => void pick()}
            className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-foreground/30 hover:bg-muted/30"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <FilePlusIcon className="size-5" />
            </span>
            <span className="text-sm font-medium">Choose a .docx to start</span>
            <span className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
              No fields in it yet? Add it anyway, then in a Cowork chat ask Mali “ทำไฟล์นี้ให้เป็น template” and it marks them for you.
            </span>
          </button>
        ) : (
          <div className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2">
            {own.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                busy={!!busy?.endsWith(`:${t.id}`)}
                control={
                  <>
                    <Switch
                      checked={t.enabled}
                      aria-label={`Use ${t.name}`}
                      onCheckedChange={(on) => void run(`toggle:${t.id}`, () => updateTemplate(t.id, { enabled: on }))}
                    />
                    {menu(t)}
                  </>
                }
              />
            ))}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup wide title="Built in" description="Ready to use. Save a copy to restyle it in Word, then add it back as your own.">
        <div className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2">
          {builtin.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              builtin
              busy={busy === `copy:${t.id}`}
              control={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Save a copy"
                  aria-label={`Save a copy of ${t.name}`}
                  onClick={() => void run(`copy:${t.id}`, () => saveCopy(t))}
                >
                  <DownloadIcon />
                </Button>
              }
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Field syntax" description="What you can type in a Word document for Mali to fill.">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 py-3.5 text-[13px] sm:grid-cols-[auto_1fr]">
          <SyntaxItem code="{{field_name}}">A detail to fill in. English letters, digits and _.</SyntaxItem>
          <SyntaxItem code="{{?note}}">Optional. Its line is removed when it’s empty.</SyntaxItem>
          <SyntaxItem code="{{item.description}}">
            In a table row: the row repeats once per item. Also <code className="font-mono">item.qty</code>,{" "}
            <code className="font-mono">item.unit_price</code>, <code className="font-mono">item.amount</code>.
          </SyntaxItem>
          <SyntaxItem code="{{total}}">Mali computes the amounts, VAT 7% and the total in Thai words.</SyntaxItem>
        </dl>
      </SettingsGroup>

      <AddDialog
        draft={draft}
        onChange={setDraft}
        onSave={(d) =>
          run(
            "add",
            async () => {
              await addTemplate(d.path, d.name, d.description);
              setDraft(undefined);
            },
            `Added “${d.name}”. Type /${slashName(d.name)} in a Cowork chat to use it.`,
          )
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
      <ConfirmDialog
        onClose={() => setRemoving(undefined)}
        request={
          removing && {
            title: `Remove “${removing.name}”?`,
            description: "Mali's copy is deleted. Your original .docx isn't touched.",
            confirmLabel: "Remove",
            destructive: true,
            onConfirm: () => void run(`remove:${removing.id}`, () => removeTemplate(removing.id), `Removed “${removing.name}”`),
          }
        }
      />
    </SettingsPage>
  );
}

/** One template as a card: name and its / command, what it's for, its fields. */
function TemplateCard({
  template: t,
  builtin,
  busy,
  control,
}: {
  template: TemplateInfo;
  builtin?: boolean;
  busy?: boolean;
  control: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 transition-opacity",
        !t.enabled && !builtin && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            builtin ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400",
          )}
        >
          {busy ? <LoaderIcon className="animate-spin" /> : <FileTextIcon />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{t.name}</span>
          <code className="w-fit truncate font-mono text-[11px] text-muted-foreground">/{builtin ? t.name : slashName(t.name)}</code>
        </div>
        <div className="flex shrink-0 items-center gap-1">{control}</div>
      </div>
      {t.description && <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{t.description}</p>}
      <div className="mt-auto flex flex-col gap-2 border-t border-border/60 pt-3">
        {t.money && (
          <Pill>
            <CalculatorIcon className="size-3" />
            Computes totals
          </Pill>
        )}
        <Fields fields={t.fields} max={builtin ? 6 : 8} />
      </div>
    </div>
  );
}

function SyntaxItem({ code, children }: { code: string; children: ReactNode }) {
  return (
    <>
      <dt>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{code}</code>
      </dt>
      <dd className="leading-relaxed text-muted-foreground">{children}</dd>
    </>
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
