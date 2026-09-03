import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runOpenAiFinanceAgent } from "./openai-finance-agent.mjs";
import { parseReceiptImageWithOpenAI } from "./openai-receipt-parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
await loadLocalEnv(path.join(workspaceRoot, ".env"));
await loadLocalEnv(path.join(workspaceRoot, ".env.local"));

const port = Number(process.env.SYNC_PORT || process.env.PORT || 8787);
const host = process.env.SYNC_HOST || "0.0.0.0";
const dataDir = path.join(workspaceRoot, ".local-sync");
const statePath = path.join(dataDir, "state.json");
const dbPath = path.join(dataDir, "state.db");
const importedStatePath = path.join(workspaceRoot, "src", "data", "importedState.json");
const distDir = path.join(workspaceRoot, "dist");
const database = await openDatabase();

let envelope = await loadEnvelope();

const server = http.createServer(async (request, response) => {
  try {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        revision: envelope.revision,
        updatedAt: envelope.updatedAt
      });
      return;
    }

    if (url.pathname === "/api/agent/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        configured: Boolean(process.env.OPENAI_API_KEY),
        mode: process.env.OPENAI_API_KEY ? "openai" : "offline",
        model: getAgentModel(),
        reasoningEffort: getAgentReasoningEffort()
      });
      return;
    }

    if (url.pathname === "/api/agent/chat" && request.method === "POST") {
      const body = await readJsonBody(request);
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      const history = sanitizeAgentHistory(body?.history);
      if (!message) {
        sendJson(response, 400, { ok: false, error: "Message is required" });
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        sendJson(response, 503, {
          ok: false,
          error: "OPENAI_API_KEY is not configured"
        });
        return;
      }

      const answer = await runOpenAiFinanceAgent({
        message,
        history,
        state: envelope.state,
        apiKey: process.env.OPENAI_API_KEY,
        model: getAgentModel(),
        reasoningEffort: getAgentReasoningEffort(),
        nowIso: todayIso()
      });
      sendJson(response, 200, { ok: true, ...answer });
      return;
    }

    if (url.pathname === "/api/inbox/parse-image" && request.method === "POST") {
      const body = await readJsonBody(request);
      const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
      const fileName = typeof body?.fileName === "string" ? body.fileName : "captura";

      if (!process.env.OPENAI_API_KEY) {
        sendJson(response, 503, {
          ok: false,
          error: "OPENAI_API_KEY is not configured"
        });
        return;
      }

      const result = await parseReceiptImageWithOpenAI({
        imageDataUrl,
        fileName,
        state: envelope.state,
        apiKey: process.env.OPENAI_API_KEY,
        model: getVisionModel(),
        nowIso: todayIso()
      });
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      sendJson(response, 200, envelope);
      return;
    }

    if (url.pathname === "/api/state" && request.method === "PUT") {
      const body = await readJsonBody(request);
      if (!isAppState(body?.state)) {
        sendJson(response, 400, { ok: false, error: "Invalid AppState payload" });
        return;
      }

      envelope = {
        version: 1,
        revision: envelope.revision + 1,
        updatedAt: new Date().toISOString(),
        state: applyServerMigrations(body.state)
      };
      await saveEnvelope(envelope);
      sendJson(response, 200, envelope);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "Unexpected error" });
  }
});

server.listen(port, host, () => {
  console.log(`Gastos Invest sync escuchando en http://${host}:${port}`);
  console.log(`Estado compartido (SQLite): ${dbPath}`);
  console.log(`Compat legacy JSON: ${statePath}`);
});

async function loadEnvelope() {
  await fs.mkdir(dataDir, { recursive: true });

  const storedEnvelope = readStoredEnvelope();
  if (storedEnvelope) return storedEnvelope;

  try {
    const legacy = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (legacy?.version === 1 && Number.isFinite(legacy.revision) && isAppState(legacy.state)) {
      const migrated = { ...legacy, state: applyServerMigrations(legacy.state) };
      saveEnvelope(migrated);
      return migrated;
    }
  } catch {
    // First run: seed from imported history.
  }

  const imported = JSON.parse(await fs.readFile(importedStatePath, "utf8"));
  const state = applyServerMigrations(imported.state);
  const created = {
    version: 1,
    revision: 1,
    updatedAt: new Date().toISOString(),
    state
  };
  await saveEnvelope(created);
  return created;
}

