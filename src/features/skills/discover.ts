import { invoke } from "@tauri-apps/api/core";

/** A public repository that publishes skills. */
export type SkillRepo = {
  /** `owner/repo`, which is also its identity in the UI. */
  name: string;
  owner: string;
  description: string;
  url: string;
  stars: number;
  avatar?: string;
  topics: string[];
  /** ISO date of the last push, so a stale collection reads as one. */
  updated?: string;
};

/** What the backend reports for one search (see `storage/skills/discover`). */
type SkillSearch = {
  repos: SkillRepo[];
  /** Searches left this minute, as GitHub last reported it. */
  remaining?: number;
  /** Seconds until GitHub will answer again; set only when it refused. */
  retryAfter?: number;
};

export type SearchResult = {
  repos: SkillRepo[];
  /** Seconds to wait, while GitHub is refusing to search. */
  waitSeconds?: number;
};

/**
 * Searching GitHub without a token is allowed ten times a minute, and every
 * keystroke would happily spend one. So:
 *
 * - results already fetched are kept for the session and answered from memory;
 * - searching stops a little short of the limit, so a minute rarely ends with
 *   GitHub refusing outright;
 * - once it does refuse, nothing is sent until it says it will answer again.
 *
 * None of this stops the page working: the caller filters what it already has
 * (see `filterRepos`), so typing stays useful even with no budget left.
 */
const cache = new Map<string, Promise<SkillRepo[]>>();

/** When GitHub said to come back, as a timestamp. */
let blockedUntil = 0;
/** Searches left this minute, as last reported; unknown until the first one. */
let remaining = Number.POSITIVE_INFINITY;

/** Stop this far short of the limit, rather than running into it. */
const RESERVE = 2;

/**
 * Forget every search made this session, and any wait in force.
 *
 * Results are kept for as long as the app is open, which is right while
 * someone is browsing but wrong if they come back much later — and tests need
 * each case to start from nothing.
 */
export function forgetSearches() {
  cache.clear();
  blockedUntil = 0;
  remaining = Number.POSITIVE_INFINITY;
}

/** Seconds until GitHub will answer again, or 0 when it will answer now. */
export function throttledFor(): number {
  return Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
}

/** Whether there is budget to spend on a search, with a little kept spare. */
export function canSearchAhead(): boolean {
  return throttledFor() === 0 && remaining > RESERVE;
}

/**
 * Search GitHub for skill collections, most-starred first. An empty query
 * browses the popular ones.
 *
 * Never throws for being throttled — it says how long to wait instead, so the
 * caller can keep showing what it has.
 */
export async function searchSkillRepos(query: string): Promise<SearchResult> {
  const key = query.trim().toLowerCase();

  const known = cache.get(key);
  if (known) return { repos: await known };

  const wait = throttledFor();
  if (wait > 0) return { repos: [], waitSeconds: wait };

  let refusedFor = 0;
  const pending = invoke<SkillSearch>("skills_search_repos", { query: key }).then((found) => {
    if (typeof found.remaining === "number") remaining = found.remaining;
    if (found.retryAfter) {
      blockedUntil = Date.now() + found.retryAfter * 1000;
      refusedFor = found.retryAfter;
      // A refusal may still carry one topic's results. They're incomplete, so
      // show them but don't remember them as the answer for this query.
      cache.delete(key);
    }
    return found.repos;
  });

  // Hold the promise, not the result, so a second caller waits rather than
  // spending another search on the same words.
  cache.set(key, pending);
  try {
    const repos = await pending;
    return refusedFor ? { repos, waitSeconds: refusedFor } : { repos };
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

/** Match a query against repositories already in hand, ranking name first. */
export function filterRepos(repos: SkillRepo[], query: string): SkillRepo[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  const words = q.split(/\s+/);
  return repos
    .map((repo) => {
      const name = repo.name.toLowerCase();
      const haystack = `${name} ${repo.description} ${repo.topics.join(" ")}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return null;
      return { repo, score: name.includes(q) ? 2 : 1 };
    })
    .filter((hit): hit is { repo: SkillRepo; score: number } => !!hit)
    .sort((a, b) => b.score - a.score || b.repo.stars - a.repo.stars)
    .map((hit) => hit.repo);
}

/** How long ago a repository was last pushed to, in plain words. */
export function lastUpdated(iso?: string): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** `1234` → `1.2k`, for a star count that has to fit in a row. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
