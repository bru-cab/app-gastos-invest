import { describe, expect, it } from "vitest";
import type { Tag, Transaction } from "../types";
import { createInitialState } from "../data/seed";
import { getTagUsageCounts, orderTagsByFrequency, suggestTags } from "./tagSuggestions";

const tags: Tag[] = [
  { id: "tag_recurrente", name: "recurrente", color: "#475569" },
  { id: "tag_trabajo", name: "trabajo", color: "#2563eb" },
  { id: "tag_casa", name: "casa", color: "#0f766e" }
];

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

describe("getTagUsageCounts", () => {
  it("counts tags across splits and line items once per transaction", () => {
    const transactions = [
      tx({
        splits: [{ id: "split_1", categoryId: "cat_groceries", tagIds: ["tag_casa"], amount: 1000, amountUyu: 1000 }],
        lineItems: [
          { id: "item_1", description: "Item", amount: 1000, amountUyu: 1000, tagIds: ["tag_casa", "tag_trabajo"], confidence: 1 }
        ]
      }),
      tx({
        splits: [{ id: "split_2", categoryId: "cat_groceries", tagIds: ["tag_trabajo"], amount: 500, amountUyu: 500 }]
      })
    ];

    const counts = getTagUsageCounts(transactions);
    expect(counts.get("tag_casa")).toBe(1);
    expect(counts.get("tag_trabajo")).toBe(2);
    expect(counts.get("tag_recurrente")).toBeUndefined();
  });

  it("ignores non-confirmed transactions", () => {
    const counts = getTagUsageCounts([
      tx({
        status: "draft",
        splits: [{ id: "split_draft", categoryId: "cat_groceries", tagIds: ["tag_casa"], amount: 1000, amountUyu: 1000 }]
      })
    ]);
    expect(counts.size).toBe(0);
  });
});

describe("orderTagsByFrequency", () => {
  it("orders most used tags first with alphabetical tiebreak", () => {
    const transactions = [
      tx({ splits: [{ id: "split_1", categoryId: "cat_groceries", tagIds: ["tag_trabajo"], amount: 1000, amountUyu: 1000 }] }),
      tx({ splits: [{ id: "split_2", categoryId: "cat_groceries", tagIds: ["tag_trabajo"], amount: 1000, amountUyu: 1000 }] }),
      tx({ splits: [{ id: "split_3", categoryId: "cat_groceries", tagIds: ["tag_casa"], amount: 1000, amountUyu: 1000 }] })
    ];

    const ordered = orderTagsByFrequency(tags, transactions);
    expect(ordered[0].id).toBe("tag_trabajo");
    expect(ordered[1].id).toBe("tag_casa");
    expect(ordered[2].id).toBe("tag_recurrente");
  });
});

describe("suggestTags", () => {
  it("ranks tags whose historical notes share tokens with the input", () => {
    const transactions = [
      tx({
        payee: "Uber",
        note: "viaje al aeropuerto",
        amount: 450,
        amountUyu: 450,
        splits: [{ id: "split_1", categoryId: "cat_transport", tagIds: ["tag_trabajo"], amount: 450, amountUyu: 450 }]
      }),
      tx({
        payee: "Disco",
        note: "compra semanal",
        amount: 3420,
        amountUyu: 3420,
        splits: [{ id: "split_2", categoryId: "cat_groceries", tagIds: ["tag_casa"], amount: 3420, amountUyu: 3420 }]
      })
    ];

    const suggested = suggestTags(tags, transactions, {
      payee: "Uber",
      note: "viaje aeropuerto",
      amount: 450,
      currency: "UYU"
    });

    expect(suggested[0].id).toBe("tag_trabajo");
  });

  it("boosts text matches with a similar price", () => {
    const transactions = [
      tx({
        payee: "Netflix",
        note: "suscripcion mensual",
        amount: 600,
        amountUyu: 600,
        splits: [{ id: "split_1", categoryId: "cat_services", tagIds: ["tag_recurrente"], amount: 600, amountUyu: 600 }]
      }),
      tx({
        payee: "Spotify",
        note: "suscripcion mensual",
        amount: 1200,
        amountUyu: 1200,
        splits: [{ id: "split_2", categoryId: "cat_services", tagIds: ["tag_casa"], amount: 1200, amountUyu: 1200 }]
      })
    ];

    const suggested = suggestTags(tags, transactions, {
      payee: "",
      note: "suscripcion",
      amount: 600,
      currency: "UYU"
    });

    expect(suggested[0].id).toBe("tag_recurrente");
  });

  it("falls back to frequency when the input has no text", () => {
    const transactions = [
      tx({ splits: [{ id: "split_1", categoryId: "cat_groceries", tagIds: ["tag_casa"], amount: 1000, amountUyu: 1000 }] }),
      tx({ splits: [{ id: "split_2", categoryId: "cat_groceries", tagIds: ["tag_casa"], amount: 1000, amountUyu: 1000 }] }),
      tx({ splits: [{ id: "split_3", categoryId: "cat_groceries", tagIds: ["tag_trabajo"], amount: 1000, amountUyu: 1000 }] })
    ];

    const suggested = suggestTags(tags, transactions, { payee: "", note: "", amount: 1000, currency: "UYU" });
    expect(suggested[0].id).toBe("tag_casa");
  });

  it("returns an empty list when there is no signal at all", () => {
    expect(suggestTags(tags, createInitialState().transactions, { payee: "", note: "", amount: 0, currency: "UYU" })).toEqual([]);
  });
});
