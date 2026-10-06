import { ConfirmDialog, type ConfirmRequest } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useTranslation, type LanguageMode } from "@/features/i18n";
import {
    anythingRunning,
    cacheSize,
    clearCache,
    formatBytes,
    resetEverything,
    resetSettings,
} from "@/lib/app-reset";
import { cn } from "@/lib/utils";
import { SectionHeader, SettingRow, SettingsGroup, SettingsPage } from "@/pages/settings/ui";
import {
    CheckIcon,
    HardDriveIcon,
    LanguagesIcon,
    LoaderIcon,
    MoonIcon,
    RotateCcwIcon,
    SunIcon,
    TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";

export function GeneralSettings() {
  const { lang, mode, setLanguageMode, t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();

  const languages: { id: LanguageMode; title: string }[] = [
    { id: "auto", title: t("languageAuto") },
    { id: "th", title: t("languageThai") },
    { id: "en", title: t("languageEnglish") },
  ];

  return (
    <SettingsPage>
      <SectionHeader title={t("tabGeneral")} description={t("tabGeneralDesc")} />

      <SettingsGroup title={t("themeSectionTitle")} description={t("themeSectionDesc")}>
        <div className="grid grid-cols-2 gap-3 py-3.5 sm:max-w-md" role="radiogroup" aria-label={t("themeLabel")}>
          <ThemeCard dark={false} label={t("themeLight")} icon={<SunIcon />} on={resolvedTheme !== "dark"} onPick={() => setTheme("light")} />
          <ThemeCard dark label={t("themeDark")} icon={<MoonIcon />} on={resolvedTheme === "dark"} onPick={() => setTheme("dark")} />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("languageSectionTitle")} description={t("languageSectionDesc")}>
        <SettingRow
          icon={<LanguagesIcon />}
          label={t("languageLabel")}
          control={
            <Select value={mode} onValueChange={(v) => setLanguageMode(v as LanguageMode)}>
              <SelectTrigger className="w-full sm:w-52" aria-label={t("languageLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {languages.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <div className="flex flex-col gap-3 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("currentFontLabel")}: {lang === "th" ? "Sarabun" : "Inter"}
            </span>
            <span className="text-xs text-muted-foreground">{lang === "th" ? t("fontThaiNotice") : t("fontEnglishNotice")}</span>
          </div>
          <div className="flex items-center gap-5">
            <span className="text-5xl leading-none font-semibold tracking-tight text-foreground/90">{lang === "th" ? "กข" : "Aa"}</span>
            <p className="min-w-0 text-[15px] leading-relaxed text-foreground/80">
              {lang === "th"
                ? "ยินดีต้อนรับสู่ Mali Cowork — ทำงานร่วมกับ AI บนเครื่องของคุณ ๑๒๓๔๕"
                : "Welcome to Mali Cowork — work alongside AI, right on your own files."}
            </p>
          </div>
        </div>
      </SettingsGroup>

      <StorageGroup />
    </SettingsPage>
  );
}

/** A small picture of the app in a theme, to pick it by how it looks. */
function ThemeCard({
  dark,
  label,
  icon,
  on,
  onPick,
}: {
  dark: boolean;
  label: string;
  icon: ReactNode;
  on: boolean;
  onPick: () => void;
}) {
  const c = dark
    ? { bg: "#141416", side: "#1c1c20", line: "#2c2c32", text: "#3a3a42", accent: "#8b5cf6" }
    : { bg: "#ffffff", side: "#f4f4f6", line: "#e6e6ea", text: "#d4d4da", accent: "#7c3aed" };
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className="group flex flex-col gap-2 text-left outline-none"
    >
      <span
        className={cn(
          "relative block aspect-[16/10] w-full overflow-hidden rounded-xl border transition-[border-color,box-shadow]",
          on
            ? "border-primary ring-2 ring-primary/30"
            : "border-border group-hover:border-foreground/30 group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
        )}
        style={{ background: c.bg }}
      >
        {/* The app, in miniature: sidebar, a title and a few lines. */}
        <span className="absolute inset-y-0 left-0 w-[28%] border-r" style={{ background: c.side, borderColor: c.line }}>
          <span className="mx-2 mt-2.5 block h-1.5 w-3/5 rounded-full" style={{ background: c.text }} />
          <span className="mx-2 mt-1.5 block h-1.5 w-4/5 rounded-full" style={{ background: c.accent, opacity: 0.55 }} />
          <span className="mx-2 mt-1.5 block h-1.5 w-2/3 rounded-full" style={{ background: c.text }} />
        </span>
        <span className="absolute top-3 right-3 left-[34%] flex flex-col gap-1.5">
          <span className="block h-2 w-1/2 rounded-full" style={{ background: c.text }} />
          <span className="block h-1.5 w-full rounded-full" style={{ background: c.line }} />
          <span className="block h-1.5 w-5/6 rounded-full" style={{ background: c.line }} />
        </span>
        <span className="absolute right-3 bottom-2.5 left-[34%] block h-3.5 rounded-md border" style={{ borderColor: c.line, background: c.side }} />
      </span>
      <span className="flex items-center gap-1.5 px-0.5 text-[13px] font-medium [&_svg]:size-3.5">
        {icon}
        {label}
        {on && <CheckIcon className="ml-auto text-primary" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** Clear the cache, reset settings, or restore to a fresh install. */
function StorageGroup() {
  const { t } = useTranslation();
  const [size, setSize] = useState<number>();
  const [busy, setBusy] = useState<"cache" | "reset">();
  const [confirm, setConfirm] = useState<ConfirmRequest>();

  const measure = () => void cacheSize().then(setSize, () => setSize(undefined));
  useEffect(measure, []);

  const fail = (error: unknown) =>
    toast.error(t("resetFailed"), { description: error instanceof Error ? error.message : String(error) });

  const onClear = async () => {
    setBusy("cache");
    try {
      const freed = await clearCache();
      toast.success(t("cacheCleared"), { description: t("cacheClearedDesc", { size: formatBytes(freed) }) });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(undefined);
      measure();
    }
  };

  /** Ask first; a reset would cut off an agent that's still working. */
  const askReset = (request: Omit<ConfirmRequest, "onConfirm">, reset: () => Promise<void>) => {
    if (anythingRunning()) {
      toast.warning(t("resetRunningBlocked"), { description: t("resetRunningBlockedDesc") });
      return;
    }
    setConfirm({
      ...request,
      destructive: true,
      onConfirm: () => {
        setBusy("reset");
        // The app restarts on success, so only a failure comes back here.
        reset().catch((error) => {
          setBusy(undefined);
          fail(error);
        });
      },
    });
  };

  return (
    <>
    <SettingsGroup title={t("storageSectionTitle")}>
      <SettingRow
        icon={<HardDriveIcon />}
        label={t("clearCacheLabel")}
        description={t("clearCacheDesc")}
        control={
          <>
            {size !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("cacheSizeLabel", { size: formatBytes(size) })}
              </span>
            )}
            <Button variant="outline" size="sm" disabled={!!busy || size === 0} onClick={() => void onClear()}>
              {busy === "cache" && <LoaderIcon className="animate-spin" />}
              {t("clearCacheButton")}
            </Button>
          </>
        }
      />
    </SettingsGroup>
    <SettingsGroup
      danger
      title="Danger zone"
      description="These can’t be undone. Your chats and files in your folders are kept unless you reset everything."
    >
      <SettingRow
        icon={<RotateCcwIcon />}
        label={t("resetSettingsLabel")}
        description={t("resetSettingsDesc")}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              askReset(
                {
                  title: t("resetSettingsConfirmTitle"),
                  description: t("resetSettingsConfirmDesc"),
                  confirmLabel: t("resetSettingsLabel"),
                },
                resetSettings,
              )
            }
          >
            {t("resetSettingsButton")}
          </Button>
        }
      />
      <SettingRow
        icon={<TriangleAlertIcon className="text-destructive" />}
        label={t("resetEverythingLabel")}
        description={t("resetEverythingDesc")}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() =>
              askReset(
                {
                  title: t("resetEverythingConfirmTitle"),
                  description: t("resetEverythingConfirmDesc"),
                  confirmLabel: t("resetEverythingLabel"),
                },
                resetEverything,
              )
            }
          >
            {busy === "reset" && <LoaderIcon className="animate-spin" />}
            {t("resetEverythingButton")}
          </Button>
        }
      />
    </SettingsGroup>
    <ConfirmDialog request={confirm} onClose={() => setConfirm(undefined)} />
    </>
  );
}
