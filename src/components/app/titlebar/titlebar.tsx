import { useSidebar } from "@/components/animate-ui/components/radix/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    ChevronLeft,
    ChevronRight,
    Copy,
    Minus,
    Monitor,
    Share,
    Square,
    X,
} from "lucide-react";
import { useEffect, useState } from "react";

function isTauri() {
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const { state, setOpen, open } = useSidebar();
  const isCollapsed = state === "collapsed";

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    win
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => {});
    const unlisten = win.onResized(async () => {
      setIsMaximized(await win.isMaximized());
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.log("minimize (browser preview):", e);
      if (!isTauri()) alert("Minimize — ใช้ได้เฉพาะใน Tauri (bun tauri dev)");
    }
  };
  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      const max = await win.isMaximized();
      if (max) await win.unmaximize();
      else await win.maximize();
    } catch (e) {
      console.log("maximize (browser preview):", e);
      setIsMaximized((v) => !v);
      if (!isTauri()) alert("Maximize — ใช้ได้เฉพาะใน Tauri");
    }
  };
  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      console.log("close (browser preview):", e);
      if (!isTauri()) alert("Close — ใช้ได้เฉพาะใน Tauri");
    }
  };

  return (
    <div
      className={cn(
        "relative z-50 flex h-(--titlebar-height) w-full shrink-0 select-none items-stretch",
        !isMaximized && "rounded-t-(--window-radius)",
      )}
      style={{ height: "var(--titlebar-height)" }}
    >
      {/* โซน sidebar — สีเดียวกับ sidebar ด้านล่าง */}
      <div
        className={cn(
          "flex shrink-0 justify-center items-center gap-2 border-r border-sidebar-border bg-sidebar px-3 transition-[width] duration-400 ease-[cubic-bezier(0.75,0,0.25,1)]",
          isCollapsed ? "w-(--sidebar-width-icon)" : "w-(--sidebar-width)",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Toggle Sidebar"
          onClick={() => setOpen(!open)}
        >
          {isCollapsed ? (
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="size-4" strokeWidth={1.75} />
          )}
        </Button>
      </div>

      {/* โซน content — drag + title */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-2 border-b border-border bg-background px-4"
      >
        <img src="/icon.ico" alt="logo" className="size-6" />
        <span className="truncate text-sm font-medium text-foreground">
          Mali Cowork
        </span>
      </div>

      {/* ปุ่มควบคุมหน้าต่าง */}
      <div className="relative z-50 flex shrink-0 items-center border-b border-border bg-background">
        <div className="mr-1 flex items-center gap-0.5 px-1">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Share"
            title="Share"
            onClick={() => console.log("share")}
          >
            <Share className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Pop out"
            title="Pop out"
            onClick={() => console.log("popout")}
          >
            <Monitor className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex h-full">
          <button
            type="button"
            onClick={handleMinimize}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80"
            aria-label="Minimize"
          >
            <Minus className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80"
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <Copy className="size-3" strokeWidth={1.75} />
            ) : (
              <Square className="size-3" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white active:bg-destructive/90"
            aria-label="Close"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
