import { cn } from "@/lib/utils";
import { Claude, Codex, Cursor, Gemini, Github, GithubCopilot } from "@lobehub/icons";
import { useEffect, useState, type ComponentType } from "react";
import { gitApi } from "./api";
import type { GitPerson } from "./types";

/**
 * Agents that sign commits as co-authors get their brand mark, the way
 * GitHub shows them.
 */
const AGENTS: [RegExp, ComponentType<{ size: number }>][] = [
  [/cursor/i, Cursor.Avatar],
  [/claude|anthropic/i, Claude.Avatar],
  [/codex|openai/i, Codex.Avatar],
  [/gemini/i, Gemini.Avatar],
  [/copilot/i, GithubCopilot.Avatar],
  [/github-actions|dependabot|\[bot\]/i, Github.Avatar],
];

/** Where each email's picture turned out to be; `null` when none was found. */
const found = new Map<string, string | null>();

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** GitHub avatars per folder, fetched once while the app runs. */
const githubAvatars = new Map<string, Promise<Record<string, string>>>();

/** Email → GitHub avatar for the repository's commit authors. */
export function useGithubAvatars(folder: string) {
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  useEffect(() => {
    let request = githubAvatars.get(folder);
    if (!request) {
      request = gitApi.avatars(folder).catch(() => ({}));
      githubAvatars.set(folder, request);
    }
    let cancelled = false;
    void request.then((map) => !cancelled && setAvatars(map));
    return () => {
      cancelled = true;
    };
  }, [folder]);
  return avatars;
}

/**
 * Pictures to try, in order:
 * 1. The account GitHub says made the person's commits.
 * 2. GitHub's no-reply address names the account directly.
 * 3. Gravatar identicon, by a hash of the email (always returns a unique image).
 */
async function candidates(email: string, github?: string): Promise<string[]> {
  const address = email.trim().toLowerCase();
  const urls = github ? [github] : [];
  if (!address.includes("@")) return urls;
  const noreply = address.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
  if (noreply) {
    urls.push(
      noreply[1]
        ? `https://avatars.githubusercontent.com/u/${noreply[1]}?s=80`
        : `https://github.com/${encodeURIComponent(noreply[2])}.png?size=80`,
    );
  }
  urls.push(`https://www.gravatar.com/avatar/${await sha256(address)}?s=80&d=identicon`);
  return urls;
}

function hue(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

/** A person's picture: agent logo, GitHub or Gravatar photo, else initials. */
export function Avatar({ person, size = 20, github }: { person: GitPerson; size?: number; github?: string }) {
  const Agent = AGENTS.find(([pattern]) => pattern.test(person.name) || pattern.test(person.email))?.[1];
  const key = person.email.trim().toLowerCase();
  const [urls, setUrls] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (Agent || found.has(key)) return;
    let cancelled = false;
    void candidates(person.email, github).then((list) => !cancelled && setUrls(list));
    return () => {
      cancelled = true;
    };
  }, [Agent, key, person.email, github]);

  const ring = "shrink-0 overflow-hidden rounded-full ring-2 ring-background";
  if (Agent) {
    return (
      <span className={cn(ring, "flex")} title={person.name} style={{ width: size, height: size }}>
        <Agent size={size} />
      </span>
    );
  }

  const known = found.get(key);
  const src = known === undefined ? urls[index] : (known ?? undefined);
  const fallback = (
    <span
      title={person.name}
      className={cn(ring, "flex items-center justify-center font-semibold text-white")}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(person.name)} 55% 48%)` }}
    >
      {initials(person.name)}
    </span>
  );
  if (!src) return fallback;
  return (
    <span className={cn(ring, "relative")} style={{ width: size, height: size }} title={person.name}>
      {/* Initials underneath until the picture arrives. */}
      <span className="absolute inset-0">{fallback}</span>
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="absolute inset-0 size-full object-cover"
        onLoad={() => found.set(key, src)}
        onError={() => {
          if (index + 1 < urls.length) setIndex(index + 1);
          else {
            found.set(key, null);
            setIndex(urls.length);
          }
        }}
      />
    </span>
  );
}

/** Overlapping avatars for a commit's author and co-authors. */
export function Avatars({
  people,
  github,
  size = 20,
}: {
  people: GitPerson[];
  /** From `useGithubAvatars`. */
  github: Record<string, string>;
  size?: number;
}) {
  return (
    <span className="flex shrink-0">
      {people.slice(0, 3).map((person, i) => (
        <span key={person.email + i} className={cn(i > 0 && "-ml-1.5")}>
          <Avatar person={person} github={github[person.email.trim().toLowerCase()]} size={size} />
        </span>
      ))}
    </span>
  );
}
