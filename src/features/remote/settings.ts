/**
 * Settings → Mobile: the remote's on/off (remembered), and what the server
 * says about itself (addresses, phones connected).
 */
import { getSecret, setSecret, whenVaultReady } from "@/features/secrets";
import { createStore } from "@/lib/local-store";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteStatus } from "./types";

const enabledStore = createStore<boolean>(false, { key: "mali.remote.enabled" });
const statusStore = createStore<RemoteStatus | null>(null);
const errorStore = createStore<string | null>(null);

export const useRemoteEnabled = enabledStore.use;
export const isRemoteEnabled = enabledStore.get;
export const subscribeToRemoteEnabled = enabledStore.subscribe;
export const useRemoteStatus = statusStore.use;
/** Why the server couldn't start (a port in use), until it does. */
export const useRemoteError = errorStore.use;

/** On starts the server from `RemoteBridge`, which also starts it at launch. */
export async function setRemoteEnabled(on: boolean) {
  enabledStore.set(on);
  if (!on) await stopRemote();
}

/** Start the server (idempotent); a failure is kept for Settings to show. */
export async function startRemote() {
  if (!isTauri()) return;
  try {
    statusStore.set(await invoke<RemoteStatus>("remote_start"));
    errorStore.set(null);
  } catch (error) {
    errorStore.set(String(error));
    await refreshRemoteStatus();
  }
}

export async function stopRemote() {
  if (!isTauri()) return;
  errorStore.set(null);
  statusStore.set(await invoke<RemoteStatus>("remote_stop"));
}

/** Addresses change with the network (Wi-Fi, Tailscale up or down). */
export async function refreshRemoteStatus() {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_status"));
}

/** A new pairing: every phone has to scan the new code. */
export async function resetRemoteToken() {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_reset_token"));
}

export async function setRemoteIpAllowlist(enabled: boolean) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_set_ip_allowlist", { enabled }));
}

export async function setRemoteAutoAllowIps(enabled: boolean) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_set_auto_allow_ips", { enabled }));
}

export async function setRemoteKeepAwake(enabled: boolean) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_set_keep_awake", { enabled }));
}

export async function allowRemoteIp(ip: string) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_allow_ip", { ip }));
}

export async function revokeRemoteIp(ip: string) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_revoke_ip", { ip }));
}

export async function dismissPendingRemoteIp(ip: string) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_dismiss_pending_ip", { ip }));
}

/**
 * The safest setup: only approved phones get in, and each new one is
 * approved on this computer (scanning the QR code alone isn't enough).
 */
export async function applySafestRemoteSettings() {
  if (!isTauri()) return;
  await invoke<RemoteStatus>("remote_set_ip_allowlist", { enabled: true });
  statusStore.set(await invoke<RemoteStatus>("remote_set_auto_allow_ips", { enabled: false }));
}

/** The Cloudflare API token, in the vault (Keychain); the Rust side only holds it in memory. */
const CLOUDFLARE_SECRET = "remote:cloudflare";

/** Hand the saved token to the server, so it can renew the certificate and follow the address. */
export async function shareRemoteDomainToken() {
  if (!isTauri()) return;
  await whenVaultReady();
  statusStore.set(await invoke<RemoteStatus>("remote_domain_set_token", { token: getSecret(CLOUDFLARE_SECRET) ?? null }));
}

/** Point the domain at this computer and get its certificate (in the background). */
export async function setupRemoteDomain(hostname: string, token: string, pointTo: "lan" | "tailscale") {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_domain_setup", { hostname, token, pointTo }));
  // Only kept once Cloudflare accepted it.
  setSecret(CLOUDFLARE_SECRET, token.trim());
}

export async function renewRemoteDomain() {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_domain_renew"));
}

/** Stop using the domain: its DNS record is removed and the token forgotten. */
export async function removeRemoteDomain() {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_domain_remove"));
  setSecret(CLOUDFLARE_SECRET, undefined);
}

/** The free Mali DNS name: on registers and gets its certificate; off removes it. */
export async function setMaliDomain(enabled: boolean) {
  if (!isTauri()) return;
  statusStore.set(await invoke<RemoteStatus>("remote_domain_mali", { enabled }));
}

export function hasRemoteDomainToken() {
  return !!getSecret(CLOUDFLARE_SECRET);
}

export function setRemoteClients(clients: number) {
  statusStore.set((prev) => (prev ? { ...prev, clients } : prev));
}
