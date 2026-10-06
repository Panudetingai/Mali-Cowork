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
// staged under the universal name as well. Tauri also expects the fat runner at
// `target/universal-apple-darwin/release/mali-mcp-runner` beside the lipo'd app.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy-wait to keep the build script synchronous.
  }
}

/** Windows locks a running executable, so cargo cannot overwrite it. Kill any
 *  stale runner (and the parent Mali dev app that spawned it) and remove the
 *  old binary before rebuilding. */
function cleanStaleBinaryOnWindows(binaryPath) {
  if (process.platform !== "win32") return;
  let killed = false;
  for (const exe of ["Mali.exe", "mali-mcp-runner.exe"]) {
    try {
      execFileSync("taskkill", ["/F", "/IM", exe, "/T"], { stdio: "ignore" });
      killed = true;
      console.log(`[sidecar] terminated stale ${exe}`);
    } catch {
      // No matching process or taskkill unavailable — safe to ignore.
    }
  }
  if (killed) {
    // Give Windows a moment to release file handles before we delete.
    sleepSync(1000);
  }
  try {
    if (existsSync(binaryPath)) rmSync(binaryPath, { force: true });
  } catch {
    // If still locked, the build will fall back to the existing binary below.
  }
}

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
  const binaryPath = triple
    ? join(tauriDir, "target", triple, profile, `mali-mcp-runner${exe}`)
    : join(tauriDir, "target", profile, `mali-mcp-runner${exe}`);
  cleanStaleBinaryOnWindows(binaryPath);
  const args = ["build", "--bin", "mali-mcp-runner"];
  if (release) args.push("--release");
  if (triple) args.push("--target", triple);
  try {
    run("cargo", args);
  } catch (err) {
    const isWindowsLockError =
      process.platform === "win32" &&
      !release &&
      existsSync(binaryPath) &&
      /access is denied|os error 5/i.test(String(err?.message ?? err));
    if (isWindowsLockError) {
      console.warn(
        `[sidecar] ${binaryPath} is locked by a running process; reusing existing binary. ` +
          `Kill any stale Mali.exe / mali-mcp-runner.exe processes to force a fresh build.`,
      );
      return binaryPath;
    }
    throw err;
  }
  return binaryPath;
}

function stage(triple, from) {
  const to = join(binaries, `mali-mcp-runner-${triple}${exe}`);
  mkdirSync(binaries, { recursive: true });
  copyFileSync(from, to);
  console.log(`[sidecar] ${from} -> ${to}`);
}

/** Universal macOS bundles read sidecars beside the lipo'd main binary, not only under `binaries/`. */
function stageBundlerTarget(triple, from) {
  const dir = join(tauriDir, "target", triple, profile);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `mali-mcp-runner${exe}`);
  copyFileSync(from, dest);
  if (process.platform !== "win32") {
    chmodSync(dest, 0o755);
  }
  console.log(`[sidecar] bundler staging ${dest}`);
}

function linkArchBinariesToUniversal() {
  if (process.platform !== "darwin") return;
  const universalName = `mali-mcp-runner-${UNIVERSAL}`;
  for (const triple of APPLE) {
    const linkPath = join(binaries, `mali-mcp-runner-${triple}`);
    if (existsSync(linkPath)) rmSync(linkPath);
    symlinkSync(universalName, linkPath);
    console.log(`[sidecar] ${linkPath} -> ${universalName}`);
  }
}

function resolveRequestedTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) {
    return process.env.TAURI_ENV_TARGET_TRIPLE;
  }
  const hint = [process.env.npm_lifecycle_script, process.env.TAURI_CLI_ARGS, ...process.argv]
    .filter(Boolean)
    .join(" ");
  return hint.includes(UNIVERSAL) ? UNIVERSAL : undefined;
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
const requested = resolveRequestedTriple();
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
  linkArchBinariesToUniversal();
  stageBundlerTarget(UNIVERSAL, fat);
} else {
  // One target: build for the host and stage it under the name the bundler
  // asks for, which is the host triple unless Tauri is cross-compiling.
  const triple = requested || host;
  const cross = triple !== host;
  stage(triple, build(cross ? triple : null));
}
