import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { CheckIcon, GlobeIcon } from "lucide-react";

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, mode, setLanguageMode } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80",
            className,
          )}
          title="Switch language / เปลี่ยนภาษา"
          aria-label="Switch language"
        >
          <GlobeIcon className="size-3.5" strokeWidth={1.75} />
          <span className="uppercase font-semibold tracking-wider text-[11px]">
            {lang}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="z-50 w-52 rounded-xl border border-border/60 bg-popover/95 p-1 backdrop-blur-md text-popover-foreground shadow-xl"
      >
        <div className="px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/70">
          Language / ภาษา
        </div>
        <DropdownMenuItem
          className="flex cursor-default items-center justify-between rounded-lg px-2 py-1.5 text-xs outline-none select-none hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          onSelect={() => setLanguageMode("th")}
        >
          <div className="flex flex-col">
            <span className="font-medium">ภาษาไทย</span>
            <span className="text-[10px] text-muted-foreground">ฟอนต์ TH Sarabun</span>
          </div>
          {lang === "th" && mode === "th" && <CheckIcon className="size-3.5 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex cursor-default items-center justify-between rounded-lg px-2 py-1.5 text-xs outline-none select-none hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          onSelect={() => setLanguageMode("en")}
        >
          <div className="flex flex-col">
            <span className="font-medium">English</span>
            <span className="text-[10px] text-muted-foreground">Inter font</span>
          </div>
          {lang === "en" && mode === "en" && <CheckIcon className="size-3.5 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuItem
          className="flex cursor-default items-center justify-between rounded-lg px-2 py-1.5 text-xs outline-none select-none hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          onSelect={() => setLanguageMode("auto")}
        >
          <div className="flex flex-col">
            <span className="font-medium">System Default (อัตโนมัติ)</span>
            <span className="text-[10px] text-muted-foreground">
              ตามภาษาของอุปกรณ์ ({lang.toUpperCase()})
            </span>
          </div>
          {mode === "auto" && <CheckIcon className="size-3.5 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
