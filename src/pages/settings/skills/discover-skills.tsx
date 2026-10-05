import { toast, useToastError } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { fetchSkillsFromUrl, foundVia, skillSlug, type Skill, type SkillCandidate } from "@/features/instructions";
import {
  canSearchAhead,
  collectionUrl,
  compactCount,
  FEATURED_COLLECTIONS,
  filterRepos,
  lastUpdated,
  searchSkillRepos,
  throttledFor,
  type FeaturedCollection,
  type SkillRepo,
} from "@/features/skills";
import { searchSmitherySkills, useSmitheryReady, type SmitherySkill } from "@/features/smithery";
import { SmitheryIcon } from "@/components/app/smithery-icon";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/pages/chat/hooks/use-debounced-value";
import {
  CheckIcon,
  ChevronRightIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  StarIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SmitheryCard, SourceBadge } from "../smithery-card";
/** A collection in the list: one the app suggests, or one a search turned up. */
type Collection = {
  /** `owner/repo`. */
  repo: string;
  title: string;
  description: string;
  url: string;
  stars?: number;
  avatar?: string;
  updated?: string;
  official?: boolean;
};

function fromFeatured(item: FeaturedCollection): Collection {
  return { ...item, url: collectionUrl(item) };
}

function fromRepo(repo: SkillRepo): Collection {
  return {
    repo: repo.name,
    title: repo.name.split("/")[1] ?? repo.name,
    description: repo.description,
    url: repo.url,
    stars: repo.stars,
    avatar: repo.avatar,
    updated: repo.updated,
  };
}

/**
 * Browse public skill collections.
 *
 * Skills are published as folders in Git repositories rather than to a
 * registry, so this lists repositories that tag themselves as collections —
 * plus a few the app suggests — and opens each one to show the skills inside.
 */
