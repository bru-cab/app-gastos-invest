import type { AppState } from "../types";
import { createInitialState } from "../data/seed";
import importedStateEnvelope from "../data/importedState.json";

const STORAGE_KEY = "gastos-invest-state-v1";
const IMPORT_VERSION_KEY = "gastos-invest-import-version";
const SYNC_REVISION_KEY = "gastos-invest-sync-revision";
const GITHUB_SYNC_CONFIG_KEY = "gastos-invest-github-sync-v1";
const SYNC_CONFIG_CHANGED_EVENT = "gastos-invest-sync-config-changed";

export const DEFAULT_GITHUB_SYNC_REPO = "bru-cab/app-gastos-invest-sync";
const DEFAULT_GITHUB_SYNC_BRANCH = "main";
const DEFAULT_GITHUB_SYNC_PATH = "state.json";

export type SyncStatus =
  | { state: "checking"; label: string }
  | { state: "local"; label: string }
  | { state: "saving"; label: string; revision?: number }
  | { state: "synced"; label: string; revision: number; updatedAt: string }
  | { state: "offline"; label: string }
  | { state: "error"; label: string };

export interface RemoteStateEnvelope {
  version: 1;
  revision: number;
  updatedAt: string;
  state: AppState;
}

export interface GitHubSyncConfig {
  provider: "github";
  repo: string;
  branch: string;
  path: string;
  token: string;
}

export interface FinanceRepository {
  load(): AppState;
  save(state: AppState): void;
  reset(): AppState;
  hasLocalState(): boolean;
  getSyncRevision(): number | undefined;
  setSyncRevision(revision: number): void;
}

function reviveState(value: unknown): AppState {
  const initial = createInitialState();
  if (!value || typeof value !== "object") return initial;
  const partial = value as Partial<AppState>;

  return applyLocalMigrations({
    accounts: partial.accounts ?? initial.accounts,
    categories: partial.categories ?? initial.categories,
    tags: partial.tags ?? initial.tags,
    transactions: partial.transactions ?? initial.transactions,
    budgets: partial.budgets ?? initial.budgets,
    recurringRules: partial.recurringRules ?? initial.recurringRules,
    importBatches: partial.importBatches ?? initial.importBatches,
    inboxDrafts: partial.inboxDrafts ?? initial.inboxDrafts,
    fxRates: partial.fxRates ?? initial.fxRates,
    agentConversations: dedupeAgentConversations(partial.agentConversations ?? initial.agentConversations)
  });
}

function applyLocalMigrations(state: AppState): AppState {
  return {
    ...state,
    accounts: state.accounts.map((account) => {
      if (account.id === "account_prestamos_uyu" && account.initialBalance === 0) {
        return { ...account, initialBalance: 28549 };
      }
      return account;
    })
  };
}

function dedupeAgentConversations(conversations: AppState["agentConversations"]): AppState["agentConversations"] {
  let keptEmptyConversation = false;
  return conversations.filter((conversation) => {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const hasUserMessage = messages.some((message) => message.role === "user");
    if (conversation.title !== "Nueva conversación" || hasUserMessage) return true;
    if (keptEmptyConversation) return false;
    keptEmptyConversation = true;
    return true;
  });
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // Safari en iOS tiene un límite de localStorage menor y puede lanzar
    // QuotaExceededError. El estado sigue disponible vía sync remoto.
  }
}

function safeRemoveItem(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    // Ignore localStorage cleanup errors.
  }
}

