import type {
  AgentAnswer,
  AgentChart,
  AgentChartPoint,
  AgentConfidence,
  AgentConversationMessage,
  AgentEvidenceRow,
  AgentFact,
  AgentToolCall
} from "../types";

export interface AgentHealth {
  ok: boolean;
  configured: boolean;
  mode: "openai" | "offline";
  model: string;
  reasoningEffort: string;
}

export async function getAgentHealth(): Promise<AgentHealth | undefined> {
  const apiBase = getApiBase();
  if (!apiBase) return undefined;
  const response = await fetchWithTimeout(`${apiBase}/api/agent/health`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) return undefined;
  return (await response.json()) as AgentHealth;
}

export async function askRemoteFinanceAgent(message: string, sessionId: string, history: AgentConversationMessage[] = []): Promise<AgentAnswer> {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error("No hay backend conectado");

  const response = await fetchWithTimeout(`${apiBase}/api/agent/chat`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message, sessionId, history: serializeHistory(history) })
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "No pude consultar el agente");
  return normalizeRemoteAnswer(body);
}

function normalizeRemoteAnswer(value: Record<string, unknown>): AgentAnswer {
  return {
    intent: "real_agent",
    title: stringValue(value.title, "Agente financiero"),
    answer: stringValue(value.answer, "No pude generar una respuesta."),
    confidence: confidenceValue(value.confidence),
    facts: arrayValue(value.facts).map(normalizeFact),
    rows: arrayValue(value.rows).map(normalizeRow),
    suggestions: arrayValue(value.suggestions).map((item) => String(item)).filter(Boolean),
    chart: normalizeChart(value.chart),
    toolCalls: arrayValue(value.toolCalls).map(normalizeToolCall),
    agentName: typeof value.agentName === "string" ? value.agentName : "Orquestador financiero",
    mode: value.mode === "openai" ? "openai" : "offline",
    model: typeof value.model === "string" ? value.model : undefined,
    data: typeof value.data === "object" && value.data ? (value.data as AgentAnswer["data"]) : {}
  };
}

function serializeHistory(history: AgentConversationMessage[]) {
  return history.slice(-16).map((message) => ({
    role: message.role,
    content: message.answer ? `${message.answer.title}: ${message.answer.answer}` : message.content,
    createdAt: message.createdAt,
    agentName: message.answer?.agentName
  }));
}

function normalizeFact(value: unknown): AgentFact {
  const fact = value as Partial<AgentFact>;
  return {
    label: stringValue(fact?.label, "Dato"),
    value: stringValue(fact?.value, ""),
    tone: toneValue(fact?.tone)
  };
}

function normalizeRow(value: unknown): AgentEvidenceRow {
  const row = value as Partial<AgentEvidenceRow>;
  return {
    date: stringValue(row?.date, ""),
    title: stringValue(row?.title, ""),
    meta: stringValue(row?.meta, ""),
    amount: stringValue(row?.amount, ""),
    tone: toneValue(row?.tone)
  };
}

function normalizeToolCall(value: unknown): AgentToolCall {
  const toolCall = value as Partial<AgentToolCall>;
  return {
    name: stringValue(toolCall?.name, "tool"),
    summary: stringValue(toolCall?.summary, ""),
    args: typeof toolCall?.args === "string" ? toolCall.args : undefined,
    result: typeof toolCall?.result === "string" ? toolCall.result : undefined
  };
}

function normalizeChart(value: unknown): AgentChart | undefined {
  if (!value || typeof value !== "object") return undefined;
  const chart = value as Partial<AgentChart>;
  const points = arrayValue(chart.points).map(normalizeChartPoint).filter((point): point is AgentChartPoint => Boolean(point));
  if (points.length === 0) return undefined;

  return {
    type: chart.type === "line" || chart.type === "pie" ? chart.type : "bar",
    title: stringValue(chart.title, "Gráfico"),
    subtitle: typeof chart.subtitle === "string" ? chart.subtitle : undefined,
    valueLabel: typeof chart.valueLabel === "string" ? chart.valueLabel : undefined,
    totalFormatted: typeof chart.totalFormatted === "string" ? chart.totalFormatted : undefined,
    points: points.slice(0, 24)
  };
}

function normalizeChartPoint(value: unknown): AgentChartPoint | undefined {
  const point = value as Partial<AgentChartPoint>;
  const numericValue = Number(point?.value);
  if (!point || !Number.isFinite(numericValue)) return undefined;
  const label = stringValue(point.label, "").trim();
  if (!label) return undefined;

  return {
    label,
    value: numericValue,
    valueFormatted: stringValue(point.valueFormatted, String(numericValue)),
    color: typeof point.color === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(point.color) ? point.color : undefined,
    meta: typeof point.meta === "string" ? point.meta : undefined
  };
}

function confidenceValue(value: unknown): AgentConfidence {
  return value === "alta" || value === "media" || value === "baja" ? value : "media";
}

function toneValue(value: unknown): AgentFact["tone"] {
  return value === "good" || value === "bad" || value === "accent" || value === "neutral" ? value : "neutral";
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getApiBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.protocol === "file:") return undefined;
  return window.location.origin;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
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
