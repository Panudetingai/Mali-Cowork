/**
 * Reasoning effort: how long a model is allowed to think before it answers.
 *
 * Which levels exist is the *model's* business, not ours — `gpt-5.2` takes
 * none…xhigh, Claude takes low…max, the Antigravity CLI takes three, and
 * plenty of models have no such setting at all. So the levels always arrive
 * with the model (`efforts` on every model type) and this file only knows how
 * to present whatever came back. A model that offers nothing gets no control.
 */

/** Levels we can describe, weakest first. Others still work, unlabelled. */
const KNOWN = [
  { id: "none", label: "None", hint: "Answer straight away, without thinking first" },
  { id: "minimal", label: "Minimal", hint: "A moment's thought" },
  { id: "low", label: "Low", hint: "Quick and cheap" },
  { id: "medium", label: "Medium", hint: "A balance of speed and care" },
  { id: "high", label: "High", hint: "Slower, and better on hard problems" },
  { id: "xhigh", label: "Extra high", hint: "Longer still, and costs more" },
  { id: "max", label: "Max", hint: "Everything the model has" },
  { id: "ultra", label: "Ultra", hint: "Everything the model has, and then some" },
] as const;

export type EffortLevel = {
  id: string;
  label: string;
  hint?: string;
};

/** Present a level the list above has never heard of, rather than hiding it. */
function unknownLevel(id: string): EffortLevel {
  const words = id.replace(/[-_]/g, " ");
  return { id, label: words.charAt(0).toUpperCase() + words.slice(1) };
}

export function describeEffort(id: string): EffortLevel {
  return KNOWN.find((level) => level.id === id) ?? unknownLevel(id);
}

/** The model's own levels, described, in the order the model gave them. */
/** True when the chosen level is the model's highest (Extra high, Max, …). */
export function isMaxEffort(levels: EffortLevel[], value: string | undefined) {
  if (!value || levels.length < 2) return false;
  return levels[levels.length - 1]!.id === value;
}

export function effortLevels(ids: string[] | undefined): EffortLevel[] {
  return (ids ?? []).map(describeEffort);
}

/**
 * Where to start: the middle of what this model offers.
 *
 * Not the strongest, which would spend the user's money by default, and not
 * the weakest, which makes a reasoning model look worse than it is.
 */
export function defaultEffort(ids: string[] | undefined): string | undefined {
  const levels = ids ?? [];
  if (levels.length < 2) return undefined;
  return levels.includes("medium") ? "medium" : levels[Math.floor((levels.length - 1) / 2)];
}
