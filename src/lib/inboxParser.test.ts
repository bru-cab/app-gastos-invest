import { describe, expect, it } from "vitest";
import { createInitialState } from "../data/seed";
import { getReceiptLineItemShipping, getReceiptLineItemTotal, parseInboxText } from "./inboxParser";

describe("parseInboxText", () => {
  it("extracts amount, currency, bank account and category hints", () => {
    const state = createInitialState();
    const draft = parseInboxText("Itaú compra aprobada USD 25,50 en Netflix tc 40,2 01/09/2026", state.accounts, state.categories, state.tags);

    expect(draft.currency).toBe("USD");
    expect(draft.amount).toBe(25.5);
    expect(draft.fxRateToUyu).toBe(40.2);
    expect(draft.accountId).toBe("account_itau_usd");
    expect(draft.categoryId).toBe("cat_services");
  });

  it("extracts receipt line items and keeps the purchase total", () => {
    const state = createInitialState();
    const draft = parseInboxText("Local A\n01/09/2026\nPollo 500\nPapas 250\nTOTAL 750", state.accounts, state.categories, state.tags);

    expect(draft.payee).toBe("Local A");
    expect(draft.date).toBe("2026-09-01");
    expect(draft.amount).toBe(750);
    expect(draft.missingFields).toContain("account");
    expect(draft.lineItems).toHaveLength(2);
    expect(draft.lineItems?.map((item) => [item.description, item.amount])).toEqual([
      ["Pollo", 500],
      ["Papas", 250]
    ]);
    expect(draft.lineItems?.every((item) => item.categoryId === "cat_groceries")).toBe(true);
  });

  it("prorates La Molienda shipping and stores Itau savings by product", () => {
    const state = createInitialState();
    const draft = parseInboxText(
      [
        "La Molienda",
        "02/09/2026",
        "Granola Proteica Cacao Crunch 300 g Under Five 1 uni. $ 354,00 -$ 88,50 $ 265,50",
        "Huevos Sol free range Maple 30 Unidades 3 uni. $ 1.464,00 -$ 366,00 $ 1.098,00",
        "Costo de envío $ 199,00",
        "Importe total $ 1.562,50"
      ].join("\n"),
      state.accounts,
      state.categories,
      state.tags
    );

    expect(draft.payee).toBe("La Molienda");
    expect(draft.categoryId).toBe("cat_groceries");
    expect(draft.amount).toBe(1562.5);
    expect(draft.lineItems).toHaveLength(2);
    expect(draft.lineItems?.map((item) => item.description)).toEqual([
      "Granola Proteica Cacao Crunch 300 g Under Five",
      "Huevos Sol free range Maple 30 Unidades"
    ]);
    expect(draft.lineItems?.map((item) => item.quantity)).toEqual([1, 3]);
    expect(draft.lineItems?.map((item) => item.discountAmount)).toEqual([88.5, 366]);
    expect(draft.lineItems?.map((item) => item.discountSource)).toEqual(["Itaú", "Itaú"]);
    expect(draft.lineItems?.map((item) => item.originalAmount)).toEqual([354, 1464]);
    expect(draft.lineItems?.map((item) => getReceiptLineItemShipping(item))).toEqual([38.75, 160.25]);
    expect(draft.lineItems?.reduce((sum, item) => sum + getReceiptLineItemTotal(item), 0)).toBe(1562.5);
  });

  it("detects word-based discounts (descuento $X) on line items", () => {
    const state = createInitialState();
    const draft = parseInboxText(
      [
        "La Molienda",
        "02/09/2026",
        "Granola 300 g 1 uni. $ 354,00 descuento $ 88,50 total $ 265,50",
        "Huevos Maple 3 uni. $ 1.464,00 descuento $ 366,00 total $ 1.098,00"
      ].join("\n"),
      state.accounts,
      state.categories,
      state.tags
    );

    expect(draft.lineItems?.map((item) => item.amount)).toEqual([265.5, 1098]);
    expect(draft.lineItems?.map((item) => item.discountAmount)).toEqual([88.5, 366]);
    expect(draft.lineItems?.map((item) => item.discountSource)).toEqual(["Itaú", "Itaú"]);
  });
});
