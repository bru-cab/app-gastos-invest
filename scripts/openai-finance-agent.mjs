import { createFinanceToolExecutor, financeToolDefinitions } from "./agent-finance-tools.mjs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_REASONING_EFFORT = "medium";
const MAX_TOOL_STEPS = 8;
const DEFAULT_SUGGESTIONS = [
  "¿Cuánto gasté en mi último viaje a Europa?",
  "Graficá mis gastos por categoría este mes",
  "Dame mis salarios durante todo este año",
  "¿Qué categoría gasté más este mes?"
];

export async function runOpenAiFinanceAgent({
  message,
  history = [],
  state,
  apiKey,
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
  nowIso = todayIso(),
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const executeFinanceTool = createFinanceToolExecutor(state, nowIso);
  const toolCalls = [];
  let latestChart;
  const input = [
    {
      role: "developer",
      content: buildDeveloperPrompt(nowIso)
    }
  ];
  const historyText = buildConversationHistoryText(history);
  if (historyText) {
    input.push({
      role: "user",
      content: historyText
    });
  }
  input.push({
    role: "user",
    content: message
  });

  let response;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    response = await createResponse(fetchImpl, apiKey, {
      model,
      input,
      tools: financeToolDefinitions,
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      max_output_tokens: 5000,
      reasoning: { effort: reasoningEffort }
    });

    const calls = (response.output ?? []).filter((item) => item.type === "function_call");
    if (calls.length === 0) return normalizeAgentAnswer(response, toolCalls, model, "", latestChart);

    input.push(...response.output);

    for (const call of calls) {
      const args = safeJsonParse(call.arguments, {});
      const result = executeFinanceTool(call.name, args);
      if (result?.chart) latestChart = result.chart;
      toolCalls.push({
        name: call.name,
        summary: summarizeToolResult(call.name, result),
        args: summarizeToolArgs(args),
        result: truncateToolResult(result)
      });
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }
  }

  return normalizeAgentAnswer(response, toolCalls, model, "El agente llegó al límite de consultas internas; te dejo el mejor resumen parcial.", latestChart);
}

async function createResponse(fetchImpl, apiKey, body) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = payload?.error?.message ? `: ${payload.error.message}` : "";
    throw new Error(`OpenAI request failed (${response.status})${detail}`);
  }

  return payload;
}

function normalizeAgentAnswer(response, toolCalls, model, prefix = "", fallbackChart) {
  const outputText = extractOutputText(response).trim();
  const parsed = parseJsonObject(outputText);
  const answerText = parsed?.answer || outputText || "No pude generar una respuesta.";

  return {
    intent: "real_agent",
    title: parsed?.title || "Agente financiero",
    answer: prefix ? `${prefix} ${answerText}` : answerText,
    confidence: normalizeConfidence(parsed?.confidence),
    facts: normalizeFacts(parsed?.facts),
    rows: normalizeRows(parsed?.rows),
    suggestions: normalizeSuggestions(parsed?.suggestedQuestions ?? parsed?.suggestions),
    chart: normalizeChart(parsed?.chart ?? fallbackChart),
    toolCalls,
    agentName: "Orquestador financiero",
    mode: "openai",
    model,
    data: {
      responseId: response?.id ?? "",
      toolCallCount: toolCalls.length
    }
  };
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n");
}

function parseJsonObject(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function normalizeFacts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((fact) => ({
    label: String(fact?.label ?? "Dato").slice(0, 40),
    value: String(fact?.value ?? "").slice(0, 120),
    tone: normalizeTone(fact?.tone)
  }));
}

function normalizeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((row) => ({
    date: String(row?.date ?? "").slice(0, 24),
    title: String(row?.title ?? "").slice(0, 120),
    meta: String(row?.meta ?? "").slice(0, 160),
    amount: String(row?.amount ?? "").slice(0, 60),
    tone: normalizeTone(row?.tone)
  }));
}

