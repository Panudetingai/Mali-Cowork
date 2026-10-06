/**
 * Plugins: one install for a set of skills, slash commands, bots,
 * connectors, templates, instructions and panels — laid out like Claude Code
 * plugins, so published ones work as they are (see `commands/plugins` in the
 * backend for the layout).
 */
import { addInstructionSource } from "@/features/instructions";
import { pluginInstructions } from "./store";

export * from "./api";
export * from "./bridge";
export * from "./convert";
export * from "./install";
export * from "./store";
export * from "./types";

// A plugin's instructions ride along with every chat while it's on.
addInstructionSource(() => pluginInstructions());