export const localFinanceRepository: FinanceRepository = {
  load() {
    const bundled = getBundledImportedState();
    if (typeof localStorage === "undefined") return bundled?.state ?? createInitialState();

    if (bundled && safeGetItem(IMPORT_VERSION_KEY) !== bundled.version) {
      safeSetItem(IMPORT_VERSION_KEY, bundled.version);
      this.save(bundled.state);
      return bundled.state;
    }

    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) {
      const state = bundled?.state ?? createInitialState();
      if (bundled) safeSetItem(IMPORT_VERSION_KEY, bundled.version);
      this.save(state);
      return state;
    }

    try {
      return reviveState(JSON.parse(raw));
    } catch {
      return createInitialState();
    }
  },
  save(state) {
    safeSetItem(STORAGE_KEY, JSON.stringify(state));
  },
  reset() {
    const bundled = getBundledImportedState();
    const state = bundled?.state ?? createInitialState();
    if (bundled && typeof localStorage !== "undefined") {
      safeSetItem(IMPORT_VERSION_KEY, bundled.version);
    }
    this.save(state);
    return state;
  },
  hasLocalState() {
    return typeof localStorage !== "undefined" && Boolean(safeGetItem(STORAGE_KEY));
  },
  getSyncRevision() {
    const raw = safeGetItem(SYNC_REVISION_KEY);
    const revision = raw ? Number(raw) : undefined;
    return Number.isFinite(revision) ? revision : undefined;
  },
  setSyncRevision(revision) {
    safeSetItem(SYNC_REVISION_KEY, String(revision));
  }
};

function getBundledImportedState(): { version: string; state: AppState } | undefined {
  const candidate = importedStateEnvelope as unknown as { version?: string; state?: Partial<AppState> | null };
  if (!candidate.version || !candidate.state?.transactions?.length) return undefined;
  return { version: candidate.version, state: reviveState(candidate.state) };
}

export function exportState(state: AppState): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 1,
      state
    },
    null,
    2
  );
}

export function getGitHubSyncConfig(): GitHubSyncConfig | undefined {
  const raw = safeGetItem(GITHUB_SYNC_CONFIG_KEY);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<GitHubSyncConfig>;
    if (parsed.provider !== "github") return undefined;
    if (!parsed.token || !parsed.repo) return undefined;
    return {
      provider: "github",
      repo: parsed.repo,
      branch: parsed.branch || DEFAULT_GITHUB_SYNC_BRANCH,
      path: parsed.path || DEFAULT_GITHUB_SYNC_PATH,
      token: parsed.token
    };
  } catch {
    return undefined;
  }
}

export function saveGitHubSyncConfig(token: string, options?: Partial<Pick<GitHubSyncConfig, "repo" | "branch" | "path">>) {
  const nextConfig: GitHubSyncConfig = {
    provider: "github",
    repo: options?.repo || DEFAULT_GITHUB_SYNC_REPO,
    branch: options?.branch || DEFAULT_GITHUB_SYNC_BRANCH,
    path: options?.path || DEFAULT_GITHUB_SYNC_PATH,
    token: token.trim()
  };

  safeSetItem(GITHUB_SYNC_CONFIG_KEY, JSON.stringify(nextConfig));
  safeRemoveItem(SYNC_REVISION_KEY);
  dispatchSyncConfigChanged();
}

export function clearGitHubSyncConfig() {
  safeRemoveItem(GITHUB_SYNC_CONFIG_KEY);
  safeRemoveItem(SYNC_REVISION_KEY);
  dispatchSyncConfigChanged();
}

export function isGitHubSyncConfigured() {
  return Boolean(getGitHubSyncConfig()?.token);
}

export function subscribeToSyncConfigChanges(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SYNC_CONFIG_CHANGED_EVENT, callback);
  return () => window.removeEventListener(SYNC_CONFIG_CHANGED_EVENT, callback);
}

export async function testGitHubSyncConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = getGitHubSyncConfig();
  if (!config) return { ok: false, error: "Falta configurar el token de GitHub." };

  try {
    const response = await fetch(`https://api.github.com/repos/${config.repo}`, {
      headers: githubHeaders(config.token)
    });
    if (!response.ok) return { ok: false, error: await githubErrorMessage(response) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No pude conectar con GitHub." };
  }
}

export async function pullRemoteState(): Promise<RemoteStateEnvelope | undefined> {
  const githubConfig = getGitHubSyncConfig();
  if (githubConfig) {
    const remote = await fetchGithubEnvelope(githubConfig);
    return remote?.envelope;
  }

  const apiBase = getLegacySyncApiBase();
  if (!apiBase) return undefined;

  const response = await fetchWithTimeout(`${apiBase}/api/state`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 15000);
  if (!response.ok) return undefined;
  const envelope = (await response.json()) as RemoteStateEnvelope;
  return isRemoteStateEnvelope(envelope) ? { ...envelope, state: reviveState(envelope.state) } : undefined;
}

