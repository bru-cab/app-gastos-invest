import type { AppState } from "../types";
import { createInitialState } from "../data/seed";
import importedStateEnvelope from "../data/importedState.json";

const STORAGE_KEY = "gastos-invest-state-v1";
const IMPORT_VERSION_KEY = "gastos-invest-import-version";
const SYNC_REVISION_KEY = "gastos-invest-sync-revision";

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

export async function pullRemoteState(): Promise<RemoteStateEnvelope | undefined> {
  const apiBase = getSyncApiBase();
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
  const apiBase = getSyncApiBase();
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
  const apiBase = getSyncApiBase();
  if (!apiBase) return undefined;

  const response = await fetchWithTimeout(`${apiBase}/api/health`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 5000);
  if (!response.ok) return undefined;
  const body = (await response.json()) as { revision?: number };
  return Number.isFinite(body.revision) ? body.revision : undefined;
}

function getSyncApiBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.protocol === "file:") return undefined;
  return window.location.origin;
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