function normalizeChart(value) {
  if (!value || typeof value !== "object") return undefined;
  const points = Array.isArray(value.points)
    ? value.points
        .map((point) => ({
          label: String(point?.label ?? "").slice(0, 42),
          value: Number(point?.value),
          valueFormatted: String(point?.valueFormatted ?? point?.value ?? "").slice(0, 60),
          color: normalizeChartColor(point?.color),
          meta: point?.meta ? String(point.meta).slice(0, 80) : undefined
        }))
        .filter((point) => point.label && Number.isFinite(point.value))
        .slice(0, 24)
    : [];
  if (points.length === 0) return undefined;

  return {
    type: value.type === "line" || value.type === "pie" ? value.type : "bar",
    title: String(value.title ?? "Grafico").slice(0, 80),
    subtitle: value.subtitle ? String(value.subtitle).slice(0, 120) : undefined,
    valueLabel: value.valueLabel ? String(value.valueLabel).slice(0, 40) : undefined,
    totalFormatted: value.totalFormatted ? String(value.totalFormatted).slice(0, 60) : undefined,
    points
  };
}

function normalizeChartColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) ? value : undefined;
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value)) return DEFAULT_SUGGESTIONS;

  const suggestions = value
    .map((suggestion) => String(suggestion).trim())
    .filter((suggestion) => suggestion && !hasUnexpectedScript(suggestion))
    .slice(0, 4);

  return suggestions.length ? suggestions : DEFAULT_SUGGESTIONS;
}

function hasUnexpectedScript(value) {
  return /[\u0400-\u04FF\u0600-\u06FF\u10A0-\u10FF\u3040-\u30FF\u4E00-\u9FFF]/u.test(value);
}

