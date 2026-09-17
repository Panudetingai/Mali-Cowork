import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderOpenIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { checkCli, type CliCheckResult } from "@/pages/chat/api/cli";
import { CursorLoginDialog, requestCursorLogin, useCursor } from "@/features/cursor";
import { useOpencode } from "@/features/opencode";

type CliItem = {
  id: string;
  label: string;
  bin: string;
  installHint: string;
};

const CLI_ITEMS: CliItem[] = [
  { id: "codex", label: "Codex (OpenAI)", bin: "codex", installHint: "npm i -g @openai/codex" },
];

export function AgentsSettings() {
  const opencode = useOpencode();
  const cursor = useCursor();
  const [cwdDraft, setCwdDraft] = useState(opencode.cwd);
  const [cliStatuses, setCliStatuses] = useState<Record<string, CliCheckResult | null>>({});
  const opencodeCheckResult = opencode.loading ? null : opencode.check;
  const modelCount = opencode.models?.models.length ?? 0;

  useEffect(() => setCwdDraft(opencode.cwd), [opencode.cwd]);

  async function loadCliStatuses() {
    await Promise.all(
      CLI_ITEMS.map(async (item) => {
        const res = await checkCli(item.id).catch(
          (): CliCheckResult => ({ available: false, error: "check failed" }),
        );
        setCliStatuses((prev) => ({ ...prev, [item.id]: res }));
      }),
    );
  }

  useEffect(() => {
    loadCliStatuses();
  }, []);

  function refreshAll() {
    setCliStatuses({});
    opencode.refresh();
    cursor.refresh();
    loadCliStatuses();
  }

  async function handlePickFolder() {
    const sel = await open({ directory: true, multiple: false, defaultPath: opencode.cwd || undefined, title: "Choose the folder OpenCode works in" });
    if (typeof sel === "string" && sel) opencode.update({ cwd: sel });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Agents</h2>
          <p className="text-sm text-muted-foreground">สถานะ Local CLI และโฟลเดอร์ทำงานของ OpenCode — เลือก model ได้ที่ช่องพิมพ์ในหน้าแชท</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={opencode.loading} className="gap-1.5">
          <RefreshCwIcon className={cn("size-3.5", opencode.loading && "animate-spin")} />
          รีเฟรช
        </Button>
      </div>

      {/* OpenCode แยกโมดูล */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            OpenCode
          </CardTitle>
          <CardDescription>
            แอปจะเปิด <code className="rounded bg-muted px-1">opencode serve</code> ค้างไว้ในเบื้องหลัง ทำให้ส่งข้อความได้ทันทีและถามสิทธิ์ก่อนแก้หรือลบไฟล์ ({modelCount} models)
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
              ติดตั้งด้วย <code className="rounded bg-background px-1">npm i -g opencode-ai</code> แล้ว restart แอป — หรือตั้ง <code>OPENCODE_BIN</code> ชี้ไปที่ไฟล์ opencode
            </p>
          )}

          {/* Folder */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">โฟลเดอร์ทำงาน (cwd)</Label>
            <div className="flex items-center gap-2">
              <Input value={cwdDraft} onChange={(e) => setCwdDraft(e.target.value)} onBlur={() => opencode.update({ cwd: cwdDraft.trim() })} placeholder="เช่น D:\mali_cowork\public หรือ C:\Users\Public" className="h-8 flex-1 text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={handlePickFolder} className="h-8 gap-1.5 text-xs">
                <FolderOpenIcon className="size-3.5" />
                เลือก
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              default คือโฟลเดอร์ <code>public</code> ของเครื่อง User (เช่น <code>C:\Users\Public</code> หรือ <code>~/Public</code> ถ้าไม่มีจะ fallback เป็น <code>.\public</code> ของโปรเจค) — เลือกได้ว่าจะให้ agent ไปอ่าน/แก้ไขไฟล์ที่ไหน
            </p>
          </div>

        </CardContent>
      </Card>

      {/* Cursor Agent CLI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Cursor Agent</CardTitle>
          <CardDescription>
            รันผ่าน <code className="rounded bg-muted px-1">cursor-agent</code> บนเครื่องนี้ ใช้ subscription
            ของคุณเอง — Chat ใช้โหมด ask (อ่านไม่ได้เขียน), Cowork ทำงานในโฟลเดอร์ที่อนุญาต
            {cursor.models.length > 0 ? ` (${cursor.models.length} models)` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            {cursor.loading ? (
              <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
            ) : cursor.check?.available && cursor.check.loggedIn ? (
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            ) : (
              <XCircleIcon className="size-5 shrink-0 text-red-600" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {cursor.loading
                  ? "กำลังตรวจ..."
                  : !cursor.check?.available
                    ? "ไม่พบ cursor-agent CLI"
                    : cursor.check.loggedIn
                      ? `พร้อมใช้งาน ${cursor.check.version ?? ""}`
                      : "ยังไม่ได้ login"}
              </div>
              <div
                className="truncate text-xs text-muted-foreground"
                title={cursor.check?.path || cursor.check?.error || ""}
              >
                {cursor.check?.account || cursor.check?.error || cursor.check?.path || "—"}
              </div>
            </div>
            {!cursor.loading && !(cursor.check?.available && cursor.check.loggedIn) && (
              <Button
                type="button"
                size="sm"
                onClick={() => requestCursorLogin()}
                className="shrink-0 gap-1.5"
              >
                {cursor.check?.available ? "Login" : "วิธีติดตั้ง"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Codex — แยกไฟล์แล้วแต่ยังไม่โฟกัส */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Local CLI อื่นๆ</CardTitle>
          <CardDescription>เช็คว่า codex ติดตั้งบนเครื่องนี้หรือไม่</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {CLI_ITEMS.map((item) => {
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

      <CursorLoginDialog />
    </div>
  );
}