export function DiscoverSkills({
  query,
  installed,
  onPick,
}: {
  query: string;
  installed: Skill[];
  onPick: (candidates: SkillCandidate[]) => void;
}) {
  const typed = query.trim();
  const search = useDebouncedValue(typed, 600, true);
  /** The popular collections, fetched once and reused to answer as you type. */
  const [browse, setBrowse] = useState<SkillRepo[]>([]);
  const [repos, setRepos] = useState<SkillRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [fromSmithery, setFromSmithery] = useState<SmitherySkill[]>([]);
  const [smitheryError, setSmitheryError] = useState<string | null>(null);
  const smitheryOn = useSmitheryReady();
  useToastError(error, () => setError(null));
  useEffect(() => {
    if (!smitheryError) return;
    toast.warning("Couldn't search Smithery", {
      description: `${smitheryError} The sources below are unaffected.`,
    });
    setSmitheryError(null);
  }, [smitheryError]);

  // Smithery is a separate catalogue with its own key, so it has its own
  // search — and its own failures, which mustn't empty the GitHub results.
  useEffect(() => {
    let live = true;
    if (!smitheryOn) {
      setFromSmithery([]);
      setSmitheryError(null);
      return;
    }
    searchSmitherySkills(search)
      .then((page) => {
        if (!live) return;
        setFromSmithery(page.items);
        setSmitheryError(null);
      })
      .catch((e) => {
        if (!live) return;
        setFromSmithery([]);
        // A key that stopped working has to say so; otherwise Smithery reads
        // as connected and simply has nothing, which is a different problem.
        setSmitheryError(String(e));
      });
    return () => {
      live = false;
    };
  }, [search, smitheryOn]);

  // The popular collections, loaded once however the tab was opened. They
  // are what makes typing feel instant, so they can't wait for an empty box.
  useEffect(() => {
    let live = true;
    searchSkillRepos("")
      .then((found) => live && setBrowse(found.repos))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setRepos([]);
    // One letter matches almost everything; filtering what we have beats
    // spending a search on it.
    if (search.length === 1) return;
    if (search && !canSearchAhead()) {
      setWait(throttledFor());
      return;
    }
    setLoading(true);
    setError(null);
    searchSkillRepos(search)
      .then((found) => {
        if (!live) return;
        setRepos(found.repos);
        setWait(found.waitSeconds ?? 0);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [search]);

  // Count the wait down so the page recovers on its own.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait(throttledFor()), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const suggested = typed ? [] : FEATURED_COLLECTIONS.map(fromFeatured);
  // What we already have answers immediately; a search fills in the rest.
  const local = filterRepos(browse, typed);
  const merged = [...local, ...repos.filter((r) => !local.some((l) => l.name === r.name))];
  const found = merged
    .filter((repo) => !suggested.some((s) => s.repo === repo.name))
    .map(fromRepo);
  const searching = loading || (!!typed && typed !== search);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        Skills live in public Git repositories — there’s no registry for them the way there is for
        connectors. These are repositories on GitHub that publish skills; anyone can, so check who
        wrote one before you install it.
      </p>

      <SmitheryCard what="skills" />

      {fromSmithery.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {typed ? `Skills matching “${typed}”` : "Popular on Smithery"}
          </h3>
          <ul className="flex flex-col divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
            {fromSmithery.map((skill) => (
              <SmitherySkillRow
                key={skill.qualifiedName}
                skill={skill}
                installed={installed}
                onPick={onPick}
              />
            ))}
          </ul>
        </section>
      )}

      {suggested.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Suggested</h3>
          <CollectionList collections={suggested} installed={installed} onPick={onPick} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        {(suggested.length > 0 || fromSmithery.length > 0) && (
          <h3 className="text-sm font-medium text-muted-foreground">Collections on GitHub</h3>
        )}
        {found.length > 0 ? (
          <CollectionList collections={found} installed={installed} onPick={onPick} />
        ) : (
          !searching && (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {typed ? `No skill collections match “${typed}”.` : "Nothing to show."}
            </p>
          )
        )}
        {searching && (
          <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Searching GitHub…
          </p>
        )}
        {wait > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            GitHub only allows a few searches a minute without signing in. Showing what’s already
            loaded — searching again in {wait}s.
          </p>
        )}
      </section>
    </div>
  );
}

function CollectionList({
  collections,
  installed,
  onPick,
}: {
  collections: Collection[];
  installed: Skill[];
  onPick: (candidates: SkillCandidate[]) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
      {collections.map((collection) => (
        <CollectionRow
          key={collection.repo}
          collection={collection}
          installed={installed}
          onPick={onPick}
        />
      ))}
    </ul>
  );
}

/** One repository, which opens to show the skills it holds. */
function CollectionRow({
  collection,
  installed,
  onPick,
}: {
  collection: Collection;
  installed: Skill[];
  onPick: (candidates: SkillCandidate[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useToastError(error, () => setError(null));

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || skills || loading) return;
    setLoading(true);
    setError(null);
    try {
      setSkills(await fetchSkillsFromUrl(collection.url));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (skills ?? []).filter(
    (s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q),
  );
  const have = (candidate: SkillCandidate) =>
    installed.some((s) => skillSlug(s) === skillSlug(candidate));
  const updated = lastUpdated(collection.updated);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => void toggle()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && void toggle()}
        className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
      >
        <ChevronRightIcon
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <Avatar collection={collection} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{collection.title}</span>
            {collection.official && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Official
              </span>
            )}
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
              {collection.repo}
            </span>
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {collection.description || "No description"}
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground md:flex">
          {collection.stars !== undefined && (
            <span className="flex items-center gap-1">
              <StarIcon className="size-3" />
              {compactCount(collection.stars)}
            </span>
          )}
          {updated && <span>{updated}</span>}
        </span>
        {loading && <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      {open && (
        <div className="border-t border-border/40 bg-muted/20 px-3 py-2.5">
          {skills && skills.length > 8 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={`Filter ${skills.length} skills…`}
              aria-label={`Filter skills in ${collection.repo}`}
              className="mb-2 h-8 w-full rounded-lg border bg-background px-2.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          )}
          {skills && (
            <>
              <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {shown.map((candidate) => (
                  <li
                    key={candidate.source}
                    className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-background/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{candidate.name}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {candidate.description || "No “Use when”"}
                      </p>
                    </div>
                    {candidate.files.some((f) => !f.skipped) && (
                      <span className="hidden shrink-0 text-[11px] text-muted-foreground/70 sm:inline">
                        {candidate.files.filter((f) => !f.skipped).length} files
                      </span>
                    )}
                    {have(candidate) ? (
                      <span className="flex w-20 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground">
                        <CheckIcon className="size-3.5" /> Added
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="w-20 shrink-0"
                        onClick={() => onPick([candidate])}
                      >
                        Install
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {shown.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-1 gap-1.5 text-muted-foreground"
                  onClick={() => onPick(shown)}
                >
                  <FolderGit2Icon className="size-3.5" />
                  Review all {shown.length}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One skill from Smithery.
 *
 * Smithery lists a skill by itself rather than by the repository it lives in,
 * so this row installs one directly — by fetching the folder it was published
 * from, which is the same path every other skill takes, files and all.
 */
function SmitherySkillRow({
  skill,
  installed,
  onPick,
}: {
  skill: SmitherySkill;
  installed: Skill[];
  onPick: (candidates: SkillCandidate[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const have = installed.some((s) => skillSlug(s) === skillSlug({ name: skill.name }));
  useToastError(error, () => setError(null));

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      const found = await fetchSkillsFromUrl(skill.gitUrl);
      if (found.length === 0) {
        setError("Smithery points at a folder with no SKILL.md in it.");
        return;
      }
      onPick(foundVia(found, "smithery"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <SmitheryIcon size={28} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{skill.name}</span>
            <SourceBadge source="smithery" />
            {skill.verified && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Verified
              </span>
            )}
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
              {skill.qualifiedName}
            </span>
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {skill.description || "No description"}
          </p>
        </div>
        {skill.stars > 0 && (
          <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground md:flex">
            <StarIcon className="size-3" />
            {compactCount(skill.stars)}
          </span>
        )}
        {have ? (
          <span className="flex w-20 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground">
            <CheckIcon className="size-3.5" /> Added
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-20 shrink-0 gap-1.5"
            disabled={busy}
            onClick={() => void review()}
          >
            {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : "Install"}
          </Button>
        )}
      </div>
    </li>
  );
}

function Avatar({ collection }: { collection: Collection }) {
  const [failed, setFailed] = useState(false);
  if (collection.avatar && !failed) {
    return (
      <img
        src={collection.avatar}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-7 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <FolderGit2Icon className="size-3.5" />
    </span>
  );
}
