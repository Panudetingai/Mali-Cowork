/** A bot's files as a .zip, and back; nothing outside the bot's own folder comes in. */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Files } from "./plugin";

/** Exported bots are small; anything larger isn't one. */
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_FILES = 500;

export function zipFiles(files: Files, folder: string): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const [path, text] of files) tree[`${folder}/${path}`] = strToU8(text);
  return zipSync(tree, { level: 6 });
}

/** The text files of a zip, relative to its bot folder (a single top folder is stripped). */
export function unzipFiles(data: Uint8Array): Files {
  let total = 0;
  let count = 0;
  const raw = unzipSync(data, {
    filter: (f) => {
      count += 1;
      total += f.originalSize;
      if (count > MAX_FILES || total > MAX_TOTAL) throw new Error("That archive is too big to be a bot.");
      return !f.name.endsWith("/");
    },
  });
  // macOS's zip adds __MACOSX/ and .DS_Store: they aren't the bot's.
  const kept = Object.keys(raw)
    .map((name) => ({ name, path: safePath(name) }))
    .filter(({ path }) => !path.startsWith("__MACOSX/") && path.split("/").pop() !== ".DS_Store");
  const tops = new Set(kept.map(({ path }) => path.split("/")[0]));
  const strip = tops.size === 1 && kept.every(({ path }) => path.includes("/")) ? `${[...tops][0]}/` : "";
  return new Map(kept.map(({ name, path }) => [path.slice(strip.length), strFromU8(raw[name])]));
}

/** No absolute paths, no `..`: a zip can't write outside where it lands. */
export function safePath(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (/^[A-Za-z]:$/.test(parts[0] ?? "") || name.startsWith("/") || parts.includes("..")) {
    throw new Error(`Unsafe path in archive: ${name}`);
  }
  return parts.join("/");
}
