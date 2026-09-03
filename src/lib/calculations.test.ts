import { describe, expect, it } from "vitest";
import type { AppState, Transaction } from "../types";
import { createInitialState } from "../data/seed";
import { getAccountBalances, getBudgetUsages } from "./calculations";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: `txn_${Math.random()}`,
    type: "expense",
    date: "2026-09-10",
    accountId: "account_itau_uyu",
    payee: "Test",
    note: "",
    currency: "UYU",
    amount: 1000,
    amountUyu: 1000,
    fxRateToUyu: 1,
    fxSource: "not_applicable",
    paymentMethod: "credit",
    status: "confirmed",
    splits: [{ id: "split_1", categoryId: "cat_groceries", tagIds: [], amount: 1000, amountUyu: 1000 }],
    source: "manual",
    createdAt: "2026-09-10T00:00:00.000Z",
    ...overrides
  };
}

describe("ledger calculations", () => {
  it("updates active account balances from expenses, income and transfers", () => {
    const state = createInitialState();
    state.transactions = [
      tx({ type: "expense", amount: 2000, amountUyu: 2000 }),
      tx({ type: "income", amount: 5000, amountUyu: 5000 }),
      tx({
        type: "transfer",
        amount: 1000,
        amountUyu: 1000,
        toAccountId: "account_mercadopago_uyu",
        splits: [{ id: "split_transfer", categoryId: "cat_uncategorized", tagIds: [], amount: 1000, amountUyu: 1000 }]
      })
    ];

    const balances = getAccountBalances(state);
    expect(balances.find((item) => item.account.id === "account_itau_uyu")?.balance).toBe(44500);
    expect(balances.find((item) => item.account.id === "account_mercadopago_uyu")?.balance).toBe(8800);
  });
});

describe("budget calculations", () => {
  it("counts split spending into matching category budgets", () => {
    const state = createInitialState();
    state.transactions = [
      tx({
        amount: 3000,
        amountUyu: 3000,
        splits: [
          { id: "split_food", categoryId: "cat_groceries", tagIds: [], amount: 2200, amountUyu: 2200 },
          { id: "split_fun", categoryId: "cat_leisure", tagIds: [], amount: 800, amountUyu: 800 }
        ]
      })
    ];

    const groceries = getBudgetUsages(state, "2026-09").find((usage) => usage.budget.id === "budget_groceries");
    expect(groceries?.spentUyu).toBe(2200);
  });

  it("adds previous unused allowance for rollover budgets", () => {
    const state: AppState = createInitialState();
    state.budgets = [
      {
        id: "budget_rollover_test",
        categoryId: "cat_restaurants",
        amountUyu: 1000,
        mode: "rollover",
        active: true,
        startsAtMonth: "2026-08"
      }
    ];
    state.transactions = [
      tx({
        date: "2026-08-12",
        amount: 300,
        amountUyu: 300,
        splits: [{ id: "split_aug", categoryId: "cat_restaurants", tagIds: [], amount: 300, amountUyu: 300 }]
      }),
      tx({
        date: "2026-09-01",
        amount: 200,
        amountUyu: 200,
        splits: [{ id: "split_sep", categoryId: "cat_restaurants", tagIds: [], amount: 200, amountUyu: 200 }]
      })
    ];

    const usage = getBudgetUsages(state, "2026-09")[0];
    expect(usage.allowanceUyu).toBe(1700);
    expect(usage.remainingUyu).toBe(1500);
  });
});
