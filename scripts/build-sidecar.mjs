// Build `mali-mcp-runner` and stage it where Tauri expects a sidecar.
//
// Tauri's `bundle.externalBin` wants one file per target, named with the target
// triple (`mali-mcp-runner-aarch64-apple-darwin`), and ships it next to the app
// binary with the triple stripped — which is exactly where
// `mcp_runner::runner_binary_path()` looks. Without this step a packaged app has
// no runner, and every local MCP server starts unsandboxed.
//
// Runs from `beforeBuildCommand`, so a release build always carries it. The
// release workflow builds macOS as `--target universal-apple-darwin`, so when
// both Apple targets are installed the two builds are `lipo`-ed together and
// staged under the universal name as well.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const binaries = join(tauriDir, "binaries");
const release = !process.argv.includes("--debug");
const profile = release ? "release" : "debug";
const exe = process.platform === "win32" ? ".exe" : "";

// Building the runner also runs the app's `tauri-build` script, which refuses to
// run while `externalBin` names a file that this very step is about to produce.
// Blanking that one key for the sidecar build breaks the cycle.
const env = { ...process.env, TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) };

function run(command, args) {
  return execFileSync(command, args, { cwd: tauriDir, stdio: "inherit", env });
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" });
}

function hostTriple() {
  const host = capture("rustc", ["-vV"]).split("\n").find((line) => line.startsWith("host:"));
  if (!host) throw new Error("Cannot read the host target triple from `rustc -vV`");
  return host.slice("host:".length).trim();
}

function installedTargets() {
  try {
    return capture("rustup", ["target", "list", "--installed"]).split("\n").map((t) => t.trim());
  } catch {
    return [];
  }
}

/** Build for one triple and return the binary's path. */
function build(triple) {
  const args = ["build", "--bin", "mali-mcp-runner"];
  if (release) args.push("--release");
  if (triple) args.push("--target", triple);
  run("cargo", args);
  return triple
    ? join(tauriDir, "target", triple, profile, `mali-mcp-runner${exe}`)
    : join(tauriDir, "target", profile, `mali-mcp-runner${exe}`);
}

function stage(triple, from) {
  const to = join(binaries, `mali-mcp-runner-${triple}${exe}`);
  mkdirSync(binaries, { recursive: true });
  copyFileSync(from, to);
  console.log(`[sidecar] ${from} -> ${to}`);
}

// `tauri dev` runs the app straight out of `target/debug`, so a debug build only
// has to put the runner in the same folder — no staging, no triple.
if (!release) {
  console.log(`[sidecar] built ${build(null)}`);
  process.exit(0);
}

const host = hostTriple();
const APPLE = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
const UNIVERSAL = "universal-apple-darwin";
// Tauri sets the triple it is bundling for; without it (a bare `cargo`-side run)
// fall back to what the toolchain can do.
const requested = process.env.TAURI_ENV_TARGET_TRIPLE;
const universal =
  requested === UNIVERSAL ||
  (!requested && process.platform === "darwin" && APPLE.every((t) => installedTargets().includes(t)));

if (universal) {
  const missing = APPLE.filter((t) => !installedTargets().includes(t));
  if (missing.length > 0) {
    throw new Error(
      `A universal build needs both Apple targets. Run: rustup target add ${missing.join(" ")}`,
    );
  }
  // Produce every name the bundler could ask for: each arch, and the fat one.
  const built = APPLE.map((triple) => [triple, build(triple)]);
  for (const [triple, path] of built) stage(triple, path);
  const fat = join(binaries, `mali-mcp-runner-${UNIVERSAL}`);
  mkdirSync(binaries, { recursive: true });
  execFileSync("lipo", ["-create", "-output", fat, ...built.map(([, path]) => path)], {
    stdio: "inherit",
  });
  console.log(`[sidecar] lipo -> ${fat}`);
} else {
  // One target: build for the host and stage it under the name the bundler
  // asks for, which is the host triple unless Tauri is cross-compiling.
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
  const cross = triple !== host;
  stage(triple, build(cross ? triple : null));
}
