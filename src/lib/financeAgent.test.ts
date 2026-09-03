import { describe, expect, it } from "vitest";
import type { AppState, Currency, Transaction } from "../types";
import { askFinanceAgent } from "./financeAgent";

const state: AppState = {
  accounts: [
    {
      id: "account_itau_usd",
      name: "Itau USD",
      institution: "Itau",
      currency: "USD",
      initialBalance: 0,
      active: true,
      color: "#2b6cb0",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "account_itau_uyu",
      name: "Itau UYU",
      institution: "Itau",
      currency: "UYU",
      initialBalance: 0,
      active: true,
      color: "#2f855a",
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  categories: [
    { id: "cat_salary", name: "Salary", color: "#2f855a", icon: "circle" },
    { id: "cat_travel", name: "Travel", color: "#7c3aed", icon: "circle" },
    { id: "cat_home", name: "Home", color: "#0f766e", icon: "circle" },
    { id: "cat_groceries", name: "Groceries", color: "#dc2626", icon: "circle" }
  ],
  tags: [{ id: "tag_europa_2026", name: "Europa 2026", color: "#be123c" }],
  transactions: [
    incomeTx({ id: "salary_sep", date: "2026-09-01", amount: 5734, currency: "USD", fxRateToUyu: 39.2 }),
    incomeTx({ id: "salary_apr", date: "2026-04-01", amount: 5368, currency: "USD", fxRateToUyu: 40.55 }),
    expenseTx({
      id: "europe_deposit",
      date: "2026-01-23",
      payee: "Europa 2026",
      amount: 100,
      currency: "USD",
      fxRateToUyu: 40,
      tagIds: ["tag_europa_2026"],
      note: "Labels: Europa 2026"
    }),
    expenseTx({
      id: "europe_hotel",
      date: "2026-06-01",
      payee: "hotel praga",
      amount: 200,
      currency: "USD",
      fxRateToUyu: 40
    }),
    expenseTx({
      id: "europe_final",
      date: "2026-08-31",
      payee: "Europa 2026",
      amount: 300,
      currency: "USD",
      fxRateToUyu: 40,
      tagIds: ["tag_europa_2026"],
      note: "Labels: Europa 2026"
    }),
    expenseTx({
      id: "false_europe",
      date: "2026-06-02",
      payee: "llave francesa",
      amount: 360,
      currency: "UYU",
      categoryId: "cat_home",
      fxRateToUyu: 1
    }),
    expenseTx({
      id: "pollo_a",
      date: "2026-08-01",
      payee: "Local A",
      amount: 750,
      currency: "UYU",
      categoryId: "cat_groceries",
      fxRateToUyu: 1,
      lineItems: [
        {
          id: "item_pollo_a",
          description: "Pollo",
          amount: 500,
          amountUyu: 500,
          discountAmount: 50,
          discountSource: "Itaú",
          tagIds: [],
          confidence: 0.9
        },
        {
          id: "item_papas",
          description: "Papas",
          amount: 250,
          amountUyu: 250,
          tagIds: [],
          confidence: 0.9
        }
      ]
    }),
    expenseTx({
      id: "pollo_b",
      date: "2026-07-01",
      payee: "Local B",
      amount: 450,
      currency: "UYU",
      categoryId: "cat_groceries",
      fxRateToUyu: 1,
      lineItems: [
        {
          id: "item_pollo_b",
          description: "Pollo",
          amount: 450,
          amountUyu: 450,
          tagIds: [],
          confidence: 0.9
        }
      ]
    })
  ],
  budgets: [],
  recurringRules: [],
  importBatches: [],
  inboxDrafts: [],
  fxRates: [],
  agentConversations: []
};

describe("askFinanceAgent", () => {
  it("answers current and relative-month salary questions", () => {
    const current = askFinanceAgent("Cual fue mi salario este mes?", state, "2026-09-01");
    const fiveMonthsAgo = askFinanceAgent("Cual fue mi salario hace 5 meses?", state, "2026-09-01");

    expect(current.intent).toBe("income");
    expect(current.data.totalUyu).toBe(224772.8);
    expect(current.data.month).toBe("2026-09");
    expect(fiveMonthsAgo.data.totalUyu).toBe(217672.4);
    expect(fiveMonthsAgo.data.month).toBe("2026-04");
  });

  it("answers yearly salary questions grouped by month", () => {
    const answer = askFinanceAgent("dame mis salarios durante todo este año", state, "2026-09-01");

    expect(answer.intent).toBe("income");
    expect(answer.title).toBe("Salarios 2026");
    expect(answer.data.totalUyu).toBe(442445.2);
    expect(answer.rows.map((row) => row.date)).toEqual(["abril 2026", "septiembre 2026"]);
  });

  it("groups labelled Europe travel expenses and excludes false place-name matches", () => {
    const answer = askFinanceAgent("Cuanto gaste en mi ultimo viaje a Europa?", state, "2026-09-01");

    expect(answer.intent).toBe("travel");
    expect(answer.data.totalUyu).toBe(24000);
    expect(answer.data.count).toBe(3);
    expect(answer.rows.map((row) => row.title)).not.toContain("llave francesa");
  });

  it("uses receipt line items for product questions", () => {
    const answer = askFinanceAgent("Gaste mas en pollo?", state, "2026-09-01");

    expect(answer.intent).toBe("product");
    expect(answer.data.totalUyu).toBe(950);
    expect(answer.data.count).toBe(2);
    expect(answer.rows[0].title).toBe("Pollo");
  });

  it("recognizes pollo by synonym against suprema/ave line items", () => {
    const productState: AppState = {
      ...state,
      transactions: [
        ...state.transactions,
        expenseTx({
          id: "suprema_a",
          date: "2026-08-15",
          payee: "Frog Maxishop",
          amount: 375.7,
          currency: "UYU",
          categoryId: "cat_groceries",
          fxRateToUyu: 1,
          lineItems: [
            {
              id: "item_suprema",
              description: "Suprema de ave Del Oeste",
              amount: 375.7,
              amountUyu: 375.7,
              tagIds: [],
              confidence: 0.9
            }
          ]
        })
      ]
    };

    const answer = askFinanceAgent("¿Cuántas veces compré pollo?", productState, "2026-09-01");

    expect(answer.intent).toBe("product");
    expect(answer.rows.some((row) => row.title === "Suprema de ave Del Oeste")).toBe(true);
  });

  it("answers Itau savings questions from receipt discounts", () => {
    const answer = askFinanceAgent("Cuanto ahorre con Itau?", state, "2026-09-01");

    expect(answer.intent).toBe("savings");
    expect(answer.data.totalUyu).toBe(50);
    expect(answer.data.count).toBe(1);
    expect(answer.rows[0].title).toBe("Pollo");
  });
});

function incomeTx(overrides: Partial<Transaction>): Transaction {
  return tx({
    type: "income",
    payee: "Salary",
    categoryId: "cat_salary",
    ...overrides
  });
}

function expenseTx(overrides: Partial<Transaction> & { categoryId?: string; tagIds?: string[] }): Transaction {
  return tx({
    type: "expense",
    categoryId: "cat_travel",
    ...overrides
  });
}

function tx(overrides: Partial<Transaction> & { categoryId?: string; tagIds?: string[] }): Transaction {
  const currency = overrides.currency ?? "UYU";
  const amount = overrides.amount ?? 1000;
  const fxRateToUyu = overrides.fxRateToUyu ?? (currency === "USD" ? 40 : 1);
  const categoryId = overrides.categoryId ?? "cat_groceries";
  const tagIds = overrides.tagIds ?? [];
  const amountUyu = currency === "USD" ? amount * fxRateToUyu : amount;
  return {
    id: overrides.id ?? "txn_test",
    type: overrides.type ?? "expense",
    date: overrides.date ?? "2026-09-01",
    accountId: currency === "USD" ? "account_itau_usd" : "account_itau_uyu",
    payee: overrides.payee ?? "Test",
    note: overrides.note ?? "",
    currency: currency as Currency,
    amount,
    amountUyu,
    fxRateToUyu,
    fxSource: currency === "USD" ? "bank" : "not_applicable",
    paymentMethod: "credit",
    status: "confirmed",
    splits: [
      {
        id: `${overrides.id ?? "txn_test"}_split`,
        categoryId,
        tagIds,
        amount,
        amountUyu
      }
    ],
    lineItems: overrides.lineItems,
    source: "manual",
    createdAt: "2026-09-01T00:00:00.000Z"
  };
}
