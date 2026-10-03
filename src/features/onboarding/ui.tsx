import { cn } from "@/lib/utils";
import { Codex, Cursor, GeminiCLI as AntigravityCLI, OpenCode, Github } from "@lobehub/icons";
import { HexagonIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode, type SVGProps } from "react";
import type { AgentChoice } from "./catalog";
import type { ToolId } from "./api";

export type BrandIconProps = {
  size?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "width" | "height">;

function brandSvgProps({ size = 18, className, ...rest }: BrandIconProps): SVGProps<SVGSVGElement> {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 100 100",
    width: size,
    height: size,
    className: cn("shrink-0", className),
    ...rest,
  };
}

/** Heading and one-line explanation at the top of each step. */
export function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {children && <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}

export function AgentIcon({ id, size = 28 }: { id: AgentChoice["id"]; size?: number }) {
  const Icon = { opencode: OpenCode, codex: Codex, antigravity: AntigravityCLI, cursor: Cursor }[id];
  return <Icon size={size} />;
}

export function ToolIcon({ id, size = 18 }: { id: ToolId; size?: number }) {
  if (id === "opencode" || id === "codex" || id === "antigravity" || id === "cursor") {
    return <AgentIcon id={id} size={size + 4} />;
  }

  const className = "shrink-0";
  switch (id) {
    case "node":
      return <NodeJs size={size} className={className} />;
    case "git":
      return <Github size={size} className={className} />;
    case "brew":
      return <HomebrewIcon size={size} className={className} />;
    case "uv":
      return <Uv size={size} className={className} />;
    case "winget":
      return <WingetIcon size={size} className={className} />;
    default:
      return (
        <HexagonIcon
          className={cn("text-muted-foreground", className)}
          size={size}
          strokeWidth={2}
        />
      );
  }
}

