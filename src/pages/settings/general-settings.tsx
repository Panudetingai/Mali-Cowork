import { useTranslation, type LanguageMode } from "@/features/i18n";
import {
  GroupLabel,
  Notice,
  SectionHeader,
  SettingsSection,
} from "@/pages/settings/ui";
import { cn } from "@/lib/utils";
import { CheckIcon, MoonIcon, SunIcon, TypeIcon } from "lucide-react";
import { useTheme } from "next-themes";

export function GeneralSettings() {
  const { lang, mode, setLanguageMode, t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();

  const languageOptions: { id: LanguageMode; title: string; desc: string }[] = [
    {
      id: "auto",
      title: t("languageAuto"),
      desc: lang === "th" ? "ตรวจพบภาษาไทยจากอุปกรณ์ → ใช้ฟอนต์ Sarabun" : "Device language detected → Inter font",
    },
    {
      id: "th",
      title: t("languageThai"),
      desc: "แสดงผลภาษาไทยทั้งหมด พร้อมฟอนต์ Sarabun",
    },
    {
      id: "en",
      title: t("languageEnglish"),
      desc: "Full English interface with Inter font",
    },
  ];

  const themeOptions = [
    { id: "light", label: t("themeLight"), icon: SunIcon },
    { id: "dark", label: t("themeDark"), icon: MoonIcon },
  ];

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title={t("tabGeneral")}
        description={t("tabGeneralDesc")}
      />

      <SettingsSection>
        <GroupLabel>{t("languageSectionTitle")}</GroupLabel>
        <Notice tone="info">
          {lang === "th" ? t("fontThaiNotice") : t("fontEnglishNotice")}
        </Notice>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {languageOptions.map((opt) => {
            const isSelected = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLanguageMode(opt.id)}
                className={cn(
                  "relative flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 text-foreground shadow-xs"
                    : "border-border/60 bg-card hover:border-border hover:bg-accent/40 text-muted-foreground",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-semibold text-sm text-foreground">
                    {opt.title}
                  </span>
                  {isSelected && (
                    <CheckIcon className="size-4 text-primary" strokeWidth={2.5} />
                  )}
                </div>
                <span className="text-xs text-muted-foreground leading-relaxed">
                  {opt.desc}
                </span>
              </button>
            );
          })}
        </div>

        {/* Live Font Sample */}
        <div className="mt-4 rounded-xl border border-border/60 bg-accent/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TypeIcon className="size-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("currentFontLabel")}: {lang === "th" ? "Sarabun" : "Inter Variable"}
            </span>
          </div>
          <p className="text-base text-foreground leading-relaxed font-normal">
            {lang === "th"
              ? "ยินดีต้อนรับสู่ Mali Cowork — ระบบการทำงานร่วมกับ AI อัจฉริยะ (ตัวอย่างแบบอักษร Sarabun กขคง ๑๒๓๔๕)"
              : "Welcome to Mali Cowork — Intelligent AI desktop coworking with local and cloud models."}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection>
        <GroupLabel>{t("themeSectionTitle")}</GroupLabel>
        <p className="text-xs text-muted-foreground mb-3">
          {t("themeSectionDesc")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = resolvedTheme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTheme(opt.id)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-medium transition-all",
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground font-semibold shadow-xs"
                    : "border-border/60 bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
    </div>
  );
}
