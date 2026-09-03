import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import { importRowsToTransactions, parseSpendeeFile } from "./spendeeImport";

describe("parseSpendeeFile", () => {
  it("previews Spendee-like CSV rows and imports selected transactions", () => {
    const state = createInitialState();
    state.transactions = [];
    const csv = [
      "Date,Amount,Currency,Category,Subcategory,Wallet,Note,Type",
      "2026-09-01,-1200,UYU,Comida,Supermercado,Itaú Cuenta UYU,Disco,Expense",
      "2026-09-02,3500,UYU,Ingresos,,Itaú Cuenta UYU,Sueldo,Income"
    ].join("\n");

    const preview = parseSpendeeFile(csv, "spendee.csv", state.accounts, state.categories, state.transactions);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0].draft.categoryId).toBe("cat_groceries");

    const result = importRowsToTransactions(preview, new Set(preview.rows.map((row) => row.id)));
    expect(result.batch.importedCount).toBe(2);
    expect(result.transactions[1].type).toBe("income");
  });
});
