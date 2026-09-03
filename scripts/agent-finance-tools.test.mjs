import { describe, expect, it } from "vitest";
import {
  aggregateTransactions,
  buildTransactionChart,
  compareProducts,
  createFinanceToolExecutor,
  findReferencedTransaction,
  findTripGroups,
  getFinanceSchema
} from "./agent-finance-tools.mjs";
import { runOpenAiFinanceAgent } from "./openai-finance-agent.mjs";

const state = {
  accounts: [{ id: "itau_usd", name: "Itau USD", institution: "Itau", currency: "USD", active: true }],
  categories: [
    { id: "salary", name: "Salary" },
    { id: "travel", name: "Travel" }
  ],
  tags: [{ id: "europa_2026", name: "Europa 2026" }],
  transactions: [
    tx({ id: "salary_jan", type: "income", date: "2026-01-01", amount: 5000, categoryId: "salary", payee: "Salary" }),
    tx({ id: "salary_feb", type: "income", date: "2026-02-01", amount: 5100, categoryId: "salary", payee: "Salary" }),
    tx({ id: "salary_old", type: "income", date: "2025-12-01", amount: 4900, categoryId: "salary", payee: "Salary" }),
    tx({ id: "europa_a", type: "expense", date: "2026-03-01", amount: 100, categoryId: "travel", payee: "Europa 2026", tagIds: ["europa_2026"] }),
    tx({ id: "europa_b", type: "expense", date: "2026-04-01", amount: 200, categoryId: "travel", payee: "hotel praga" }),
    tx({ id: "ruta_pokes", type: "expense", date: "2025-08-24", amount: 489.48, categoryId: "travel", payee: "pokes ruta 66" })
  ],
  budgets: [],
  recurringRules: [],
  importBatches: [],
  inboxDrafts: [],
  fxRates: [],
  agentConversations: []
};

