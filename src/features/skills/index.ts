/**
 * The skill library.
 *
 * A skill is a short guide the agent follows when a task matches its
 * "Use when" — optionally with the scripts, references and assets those
 * instructions point at. The library is a folder on disk; the agent is told
 * what is in it and opens a skill when it needs one.
 *
 * The skills themselves live in `features/instructions` (they are part of
 * what the model is told); this module is how they get onto disk, and how
 * new ones are found.
 */
export * from "./catalog";
export * from "./types";
export * from "./discover";
export * from "./install";
export * from "./sync";
