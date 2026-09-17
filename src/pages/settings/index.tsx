"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderOpenIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  checkCli,
  opencodeCheck,
  opencodeDefaultCwd,
  opencodeListModels,
  type CliCheckResult,
  type OpencodeCheckResult,
} from "@/pages/chat/api/opencode";

type CliItem = {
  id: string;
  label: string;
  bin: string;
  installHint: string;
};

const CLI_ITEMS: CliItem[] = [
  { id: "opencode", label: "OpenCode", bin: "opencode", installHint: "npm i -g opencode  หรือ  bun add -g opencode" },
  { id: "cursor", label: "Cursor Agent", bin: "cursor-agent", installHint: "ติดตั้ง Cursor แล้วรัน `cursor-agent --version` หรือดาวน์โหลดจาก cursor.com" },
  { id: "codex", label: "Codex (OpenAI)", bin: "codex", installHint: "npm i -g @openai/codex" },
];

export default function SettingsPage() {
  const [opencodeCheckResult, setOpencodeCheckResult] = useState<OpencodeCheckResult | null>(null);
  const [opencodeModels, setOpencodeModels] = useState<string[]>([]);
  const [opencodeProviders, setOpencodeProviders] = useState<string[]>([]);
  const [opencodeCwd, setOpencodeCwd] = useState<string>(() => {
    try { return localStorage.getItem("opencode_cwd") || ""; } catch { return ""; }
  });
  const [opencodeModel, setOpencodeModel] = useState<string>(() => {
    try { return localStorage.getItem("opencode_model") || ""; } catch { return ""; }
  });
  const [cliStatuses, setCliStatuses] = useState<Record<string, CliCheckResult | null>>({});
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [chk, defCwd, modelsRes] = await Promise.all([
        opencodeCheck().catch(() => ({ available: false, error: "check failed" } as OpencodeCheckResult)),
        opencodeDefaultCwd().catch(() => ""),
        opencodeListModels().catch(() => ({ models: [], providers: [] })),
      ]);
      setOpencodeCheckResult(chk as OpencodeCheckResult);
      if (!opencodeCwd && defCwd) {
        setOpencodeCwd(defCwd);
        try { localStorage.setItem("opencode_cwd", defCwd); } catch {}
      }
      setOpencodeModels((modelsRes as any).models || []);
      setOpencodeProviders((modelsRes as any).providers || []);
    } finally {
      setLoading(false);
    }

    // check cursor/codex แยก
    for (const item of CLI_ITEMS) {
      if (item.id === "opencode") continue;
      try {
        const res = await checkCli(item.id);
        setCliStatuses((prev) => ({ ...prev, [item.id]: res }));
      } catch {
        setCliStatuses((prev) => ({ ...prev, [item.id]: { available: false, error: "check failed" } }));
      }
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem("opencode_cwd", opencodeCwd); } catch {}
  }, [opencodeCwd]);
  useEffect(() => {
    try { localStorage.setItem("opencode_model", opencodeModel); } catch {}
  }, [opencodeModel]);

  async function handlePickFolder() {
    try {
      const sel = await open({ directory: true, multiple: false, defaultPath: opencodeCwd || undefined, title: "เลือกโฟลเดอร์ให้ opencode ทำงาน (default: public/)" });
      if (typeof sel === "string" && sel) setOpencodeCwd(sel);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">ตั้งค่า CLI แยกโมดูล — ตอนนี้โฟกัสที่ <b>opencode</b> (แยกจาก cursor/codex แล้ว)</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={loading} className="gap-1.5">
          <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          รีเฟรช
        </Button>
      </div>

      {/* OpenCode แยกโมดูล */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            OpenCode <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">แยกโมดูลแล้ว</span>
          </CardTitle>
          <CardDescription>
            Default folder คือ <code className="rounded bg-muted px-1">public/</code> ของ User — เลือกได้ว่าให้ agent ไปอ่าน/ทำงานที่โฟลเดอร์ไหน + เลือก provider/model ของ opencode ได้
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Check */}
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            {opencodeCheckResult ? (
              opencodeCheckResult.available ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
              ) : (
                <XCircleIcon className="size-5 shrink-0 text-red-600" />
              )
            ) : (
              <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {opencodeCheckResult ? (opencodeCheckResult.available ? `พร้อมใช้งาน ${opencodeCheckResult.version || ""}` : "ไม่พบ opencode CLI") : "กำลังตรวจ..."}
              </div>
              <div className="truncate text-xs text-muted-foreground" title={opencodeCheckResult?.path || opencodeCheckResult?.error || ""}>
                {opencodeCheckResult?.path || opencodeCheckResult?.error || "—"}
              </div>
            </div>
            <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", opencodeCheckResult?.available ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300")}>
              {opencodeCheckResult ? (opencodeCheckResult.available ? "พร้อม" : "ไม่พร้อม") : "—"}
            </span>
          </div>
          {!opencodeCheckResult?.available && (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              ติดตั้งด้วย <code className="rounded bg-background px-1">npm i -g opencode</code> แล้ว restart แอป — หรือตั้ง <code>OPENCODE_BIN</code> ชี้ไปที่ไฟล์ <code>opencode.cmd</code>
            </p>
          )}

          {/* Folder */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">โฟลเดอร์ทำงาน (cwd)</Label>
            <div className="flex items-center gap-2">
              <Input value={opencodeCwd} onChange={(e) => setOpencodeCwd(e.target.value)} placeholder="เช่น D:\mali_cowork\public หรือ C:\Users\Public" className="h-8 flex-1 text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={handlePickFolder} className="h-8 gap-1.5 text-xs">
                <FolderOpenIcon className="size-3.5" />
                เลือก
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              default คือโฟลเดอร์ <code>public</code> ของเครื่อง User (เช่น <code>C:\Users\Public</code> หรือ <code>~/Public</code> ถ้าไม่มีจะ fallback เป็น <code>.\public</code> ของโปรเจค) — เลือกได้ว่าจะให้ agent ไปอ่าน/แก้ไขไฟล์ที่ไหน
            </p>
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Provider / Model ของ opencode</Label>
            <select
              value={opencodeModel}
              onChange={(e) => setOpencodeModel(e.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="">— default (ตาม config opencode) —</option>
              {opencodeProviders.length > 0 ? (
                opencodeProviders.map((prov) => (
                  <optgroup key={prov} label={prov}>
                    {opencodeModels.filter((m) => m.startsWith(prov + "/")).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <option disabled>{opencodeCheckResult?.available ? "กำลังโหลด models..." : "ต้องมี opencode ก่อน"}</option>
              )}
            </select>
            <p className="text-[11px] text-muted-foreground">
              ดึงจาก <code>opencode models</code> ({opencodeModels.length} models, {opencodeProviders.length} providers) — เลือกแล้วจะส่ง <code>opencode run -m provider/model</code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cursor / Codex — แยกไฟล์แล้วแต่ยังไม่โฟกัส */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Local CLI อื่นๆ (แยกไฟล์แล้ว)</CardTitle>
          <CardDescription>cursor / codex แยกออกเป็น <code>commands/cursor.rs</code> / <code>codex.rs</code> แล้ว แต่ตอนนี้โฟกัส opencode ก่อน — หน้านี้ไว้เช็คว่าวางบนเครื่องไหม</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {CLI_ITEMS.filter((x) => x.id !== "opencode").map((item) => {
            const st = cliStatuses[item.id];
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
                {st ? (st.available ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <XCircleIcon className="size-5 shrink-0 text-red-600" />) : <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.label} <span className="font-mono text-xs text-muted-foreground">({item.bin})</span></div>
                  <div className="truncate text-xs text-muted-foreground" title={st?.path || st?.error || ""}>{st ? (st.path || st.error || (st.available ? st.version || "พร้อม" : "ไม่พบ")) : "กำลังตรวจ..."}</div>
                  {!st?.available && <div className="text-[11px] text-muted-foreground">ติดตั้ง: <code className="rounded bg-muted px-1">{item.installHint}</code></div>}
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", st?.available ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : st ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-muted text-muted-foreground")}>
                  {st ? (st.available ? "พร้อม" : "ไม่พร้อม") : "—"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">opencode แยกเป็น <code>src-tauri/src/commands/opencode.rs</code> แล้ว — cursor/codex อยู่ <code>commands/cli.rs</code> + <code>check_cli</code> แยกเช็คได้ | ค่า folder/model เก็บใน <code>localStorage opencode_cwd / opencode_model</code></p>
    </div>
  );
}
