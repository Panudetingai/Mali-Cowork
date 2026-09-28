import { ConfirmDialog, type ConfirmRequest } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation, type LanguageMode } from "@/features/i18n";
import { Segmented, SectionHeader, SettingRow, SettingsGroup } from "@/pages/settings/ui";
import {
  anythingRunning,
  cacheSize,
  clearCache,
  formatBytes,
  resetEverything,
  resetSettings,
} from "@/lib/app-reset";
import {
  HardDriveIcon,
  LanguagesIcon,
  LoaderIcon,
  MoonIcon,
  PaletteIcon,
  RotateCcwIcon,
  SunIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function GeneralSettings() {
  const { lang, mode, setLanguageMode, t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();

  const languages: { id: LanguageMode; title: string }[] = [
    { id: "auto", title: t("languageAuto") },
    { id: "th", title: t("languageThai") },
    { id: "en", title: t("languageEnglish") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title={t("tabGeneral")} description={t("tabGeneralDesc")} />

      <SettingsGroup title={t("themeSectionTitle")}>
        <SettingRow
          icon={<PaletteIcon />}
          label={t("themeLabel")}
          description={t("themeSectionDesc")}
          control={
            <Segmented
              label={t("themeLabel")}
              value={resolvedTheme === "dark" ? "dark" : "light"}
              onChange={setTheme}
              options={[
                { value: "light", label: t("themeLight"), icon: <SunIcon /> },
                { value: "dark", label: t("themeDark"), icon: <MoonIcon /> },
              ]}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("languageSectionTitle")}
        footer={lang === "th" ? t("fontThaiNotice") : t("fontEnglishNotice")}
      >
        <SettingRow
          icon={<LanguagesIcon />}
          label={t("languageLabel")}
          description={t("languageSectionDesc")}
          control={
            <Select value={mode} onValueChange={(v) => setLanguageMode(v as LanguageMode)}>
              <SelectTrigger className="w-full sm:w-60" aria-label={t("languageLabel")}>
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
        <SettingRow
          label={
            <span className="text-xs font-medium text-muted-foreground">
              {t("currentFontLabel")}: {lang === "th" ? "Sarabun" : "Inter"}
            </span>
          }
        >
          <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-[15px] leading-relaxed">
            {lang === "th"
              ? "ยินดีต้อนรับสู่ Mali Cowork — ทำงานร่วมกับ AI บนเครื่องของคุณ กขคง ๑๒๓๔๕"
              : "Welcome to Mali Cowork — work alongside AI, right on your own files."}
          </p>
        </SettingRow>
      </SettingsGroup>

      <StorageGroup />
    </div>
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
      <ConfirmDialog request={confirm} onClose={() => setConfirm(undefined)} />
    </SettingsGroup>
  );
}