function saveEnvelope(nextEnvelope) {
  const normalized = {
    ...nextEnvelope,
    state: applyServerMigrations(nextEnvelope.state)
  };

  const insertCurrent = database.prepare(`
    INSERT INTO app_state (singleton, version, revision, updated_at, state_json)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      version = excluded.version,
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      state_json = excluded.state_json
  `);
  insertCurrent.run(
    normalized.version,
    normalized.revision,
    normalized.updatedAt,
    JSON.stringify(normalized.state)
  );

  const insertHistory = database.prepare(`
    INSERT INTO state_history (revision, updated_at, state_json)
    VALUES (?, ?, ?)
  `);
  insertHistory.run(normalized.revision, normalized.updatedAt, JSON.stringify(normalized.state));
}

function readStoredEnvelope() {
  const row = database
    .prepare("SELECT version, revision, updated_at, state_json FROM app_state WHERE singleton = 1")
    .get();
  if (!row) return undefined;

  try {
    const state = JSON.parse(String(row.state_json));
    if (!isAppState(state)) return undefined;
    return {
      version: Number(row.version),
      revision: Number(row.revision),
      updatedAt: String(row.updated_at),
      state: applyServerMigrations(state)
    };
  } catch {
    return undefined;
  }
}

async function openDatabase() {
  await fs.mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS app_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS state_history (
      revision INTEGER PRIMARY KEY,
      updated_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
  `);
  return db;
}

function isAppState(value) {
  return (
    value &&
    typeof value === "object" &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.categories) &&
    Array.isArray(value.tags) &&
    Array.isArray(value.transactions) &&
    Array.isArray(value.budgets) &&
    Array.isArray(value.recurringRules) &&
    Array.isArray(value.importBatches) &&
    Array.isArray(value.inboxDrafts) &&
    Array.isArray(value.fxRates) &&
    (!("agentConversations" in value) || Array.isArray(value.agentConversations))
  );
}

function applyServerMigrations(state) {
  return {
    ...state,
    agentConversations: dedupeAgentConversations(Array.isArray(state.agentConversations) ? state.agentConversations : []),
    accounts: state.accounts.map((account) => {
      if (account.id === "account_prestamos_uyu" && account.initialBalance === 0) {
        return { ...account, initialBalance: 28549 };
      }
      return account;
    })
  };
}

function dedupeAgentConversations(conversations) {
  let keptEmptyConversation = false;
  return conversations.filter((conversation) => {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const hasUserMessage = messages.some((message) => message?.role === "user");
    if (conversation?.title !== "Nueva conversación" || hasUserMessage) return true;
    if (keptEmptyConversation) return false;
    keptEmptyConversation = true;
    return true;
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) {
      throw new Error("Payload too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const absolutePath = path.resolve(distDir, `.${requested}`);
  if (!absolutePath.startsWith(distDir)) {
    sendJson(response, 403, { ok: false, error: "Forbidden" });
    return;
  }

  try {
    const stat = await fs.stat(absolutePath);
    const filePath = stat.isDirectory() ? path.join(absolutePath, "index.html") : absolutePath;
    const body = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
    response.end(body);
  } catch {
    const indexPath = path.join(distDir, "index.html");
    try {
      const body = await fs.readFile(indexPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Run npm run build before using the standalone sync server.");
    }
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json" || extension === ".webmanifest") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sanitizeAgentHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-16).flatMap((item) => {
    const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "";
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    if (!role || !content) return [];
    return [
      {
        role,
        content: content.slice(0, 900),
        createdAt: typeof item?.createdAt === "string" ? item.createdAt : "",
        agentName: typeof item?.agentName === "string" ? item.agentName.slice(0, 80) : undefined
      }
    ];
  });
}

async function loadLocalEnv(filePath) {
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const [, key, rawValue] = match;
    if (process.env[key]) return;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  });
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function getAgentModel() {
  return process.env.OPENAI_MODEL || "gpt-5.6-terra";
}

function getVisionModel() {
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-5.6";
}

function getAgentReasoningEffort() {
  return process.env.AGENT_REASONING_EFFORT || "medium";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
