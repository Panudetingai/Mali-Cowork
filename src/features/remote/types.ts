/**
 * What the phone sees and sends (`commands/remote.rs` relays both). Kept
 * small on purpose: steps and files changed, not the streamed text.
 */
import type { PermissionReply, WorkMode } from "@/features/opencode";
import type { QuestionItem } from "@/pages/chat/api/chat";

export type RemoteStep = { title: string; kind: string; done: boolean };

/** A file a run wrote: from its edit steps while it runs, from the checkpoint once it ends. */
export type RemoteFile = {
  path: string;
  kind: "added" | "modified" | "deleted";
  additions?: number;
  deletions?: number;
};

export type RemotePermission = { id: string; title: string; command: string };

export type RemoteQuestion = { id: string; questions: QuestionItem[] };

export type RemoteTodo = { text: string; done: boolean; active: boolean };

/** A run going on now. */
export type RemoteRun = {
  chatId: string;
  title: string;
  mode: WorkMode;
  startedAt?: number;
  /** The last few steps, newest last. */
  steps: RemoteStep[];
  stepCount: number;
  todos: RemoteTodo[];
  files: RemoteFile[];
  permissions: RemotePermission[];
  questions: RemoteQuestion[];
};

/** A chat in the list. */
export type RemoteSession = {
  id: string;
  title: string;
  mode: WorkMode;
  /** The folder's name, for a Cowork chat. */
  folder?: string;
  model?: string;
  /** The end of its last answer, clipped. */
  preview?: string;
  running: boolean;
  waiting: boolean;
  failed: boolean;
  updatedAt: number;
  /** Changes when the chat has news worth fetching again (not on every token). */
  rev: string;
};

/** Published to the phones whenever it changes. */
export type RemoteState = {
  runs: RemoteRun[];
  sessions: RemoteSession[];
};

/** One message of a chat, summed up. */
export type RemoteMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  /** The answer's text once written; left out while it is still being written. */
  text: string;
  /** The text was cut; the app has the rest. */
  clipped?: boolean;
  /** Still being written. */
  writing?: boolean;
  steps?: RemoteStep[];
  stepCount?: number;
  files?: RemoteFile[];
  todos?: RemoteTodo[];
  model?: string;
  durationMs?: number;
  at?: number;
};

export type RemoteChat = {
  id: string;
  title: string;
  mode: WorkMode;
  folder?: string;
  /** The model its last prompt went out on. */
  modelId?: string;
  running: boolean;
  messages: RemoteMessage[];
  permissions: RemotePermission[];
  questions: RemoteQuestion[];
};

export type RemoteModel = {
  id: string;
  name: string;
  group: string;
  source: string;
  free?: boolean;
  /** Why it may not run: no key saved, not offered in this mode, or a CLI to sign in to. */
  note?: "key" | "issue" | "login";
  /** Can't be picked from the phone (a provider without a key). */
  disabled?: boolean;
};

export type RemoteCommand =
  | { kind: "chat"; chatId: string }
  | { kind: "models"; mode: WorkMode }
  | { kind: "send"; prompt: string; chatId?: string; mode?: WorkMode; modelId?: string }
  | { kind: "stop"; chatId: string }
  | { kind: "permission"; chatId: string; id: string; reply: PermissionReply }
  | { kind: "answer"; chatId: string; id: string; answers: string[][] };

export type RemoteStatus = {
  running: boolean;
  port: number;
  https: boolean;
  /** `domain` is the user's own name with a trusted certificate (first when ready). */
  addresses: { kind: "domain" | "lan" | "tailscale"; ip: string; url: string }[];
  clients: number;
  ipAllowlistEnabled: boolean;
  autoAllowNewIps: boolean;
  allowedIps: string[];
  pendingIps: string[];
  /** What kind of device each phone address is ("iPhone", "Android phone"). */
  deviceLabels?: Record<string, string>;
  /** SHA-256 of the HTTPS certificate, as the phone's browser shows it. */
  certFingerprint?: string | null;
  domain?: RemoteDomain | null;
  /** This build can give a free name from Mali DNS. */
  maliAvailable?: boolean;
  /** The user turned the free Mali DNS name off. */
  maliDomainOff?: boolean;
  /** Getting a Mali DNS name failed. */
  domainError?: string | null;
  domainRegistering?: boolean;
};

/** The user's own domain on Cloudflare, for a certificate the phone trusts. */
export type RemoteDomain = {
  hostname: string;
  /** `mali`: a free name from Mali DNS; `cloudflare`: the user's own domain. */
  provider: "mali" | "cloudflare";
  pointTo: "lan" | "tailscale";
  /** The address its DNS record points at now. */
  ip?: string | null;
  state: "working" | "ready" | "error" | "needsToken";
  error?: string | null;
  /** When the certificate expires (ms). */
  expiresAt?: number | null;
};
