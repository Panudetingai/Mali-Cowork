import { invoke } from "@tauri-apps/api/core";
import { createStore } from "@/lib/local-store";

/**
 * API keys and tokens, kept in the OS keychain (macOS Keychain, Windows
 * Credential Manager) instead of plain text in localStorage. The backend
 * stores them as one vault, read once at startup and held in memory.
 */

type VaultSnapshot = { values: Record<string, string>; backend: "keychain" | "file" };

export type VaultStatus =
  | { state: "loading" }
  | { state: "ready"; backend: VaultSnapshot["backend"] }
  /** The keychain couldn't be used; keys stay where they were (localStorage). */
  | { state: "unavailable"; error: string };

const statusStore = createStore<VaultStatus>({ state: "loading" });
let values: Record<string, string> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
let resolveReady: () => void;
const ready = new Promise<void>((resolve) => (resolveReady = resolve));
const migrations: SecretMigration[] = [];

type SecretMigration = {
  /** Merge vault secrets into the store; move plain-text ones into the vault. True if any moved. */
  load: () => boolean;
  /** Rewrite the store's storage without secrets, once they are safely in the vault. */
  commit: () => void;
};

export const useVaultStatus = statusStore.use;

/** True once keys live in the keychain, so stores may drop their plain-text copies. */
export function vaultActive() {
  return statusStore.get().state === "ready";
}

/** Resolves once the vault was read (or found unavailable). */
export function whenVaultReady() {
  return ready;
}

export function getSecret(name: string): string | undefined {
  return values[name];
}

/** Set (or with an empty value, remove) a secret; saved to the keychain shortly after. */
export function setSecret(name: string, value: string | undefined) {
  const trimmed = value?.trim() ? value : undefined;
  if (values[name] === trimmed) return;
  const next = { ...values };
  if (trimmed === undefined) delete next[name];
  else next[name] = trimmed;
  values = next;
  scheduleSave();
}

/** Every secret whose name starts with `prefix`, keyed by the rest of the name. */
export function secretsWithPrefix(prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => [name.slice(prefix.length), value]),
  );
}

/** A store's hook to take its secrets from the vault, and move old plain-text ones in. */
export function registerSecretStore(migration: SecretMigration) {
  migrations.push(migration);
}

function scheduleSave() {
  if (!vaultActive()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 300);
}

function flush() {
  saveTimer = undefined;
  const snapshot = values;
  saving = saving
    .then(async () => {
      await invoke("secrets_save", { values: snapshot });
    })
    .catch((error) => console.error("[secrets] could not save to the keychain", error));
  return saving;
}

/** Read the vault, then let each store move legacy plain-text keys into it. */
export async function loadVault() {
  try {
    const snapshot = await invoke<VaultSnapshot>("secrets_load");
    values = { ...snapshot.values };
    const moved = migrations.map((m) => m.load()).some(Boolean);
    if (moved) await invoke("secrets_save", { values });
    statusStore.set({ state: "ready", backend: snapshot.backend });
    // Only now is it safe to drop the plain-text copies.
    migrations.forEach((m) => m.commit());
  } catch (error) {
    console.warn("[secrets] keychain unavailable; keys stay in app storage", error);
    statusStore.set({ state: "unavailable", error: String(error) });
  } finally {
    resolveReady();
  }
}

type SecretStore<T> = {
  get: () => T;
  set: (next: (prev: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
  save: () => void;
};

type SecretBinding<T> = {
  /** Vault names are `<prefix><id>`. */
  prefix: string;
  /** Each item's secret by id; empty for none. */
  read: (state: T) => Record<string, string>;
  /** Put secrets back into the state; `""` clears the plain-text field. */
  write: (state: T, secrets: Record<string, string>) => T;
};

/**
 * Keep one field of a persisted store in the vault: its value is read from
 * the keychain at startup, every change is mirrored there, and `stripSecrets`
 * (use it as the store's `persist`) keeps it out of localStorage.
 */
export function bindSecrets<T>(store: SecretStore<T>, { prefix, read, write }: SecretBinding<T>) {
  const mirror = () => {
    const current = read(store.get());
    for (const [id, value] of Object.entries(current)) setSecret(prefix + id, value);
    for (const id of Object.keys(secretsWithPrefix(prefix))) {
      if (!current[id]) setSecret(prefix + id, undefined);
    }
  };

  registerSecretStore({
    load: () => {
      let moved = false;
      // Plain text left by older versions moves in (it is the newest value).
      for (const [id, value] of Object.entries(read(store.get()))) {
        if (value && value !== getSecret(prefix + id)) {
          setSecret(prefix + id, value);
          moved = true;
        }
      }
      store.set((state) => write(state, secretsWithPrefix(prefix)));
      return moved;
    },
    commit: () => store.save(),
  });
  store.subscribe(() => {
    if (vaultActive()) mirror();
  });
}

/** The state as written to localStorage: without secrets once the vault holds them. */
export function stripSecrets<T>(state: T, { read, write }: Pick<SecretBinding<T>, "read" | "write">): T {
  if (!vaultActive()) return state;
  const empty = Object.fromEntries(Object.keys(read(state)).map((id) => [id, ""]));
  return write(state, empty);
}