/** Children fade and rise in one after another. */
export function Stagger({ children, className, delay = 0.06 }: { children: ReactNode[]; className?: string; delay?: number }) {
  return (
    <div className={className}>
      {children.map((child, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * delay, duration: 0.28, ease: "easeOut" }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}

/** An installer's live output, following the newest line. */
export function Terminal({ lines, className }: { lines: string[]; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <pre
      ref={ref}
      className={cn(
        "max-h-40 select-text overflow-auto rounded-xl bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300",
        className,
      )}
    >
      {lines.length ? lines.join("\n") : "Starting…"}
    </pre>
  );
}

/** A command shown before it runs, in the same dark box as the log. */
export function CommandLine({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto whitespace-pre rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-emerald-300">
      <span className="select-none text-zinc-500">$ </span>
      {children}
    </code>
  );
}

export function HomebrewIcon(props: BrandIconProps) {
  const uid = useId().replace(/:/g, "");
  const clipA = `homebrew-a-${uid}`;
  const clipB = `homebrew-b-${uid}`;

  return (
    <svg {...brandSvgProps(props)}>
      <g clipPath={`url(#${clipA})`}>
        <g clipPath={`url(#${clipB})`}>
          <path
            fill="#d1d3d4"
            fillRule="evenodd"
            stroke="#000"
            strokeLinejoin="round"
            strokeWidth="1.768"
            d="M44.506 18.571c.273-8.667-2.647-13.776-11.04-17.152-2.385 8.345 7.463 16.04 11.04 17.152Z"
            clipRule="evenodd"
          />
          <path
            fill="#d1d3d4"
            fillRule="evenodd"
            stroke="#000"
            strokeLinejoin="round"
            strokeWidth="1.768"
            d="M67.267 33.259c.273-7.117-1.525-9.989-2.874-12.043-1.368-1.916-4.653-4.927-8.687-5.053-3.816-.12-4.734 1.99-8.254 2.117-.578-6.41 4.26-9.928 4.26-9.928s-1.322-1.87-2.417-2.327c-1.574 1.4-5.907 6.065-4.904 12.07-3.24-.62-5.526-2.473-8.928-1.804-4.636.912-8.457 3.715-10.635 9.865s.769 13.325 1.41 15.374 5.381 10.761 9.097 12.043c3.714 1.283 3.715.705 5.701-.063 1.987-.77 4.997-2.178 9.418-.576 4.419 1.6 4.995 1.984 7.75.191s6.342-7.366 7.174-8.968c.833-1.601 1.281-2.434 1.538-3.267 2.678-1.336.105-1.253.35-7.631Z"
            clipRule="evenodd"
          />
          <path
            fill="#fff"
            stroke="#000"
            strokeLinejoin="round"
            strokeWidth="1.768"
            d="M74.46 85.27a6.64 6.64 0 0 0 6.665-6.641V54.705a6.64 6.64 0 0 0-6.642-6.642h-5.475a1.476 1.476 0 0 1-1.476-1.476v-3.48H24.348l.108 51.001a1.48 1.48 0 0 0 .683 1.242c1.923 1.114 8.09 3.229 21.035 3.229 13.22 0 19.129-2.832 20.82-4.11a1.47 1.47 0 0 0 .531-1.13c.007-1.412.007-4.682.007-6.614a1.474 1.474 0 0 1 1.507-1.476c1.624.023 3.57.026 5.42.021Zm-6.928-29.449a1.847 1.847 0 0 1 1.845-1.845h4.7a1.847 1.847 0 0 1 1.846 1.845v21.47a1.847 1.847 0 0 1-1.846 1.846h-4.7a1.847 1.847 0 0 1-1.845-1.845z"
          />
          <path
            fill="#fbb040"
            fillRule="evenodd"
            d="M28.605 42.68v45.75c0 .528.282 1.016.739 1.28 1.867.89 7.285 3.014 16.784 3.014 9.561 0 14.818-2.581 16.578-3.645a1.47 1.47 0 0 0 .674-1.236c.004-6.067.004-45.164.004-45.164z"
            clipRule="evenodd"
          />
          <path stroke="#ffdb96" strokeLinecap="round" strokeWidth="4.067" d="M33.717 50.429v35.356" />
          <path
            fill="#fff"
            fillRule="evenodd"
            stroke="#000"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.768"
            d="M53.367 52.068c0-.738-.434-1.62-1.148-2.062a6.18 6.18 0 0 1-2.561-3.063c-9.443.318-18.062-1.34-22.405-2.511a36 36 0 0 0-3.384-.786c-2.599-.516-4.574-2.798-4.574-5.542a5.59 5.59 0 0 1 5.39-5.582c.578-3.194 3.366-5.62 6.727-5.62a6.843 6.843 0 0 1 6.843 6.844c0 .795-.144 1.556-.393 2.267l.02.004a6.55 6.55 0 0 1 6.235-4.553 6.55 6.55 0 0 1 6.217 4.505 7.116 7.116 0 0 1 13.864-2.868l.62-.16a5.59 5.59 0 0 1 8.333 4.87c0 2.828-2.1 5.165-4.826 5.538a8.2 8.2 0 0 0-1.804.469 45 45 0 0 1-4.951 1.535 6.2 6.2 0 0 1-.705 2.299 7.65 7.65 0 0 0-.878 4.154l.003.63c0 1.83-1.482 2.943-3.312 2.943a3.31 3.31 0 0 1-3.31-3.311"
            clipRule="evenodd"
          />
        </g>
      </g>
      <defs>
        <clipPath id={clipA}>
          <path fill="#fff" d="M0 0h100v100H0z" />
        </clipPath>
        <clipPath id={clipB}>
          <path fill="#fff" d="M17 0h66.421v100H17z" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function NodeJs(props: BrandIconProps) {
  const uid = useId().replace(/:/g, "");
  const gradA = `node-a-${uid}`;
  const gradB = `node-b-${uid}`;
  const gradC = `node-c-${uid}`;

  return (
    <svg {...brandSvgProps(props)}>
      <path
        fill={`url(#${gradA})`}
        d="M52.311.644a4.74 4.74 0 0 0-4.715 0L8.674 23.249c-1.48.838-2.312 2.418-2.312 4.094v45.303c0 1.674.924 3.256 2.31 4.094l38.923 22.605a4.74 4.74 0 0 0 4.715 0l38.922-22.606c1.48-.837 2.311-2.419 2.311-4.094V27.343c0-1.675-.924-3.255-2.31-4.094z"
      />
      <path
        fill={`url(#${gradB})`}
        d="M91.326 23.25 52.219.643a6.3 6.3 0 0 0-1.202-.465L7.195 75.623c.363.445.801.823 1.295 1.117l39.107 22.605c1.109.65 2.403.837 3.605.464l41.14-75.722a2.9 2.9 0 0 0-1.016-.838"
      />
      <path
        fill={`url(#${gradC})`}
        d="M91.327 76.739c1.109-.651 1.941-1.768 2.31-2.977L50.834.085c-1.11-.186-2.312-.093-3.328.558L8.675 23.156l41.88 76.84a6.5 6.5 0 0 0 1.758-.56z"
      />
      <defs>
        <linearGradient id={gradA} x1="65.804" x2="30.258" y1="17.478" y2="89.541" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3f873f" />
          <stop offset=".33" stopColor="#3f8b3d" />
          <stop offset=".637" stopColor="#3e9638" />
          <stop offset=".934" stopColor="#3da92e" />
          <stop offset="1" stopColor="#3dae2b" />
        </linearGradient>
        <linearGradient id={gradB} x1="44.039" x2="143.216" y1="55.285" y2="-17.541" gradientUnits="userSpaceOnUse">
          <stop offset=".138" stopColor="#3f873f" />
          <stop offset=".402" stopColor="#52a044" />
          <stop offset=".713" stopColor="#64b749" />
          <stop offset=".908" stopColor="#6abf4b" />
        </linearGradient>
        <linearGradient id={gradC} x1="4.937" x2="95" y1="49.98" y2="49.98" gradientUnits="userSpaceOnUse">
          <stop offset=".092" stopColor="#6abf4b" />
          <stop offset=".287" stopColor="#64b749" />
          <stop offset=".598" stopColor="#52a044" />
          <stop offset=".862" stopColor="#3f873f" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Uv(props: BrandIconProps) {
  const uid = useId().replace(/:/g, "");
  const clipA = `uv-a-${uid}`;

  return (
    <svg {...brandSvgProps(props)}>
      <g clipPath={`url(#${clipA})`}>
        <path
          fill="#de5fe9"
          d="m0 .44.21 49.79.168 39.832c.024 5.5 4.5 9.94 10 9.916l39.831-.168 24.896-.104 2.53-.011c5.484-.024 9.917-4.568 9.917-10.052h4.561V99.6H100L99.58.02 53.773.214l.193 39.686v24.849h-8.159L46 39.932 45.807.247z"
        />
      </g>
      <defs>
        <clipPath id={clipA}>
          <path fill="#fff" d="M0 0h100v100H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

/** Windows Package Manager (winget) mark — simplified tile grid. */
export function WingetIcon(props: BrandIconProps) {
  return (
    <svg {...brandSvgProps(props)}>
      <rect width="100" height="100" rx="18" fill="#0078D4" />
      <rect x="22" y="22" width="24" height="24" rx="4" fill="#fff" />
      <rect x="54" y="22" width="24" height="24" rx="4" fill="#fff" opacity="0.85" />
      <rect x="22" y="54" width="24" height="24" rx="4" fill="#fff" opacity="0.85" />
      <rect x="54" y="54" width="24" height="24" rx="4" fill="#fff" opacity="0.7" />
    </svg>
  );
}