export async function pushRemoteState(state: AppState, baseRevision?: number): Promise<RemoteStateEnvelope | undefined> {
  const githubConfig = getGitHubSyncConfig();
  if (githubConfig) {
    return pushGithubEnvelope(githubConfig, state, baseRevision);
  }

  const apiBase = getLegacySyncApiBase();
  if (!apiBase) return undefined;

  const response = await fetchWithTimeout(`${apiBase}/api/state`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ baseRevision, state })
  }, 20000);
  if (!response.ok) return undefined;
  const envelope = (await response.json()) as RemoteStateEnvelope;
  return isRemoteStateEnvelope(envelope) ? { ...envelope, state: reviveState(envelope.state) } : undefined;
}

export async function getRemoteRevision(): Promise<number | undefined> {
  const githubConfig = getGitHubSyncConfig();
  if (githubConfig) {
    const remote = await fetchGithubEnvelope(githubConfig);
    return remote?.envelope?.revision;
  }

  const apiBase = getLegacySyncApiBase();
  if (!apiBase) return undefined;

  const response = await fetchWithTimeout(`${apiBase}/api/health`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 5000);
  if (!response.ok) return undefined;
  const body = (await response.json()) as { revision?: number };
  return Number.isFinite(body.revision) ? body.revision : undefined;
}

function dispatchSyncConfigChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SYNC_CONFIG_CHANGED_EVENT));
}

function getLegacySyncApiBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.protocol === "file:") return undefined;
  return window.location.origin;
}

async function fetchGithubEnvelope(config: GitHubSyncConfig): Promise<{ envelope?: RemoteStateEnvelope; sha?: string }> {
  const url = new URL(`https://api.github.com/repos/${config.repo}/contents/${config.path}`);
  url.searchParams.set("ref", config.branch);

  const response = await fetch(url.toString(), {
    headers: githubHeaders(config.token)
  });

  if (response.status === 404) return {};
  if (!response.ok) throw new Error(await githubErrorMessage(response));

  const body = (await response.json()) as { content?: string; encoding?: string; sha?: string };
  if (!body.content || body.encoding !== "base64") return {};

  const decoded = decodeBase64Utf8(body.content);
  const parsed = JSON.parse(decoded) as RemoteStateEnvelope;
  if (!isRemoteStateEnvelope(parsed)) return {};
  return {
    sha: body.sha,
    envelope: {
      ...parsed,
      state: reviveState(parsed.state)
    }
  };
}

async function pushGithubEnvelope(config: GitHubSyncConfig, state: AppState, _baseRevision?: number): Promise<RemoteStateEnvelope | undefined> {
  const current = await fetchGithubEnvelope(config);
  const nextEnvelope: RemoteStateEnvelope = {
    version: 1,
    revision: (current.envelope?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    state: reviveState(state)
  };

  const response = await fetch(`https://api.github.com/repos/${config.repo}/contents/${config.path}`, {
    method: "PUT",
    headers: {
      ...githubHeaders(config.token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: `sync: revision ${nextEnvelope.revision}`,
      branch: config.branch,
      content: encodeBase64Utf8(`${JSON.stringify(nextEnvelope, null, 2)}\n`),
      sha: current.sha
    })
  });

  if (!response.ok) throw new Error(await githubErrorMessage(response));
  return nextEnvelope;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubErrorMessage(response: Response): Promise<string> {
  const fallback = `GitHub devolvió ${response.status}.`;
  try {
    const body = (await response.json()) as { message?: string };
    if (!body.message) return fallback;
    if (body.message.includes("Bad credentials")) return "El token de GitHub no es válido.";
    if (body.message.includes("Not Found")) return "No pude acceder al repo privado de sync.";
    return body.message;
  } catch {
    return fallback;
  }
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function isRemoteStateEnvelope(value: RemoteStateEnvelope): value is RemoteStateEnvelope {
  return (
    value?.version === 1 &&
    Number.isFinite(value.revision) &&
    typeof value.updatedAt === "string" &&
    Boolean(value.state?.transactions)
  );
}
