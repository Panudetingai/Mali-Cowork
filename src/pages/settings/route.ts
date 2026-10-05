import { useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

/**
 * Settings pages live at `/settings/<tab>/<sub>`: a setup with several steps
 * (a provider, the voice engines, Discover) is a page of its own, so Back
 * and a link both land where they should. Older `?tab=` links still work.
 */
export function useSettingsRoute() {
  const { "*": rest = "" } = useParams();
  const [params] = useSearchParams();
  const [first, ...more] = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const raw = first ?? params.get("tab") ?? "general";
  return {
    tab: raw === "quick" ? "notch" : raw,
    sub: first ? more.join("/") || undefined : undefined,
  };
}

export function settingsPath(tab: string, sub?: string) {
  if (tab === "general" && !sub) return "/settings";
  return `/settings/${encodeURIComponent(tab)}${sub ? `/${sub.split("/").map(encodeURIComponent).join("/")}` : ""}`;
}

/** The sub-page of the open tab, and ways in and out of it. */
export function useSettingsSub() {
  const { tab, sub } = useSettingsRoute();
  const navigate = useNavigate();
  const open = useCallback(
    (next: string, search?: Record<string, string>) =>
      navigate(settingsPath(tab, next) + (search ? `?${new URLSearchParams(search)}` : "")),
    [navigate, tab],
  );
  const back = useCallback(() => navigate(settingsPath(tab)), [navigate, tab]);
  return { sub, open, back };
}