function buildConversationHistoryText(history) {
  const safeHistory = Array.isArray(history) ? history : [];
  const lines = safeHistory
    .slice(-16)
    .map((item) => {
      const role = item?.role === "assistant" ? item?.agentName || "assistant" : "Bruno";
      const content = String(item?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
      return content ? `${role}: ${content}` : "";
    })
    .filter(Boolean);

  if (lines.length === 0) return "";
  return `Memoria reciente de esta conversación. Usala para resolver referencias como "ese gasto", "eso", "lo anterior" o "ya te dije". Si la última pregunta del usuario contradice algo anterior, hacé caso a la última pregunta.\n${lines.join("\n")}`;
}

function normalizeConfidence(value) {
  return ["alta", "media", "baja"].includes(value) ? value : "media";
}

function normalizeTone(value) {
  return ["good", "bad", "neutral", "accent"].includes(value) ? value : "neutral";
}

function summarizeToolResult(name, result) {
  if (name === "get_finance_schema") return `${result?.counts?.transactions ?? 0} movimientos disponibles`;
  if (name === "query_transactions") return `${result?.returned ?? 0} de ${result?.count ?? 0} movimientos`;
  if (name === "aggregate_transactions") return `${result?.returnedGroups ?? 0} grupos, total ${result?.totalUyuFormatted ?? ""}`.trim();
  if (name === "build_transaction_chart") return `${result?.returnedPoints ?? 0} puntos para ${result?.chart?.type ?? "grafico"}`;
  if (name === "find_trip_groups") return `${result?.trips?.length ?? 0} viajes encontrados`;
  if (name === "compare_products") {
    const cheapest = result?.unitPriceComparison?.cheapest;
    const cheapestLabel = cheapest ? `${cheapest.merchant} ${cheapest.unitPriceUyuFormatted}` : "";
    return `${result?.count ?? 0} items, total ${result?.totalUyuFormatted ?? ""}, ahorro ${result?.totalDiscountUyuFormatted ?? ""}${cheapestLabel ? `, más barato por unidad: ${cheapestLabel}` : ""}`.trim();
  }
  if (name === "find_referenced_transaction") return `${result?.rows?.length ?? 0} movimientos candidatos`;
  return "consulta ejecutada";
}

function summarizeToolArgs(args) {
  const filters = args?.filters && typeof args.filters === "object" ? args.filters : args;
  const pairs = Object.entries(filters ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 8)
    .map(([key, value]) => `${key}=${String(value).slice(0, 32)}`);
  return pairs.join(", ");
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truncateToolResult(value) {
  try {
    const json = JSON.stringify(value ?? {});
    return json.length > 4000 ? `${json.slice(0, 3997)}…` : json;
  } catch {
    return JSON.stringify({ error: "resultado no serializable" });
  }
}

function buildDeveloperPrompt(nowIso) {
  return `
Sos el agente financiero personal de Bruno para la app Gastos Invest.
Fecha actual: ${nowIso}. Timezone: America/Montevideo.

Objetivo:
- Contestá preguntas sobre gastos, ingresos, salarios, viajes, cuentas, categorías, tags y productos de tickets.
- Usá español rioplatense claro y breve.
- No mezcles otros idiomas ni alfabetos en la respuesta o sugerencias.
- Sos read-only: nunca propongas editar, borrar ni crear datos como si ya lo hubieras hecho.

Reglas críticas:
- Para cualquier respuesta numérica, primero llamá herramientas financieras. No inventes totales.
- Usá la memoria reciente de la conversación para resolver referencias contextuales como "ese gasto", "eso", "lo anterior" o "ya te dije".
- Si el usuario identifica un gasto por monto, usá query_transactions con amount o amountUyu y otros datos de la memoria para encontrarlo.
- Para follow-ups sobre "ese gasto" o "el de X", preferí find_referenced_transaction con el monto y palabras de contexto.
- Para "este año", usá desde ${nowIso.slice(0, 4)}-01-01 hasta ${nowIso}.
- Para "este mes", usá el mes calendario actual hasta ${nowIso}.
- Si preguntan por salarios/sueldo, filtrá ingresos con salary=true.
- El filtro currency significa moneda original del movimiento. No uses currency=UYU para pedir totales "en pesos"; todas las agregaciones ya devuelven totalUyu.
- Si preguntan por viajes, usá find_trip_groups.
- Si preguntan por productos/precios/tickets/descuentos/ahorros por compra, usá compare_products.
- Para "más barato/caro por kilo o por unidad", usá unitPriceComparison.unitPriceUyu y el campo unitPriceUyu de cada fila de compare_products (menor = más barato). La descripción y el comercio de cada fila son la evidencia exacta.
- Nunca inventes filas, comercios, precios ni productos: usá literalmente description, merchant, date y precios devueltos por compare_products/query_transactions.
- Si un producto no aparece en el rango de fechas pedido (por ejemplo "este mes" con pocos días), repetí compare_products sin startDate/endDate para ubicar compras anteriores y avisá el periodo real donde aparece.
- Si piden graficar, visualizar, comparar con gráfico, barras, línea, torta/pie, evolución o tendencia, usá build_transaction_chart. Copiá el objeto "chart" devuelto por la herramienta en la respuesta final.
- Si una pregunta es ambigua, hacé una pregunta concreta de aclaración y no inventes cifras.
- Si usás una agregación, incluí filas o grupos como evidencia.

Formato de salida:
Respondé solamente JSON válido, sin Markdown:
{
  "title": "título corto",
  "answer": "respuesta conversacional con el resultado principal",
  "confidence": "alta|media|baja",
  "facts": [
    {"label": "Total", "value": "$ 0,00", "tone": "good|bad|neutral|accent"}
  ],
  "rows": [
    {"date": "01/09/2026", "title": "Salary", "meta": "Itau USD · Salary", "amount": "US$ 0,00", "tone": "good|bad|neutral|accent"}
  ],
  "chart": {
    "type": "bar|line|pie",
    "title": "título del gráfico",
    "subtitle": "periodo y cantidad",
    "valueLabel": "Total UYU",
    "totalFormatted": "$ 0,00",
    "points": [
      {"label": "septiembre 2026", "value": 0, "valueFormatted": "$ 0,00", "color": "#2b6cb0", "meta": "1 movimiento"}
    ]
  },
  "suggestedQuestions": ["otra pregunta útil"]
}
`.trim();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
