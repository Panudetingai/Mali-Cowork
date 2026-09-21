/**
 * Skill collections worth starting from.
 *
 * Skills have no registry the way MCP servers do — they are published as
 * folders in Git repositories. Discover searches GitHub for repositories that
 * tag themselves as skill collections; this short list is what the app
 * suggests before anyone has searched for anything.
 *
 * Everything here is someone else's public repository, so it is a starting
 * point rather than an endorsement. Each skill's text is shown before it is
 * installed, and its files are listed.
 */
export type FeaturedCollection = {
  /** `owner/repo` on GitHub. */
  repo: string;
  title: string;
  description: string;
  /** Where the skills live, when they aren't at the repository's root. */
  dir?: string;
  /** Called out as maintained by the people behind the tool. */
  official?: boolean;
};

export const FEATURED_COLLECTIONS: FeaturedCollection[] = [
  {
    repo: "anthropics/skills",
    title: "Anthropic skills",
    description: "The reference collection: documents, spreadsheets, slides, PDFs, design and more.",
    dir: "skills",
    official: true,
  },
  {
    repo: "obra/superpowers",
    title: "Superpowers",
    description: "A development method as skills: brainstorming, planning, writing and finishing work.",
    dir: "skills",
  },
  {
    repo: "K-Dense-AI/scientific-agent-skills",
    title: "Scientific agent skills",
    description: "Research work — bioinformatics, chemistry, statistics and scientific writing.",
    dir: "skills",
  },
];

/** The link Discover hands to the importer for a collection. */
export function collectionUrl({ repo, dir }: Pick<FeaturedCollection, "repo" | "dir">) {
  return dir ? `https://github.com/${repo}/tree/HEAD/${dir}` : `https://github.com/${repo}`;
}
