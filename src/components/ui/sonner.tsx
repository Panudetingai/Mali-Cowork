import {
    CircleAlertIcon,
    CircleCheckIcon,
    InfoIcon,
    Loader2Icon,
    TriangleAlertIcon,
    XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, type CSSProperties } from "react";
import {
    Toaster as Sonner,
    toast as sonnerToast,
    type ExternalToast,
    type ToasterProps,
} from "sonner";
import "sonner/dist/styles.css";

const toastClassNames: NonNullable<ToasterProps["toastOptions"]>["classNames"] = {
  toast:
    "group toast !items-start !gap-3 !rounded-xl !border !bg-card/92 !py-3 !pl-3.5 !pr-10 !font-sans !text-card-foreground !shadow-lg !backdrop-blur-md !backdrop-saturate-150 ring-1 ring-neutral-200/80 dark:!bg-card/88 dark:ring-foreground/10",
  title: "!text-sm !font-medium !leading-snug !text-foreground",
  description: "!text-xs !leading-relaxed !text-muted-foreground",
  content: "!gap-1",
  icon: "!mt-0.5 !size-4 !shrink-0",
  closeButton:
    "!absolute !right-2 !top-2 !left-auto !h-6 !w-6 !translate-none !rounded-md !border-0 !bg-transparent !text-muted-foreground !shadow-none hover:!bg-muted hover:!text-foreground",
  error: "!border-red-500/30 !bg-red-500/12 dark:!bg-red-500/18",
  success: "!border-emerald-500/30 !bg-emerald-500/12 dark:!bg-emerald-500/18",
  warning: "!border-amber-500/30 !bg-amber-500/12 dark:!bg-amber-500/18",
  info: "!border-border !bg-card/92 dark:!bg-card/88",
};

function splitToastMessage(message: string) {
  const dash = message.indexOf(" — ");
  if (dash === -1) return { title: message };
  return { title: message.slice(0, dash), description: message.slice(dash + 3) };
}

/** Bound before we patch `toast.error` — otherwise `Object.assign` causes infinite recursion. */
const sonnerError = sonnerToast.error.bind(sonnerToast);

function toastError(message: Parameters<typeof sonnerToast.error>[0], data?: ExternalToast) {
  if (typeof message === "string") {
    const { title, description } = splitToastMessage(message);
    if (description) return sonnerError(title, { ...data, description });
  }
  return sonnerError(message, data);
}

/** App-wide toasts, following the current theme and Mali surfaces. */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={(resolvedTheme as ToasterProps["theme"]) ?? "system"}
      position="top-center"
      expand
      closeButton
      duration={8_000}
      offset="calc(var(--titlebar-height) + 0.75rem)"
      className="toaster group pointer-events-auto"
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />,
        error: <CircleAlertIcon className="size-4 text-red-600 dark:text-red-400" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
        close: <XIcon className="size-3.5" />,
      }}
      toastOptions={{ classNames: toastClassNames }}
      style={
        {
          "--width": "min(24rem, calc(100vw - 2rem))",
          "--normal-bg": "color-mix(in oklch, var(--card) 90%, transparent)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--toast-close-button-start": "unset",
          "--toast-close-button-end": "0.5rem",
          "--toast-close-button-transform": "none",
        } as CSSProperties
      }
      {...props}
    />
  );
}

export const toast = Object.assign(sonnerToast, { error: toastError });

/** Show a toast once when `error` is set; optional `clear` resets the source. */
export function useToastError(error: string | undefined | null, clear?: () => void) {
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    clearRef.current?.();
  }, [error]);
}

export function toastFailure(title: string, detail?: unknown) {
  if (detail == null || detail === "") {
    toast.error(title);
    return;
  }
  const description = detail instanceof Error ? detail.message : String(detail);
  toast.error(title, { description });
}
