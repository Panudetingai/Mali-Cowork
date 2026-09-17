"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangleIcon,
  BrainIcon,
  CheckCircle2Icon,
  FolderOpenIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";
import type { OpencodeConfigState } from "./use-opencode-config";

type Props = {
  config: OpencodeConfigState;
};

export function OpencodeConfigPanel({ config }: Props) {
  const {
    cwd,
    model,
    thinking,
    autoApprove,
    check,
    models,
    loading,
    setCwd,
    setModel,
    setThinking,
    setAutoApprove,
    refresh,
  } = config;

  const unavailable = Boolean(check && !check.available);

  const handlePickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: cwd || undefined,
      title: "เลือกโฟลเดอร์ให้ opencode ทำงาน",
    });
    if (typeof selected === "string" && selected) {
      setCwd(selected);
    }
  };

  const providerModels = models
    ? groupByProvider(models.models)
    : [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border bg-card/50 p-3 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <TerminalIcon className="size-3.5" />
          </div>
          <span className="text-xs font-semibold">OpenCode Agent</span>
        </div>
        <div className="flex items-center gap-1.5">
          {check && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                check.available
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
              )}
            >
              {check.available ? (
                <>
                  <CheckCircle2Icon className="size-3" />
                  {check.version || "opencode"}
                </>
              ) : (
                <>
                  <AlertTriangleIcon className="size-3" />
                  ไม่พบ CLI
                </>
              )}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={refresh}
            disabled={loading}
            title="รีเฟรช CLI / models"
          >
            <RefreshCwIcon className={cn("size-3", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {/* Folder */}
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FolderOpenIcon className="size-3" />
            Working folder
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePickFolder}
              className="h-8 shrink-0 gap-1.5 text-xs"
              disabled={loading}
            >
              <FolderOpenIcon className="size-3.5" />
              เลือกโฟลเดอร์
            </Button>
            <div
              className="min-w-0 flex-1 truncate rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground"
              title={cwd || "default public/"}
            >
              {cwd || "default: public/"}
            </div>
          </div>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TerminalIcon className="size-3" />
            Model
          </label>
          <Select
            value={model}
            onValueChange={setModel}
            disabled={loading || unavailable}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="default (ตาม config opencode)" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="" className="text-xs">
                default (ตาม config opencode)
              </SelectItem>
              {unavailable ? (
                <SelectLabel className="text-xs text-red-500">
                  ติดตั้ง opencode ก่อนจึงจะเลือก model ได้
                </SelectLabel>
              ) : providerModels.length === 0 ? (
                <SelectLabel className="text-xs text-muted-foreground">
                  {loading ? "กำลังโหลด models…" : "ไม่พบ model"}
                </SelectLabel>
              ) : (
                providerModels.map(({ provider, models }) => (
                  <SelectGroup key={provider}>
                    <SelectLabel className="text-xs uppercase tracking-wider">
                      {provider}
                    </SelectLabel>
                    {models.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">
                        {m.replace(`${provider}/`, "")}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Options */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <OptionSwitch
            icon={<BrainIcon className="size-3.5 text-purple-500" />}
            label="Thinking"
            description="แสดง reasoning (--thinking)"
            checked={thinking}
            onCheckedChange={setThinking}
            disabled={unavailable}
          />
          <OptionSwitch
            icon={<ShieldCheckIcon className="size-3.5 text-emerald-500" />}
            label="Auto-approve"
            description="อนุมัติ permission อัตโนมัติ (--auto)"
            checked={autoApprove}
            onCheckedChange={setAutoApprove}
            disabled={unavailable}
          />
        </div>

        {/* Error / Help */}
        {unavailable ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
            <div className="flex items-start gap-2">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <p className="font-medium">ไม่พบ opencode CLI</p>
                <p className="mt-0.5 text-red-600/80 dark:text-red-400/80">
                  ติดตั้งด้วย{" "}
                  <code className="rounded bg-background px-1 py-0.5 font-mono dark:bg-black/30">
                    npm i -g opencode
                  </code>{" "}
                  หรือ{" "}
                  <code className="rounded bg-background px-1 py-0.5 font-mono dark:bg-black/30">
                    bun add -g opencode
                  </code>{" "}
                  แล้ว restart แอป
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            opencode จะทำงานในโฟลเดอร์ที่เลือก ใช้ model ที่เลือก และส่งผลลัพธ์กลับมาแบบ streaming
          </p>
        )}
      </div>
    </div>
  );
}

function OptionSwitch({
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2 transition-colors",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted">
          {icon}
        </span>
        <div className="flex flex-col">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[11px] text-muted-foreground">{description}</span>
        </div>
      </div>
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </label>
  );
}

function groupByProvider(models: string[]) {
  const map = new Map<string, string[]>();
  for (const m of models) {
    const provider = m.split("/")[0] || "other";
    if (!map.has(provider)) map.set(provider, []);
    map.get(provider)!.push(m);
  }
  return Array.from(map.entries())
    .map(([provider, models]) => ({ provider, models: models.sort() }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
