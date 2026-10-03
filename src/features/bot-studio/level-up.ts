import { toast } from "@/components/ui/sonner";
import { t, type TranslationKey } from "@/features/i18n";
import { MAX_LEVEL } from "./constants";
import { unlocksAt, type LookPart } from "./look";

const PART_LABEL: Record<LookPart, TranslationKey> = {
  color: "botStudioPartColor",
  eyes: "botStudioPartEyes",
  mouth: "botStudioPartMouth",
  shape: "botStudioPartShape",
  ears: "botStudioPartEars",
  blush: "botStudioPartBlush",
  move: "botStudioPartMove",
  color2: "botStudioPartColor2",
  eyeInk: "botStudioPartEyeInk",
};

export function partLabel(part: LookPart) {
  return t(PART_LABEL[part]);
}

/** A bot grew: say so, with what it can wear now. */
export function announceLevelUp(name: string, from: number, to: number) {
  const opened: LookPart[] = [];
  for (let level = from + 1; level <= to; level++) opened.push(...unlocksAt(level));
  const description = opened.length
    ? t("botStudioUnlocked", { parts: opened.map(partLabel).join(", ") })
    : to >= MAX_LEVEL
      ? t("botStudioFullyGrown")
      : undefined;
  toast.success(t("botStudioLevelUp", { name, level: to }), { description });
}