describe("agent finance tools", () => {
  it("aggregates salary income by month for a year", () => {
    const result = aggregateTransactions(state, undefined, {
      filters: { type: "income", salary: true, year: 2026 },
      groupBy: "month",
      sort: "key_asc"
    });

    expect(result.count).toBe(2);
    expect(result.totalUyu).toBe(404000);
    expect(result.groups.map((group) => [group.key, group.totalUyu])).toEqual([
      ["2026-01", 200000],
      ["2026-02", 204000]
    ]);
  });

  it("matches Spanish salary aliases against imported Salary rows", () => {
    const result = aggregateTransactions(state, undefined, {
      filters: { type: "income", search: "sueldo", month: "2026-01" },
      groupBy: "none"
    });

    expect(result.count).toBe(1);
    expect(result.totalUyu).toBe(200000);
  });

  it("ignores empty numeric filters emitted by the model", () => {
    const result = aggregateTransactions(state, undefined, {
      filters: { type: "income", salary: true, startDate: "2026-01-01", endDate: "2026-01-31", year: 0, amount: 0, amountUyu: 0 },
      groupBy: "none"
    });

    expect(result.count).toBe(1);
    expect(result.totalUyu).toBe(200000);
  });

  it("does not treat salary totals in pesos as original-currency UYU salary only", () => {
    const result = aggregateTransactions(state, undefined, {
      filters: { type: "income", salary: true, startDate: "2026-01-01", endDate: "2026-01-31", currency: "UYU" },
      groupBy: "none"
    });

    expect(result.count).toBe(1);
    expect(result.originalTotalsFormatted).toBe("US$ 5.000,00");
    expect(result.totalUyu).toBe(200000);
  });

  it("groups Europe travel by explicit label and nearby travel rows", () => {
    const result = findTripGroups(state, undefined, { destination: "Europa", latestOnly: true });

    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].label).toBe("Europa 2026");
    expect(result.trips[0].count).toBe(2);
    expect(result.trips[0].totalUyu).toBe(12000);
  });

  it("exposes schema hints for the model", () => {
    const result = getFinanceSchema(state, undefined, "2026-09-01");

    expect(result.timezone).toBe("America/Montevideo");
    expect(result.queryHints.currentYear).toContain("2026-01-01");
  });

  it("builds chart-ready monthly finance data", () => {
    const result = buildTransactionChart(state, undefined, {
      filters: { type: "income", salary: true, year: 2026 },
      groupBy: "month",
      chartType: "line",
      title: "Salarios 2026"
    });

    expect(result.returnedPoints).toBe(2);
    expect(result.chart.type).toBe("line");
    expect(result.chart.title).toBe("Salarios 2026");
    expect(result.chart.points.map((point) => [point.label, point.value])).toEqual([
      ["enero 2026", 200000],
      ["febrero 2026", 204000]
    ]);
  });

  it("exposes the chart builder through the finance tool executor", () => {
    const execute = createFinanceToolExecutor(state, "2026-09-01");
    const result = execute("build_transaction_chart", { filters: { type: "expense" }, groupBy: "category", chartType: "bar" });

    expect(result.chart.points[0].label).toBe("Travel");
    expect(result.chart.points[0].valueFormatted).toContain("$");
    expect(result.metric).toBe("totalUyu");
  });

  it("preserves chart tool output for the final agent answer", async () => {
    const responses = [
      {
        output: [
          {
            type: "function_call",
            call_id: "call_chart",
            name: "build_transaction_chart",
            arguments: JSON.stringify({
              filters: { type: "income", salary: true, year: 2026 },
              groupBy: "month",
              chartType: "line",
              title: "Salarios 2026"
            })
          }
        ]
      },
      {
        id: "resp_done",
        output_text: JSON.stringify({
          title: "Salarios 2026",
          answer: "Te dejo la evolución de salarios.",
          confidence: "alta",
          facts: [],
          rows: [],
          suggestedQuestions: []
        })
      }
    ];
    const fetchImpl = async () => ({
      ok: true,
      json: async () => responses.shift()
    });

    const answer = await runOpenAiFinanceAgent({
      message: "Graficá mis salarios durante 2026",
      state,
      apiKey: "test",
      fetchImpl,
      nowIso: "2026-09-01"
    });

    expect(answer.chart?.type).toBe("line");
    expect(answer.chart?.points.map((point) => point.value)).toEqual([200000, 204000]);
  });

  it("finds a transaction referenced by amount and conversational context", () => {
    const result = findReferencedTransaction(state, undefined, { amount: 489.48, context: "ruta 66" });

    expect(result.rows[0].id).toBe("ruta_pokes");
  });

  it("matches pollo by synonym against suprema/ave line items", () => {
    const productState = {
      ...state,
      transactions: [
        receiptTx("2026-08-12", "Frog Maxishop", "Suprema de ave Del Oeste", 0.64, 375.7),
        receiptTx("2026-09-02", "PedidosYa Market 12", "Suprema Fresca En Bandeja Tres Arroyos", 0.51, 323.81)
      ]
    };

    const result = compareProducts(productState, undefined, { product: "pollo" });

    expect(result.count).toBe(2);
    expect(result.rows.map((row) => row.description)).toEqual([
      "Suprema Fresca En Bandeja Tres Arroyos",
      "Suprema de ave Del Oeste"
    ]);
  });

  it("reports the cheapest product per unit (kilo/unidad)", () => {
    const productState = {
      ...state,
      transactions: [
        receiptTx("2026-08-12", "Frog Maxishop", "Suprema de ave Del Oeste", 0.64, 375.7),
        receiptTx("2026-09-02", "PedidosYa Market 12", "Suprema Fresca En Bandeja Tres Arroyos", 0.51, 323.81)
      ]
    };

    const result = compareProducts(productState, undefined, { product: "suprema" });
    const comparison = result.unitPriceComparison;

    expect(comparison).not.toBeNull();
    expect(comparison.cheapest.merchant).toBe("Frog Maxishop");
    expect(comparison.priciest.merchant).toBe("PedidosYa Market 12");
  });
});

function tx({ id, type, date, amount, categoryId, payee, tagIds = [] }) {
  return {
    id,
    type,
    date,
    accountId: "itau_usd",
    payee,
    note: tagIds.length ? "Labels: Europa 2026" : "",
    currency: "USD",
    amount,
    amountUyu: amount * 40,
    fxRateToUyu: 40,
    fxSource: "bank",
    paymentMethod: "credit",
    status: "confirmed",
    splits: [{ id: `${id}_split`, categoryId, tagIds, amount, amountUyu: amount * 40 }],
    createdAt: `${date}T00:00:00.000Z`
  };
}

function receiptTx(date, payee, description, quantity, amount) {
  return {
    id: `receipt_${date}_${description}`,
    type: "expense",
    date,
    accountId: "itau_usd",
    payee,
    note: "",
    currency: "UYU",
    amount,
    amountUyu: amount,
    fxRateToUyu: 1,
    fxSource: "manual",
    paymentMethod: "debit",
    status: "confirmed",
    splits: [{ id: `split_${description}`, categoryId: "travel", tagIds: [], amount, amountUyu: amount }],
    lineItems: [{ id: `li_${description}`, description, quantity, amount, amountUyu: amount, categoryId: "travel", tagIds: [], confidence: 1 }],
    createdAt: `${date}T00:00:00.000Z`
  };
}
