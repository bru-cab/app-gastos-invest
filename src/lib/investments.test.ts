import { describe, expect, it } from "vitest";
import { portfolioSnapshot } from "../data/portfolioSnapshot";
import { buildFallbackQuoteMap, buildPortfolioValuation } from "./investments";

describe("investments", () => {
  it("calculates total value and allocations from quotes", () => {
    const quotes = buildFallbackQuoteMap(portfolioSnapshot);
    const valuation = buildPortfolioValuation(portfolioSnapshot, quotes);

    expect(valuation.totalValue).toBeGreaterThan(0);
    expect(valuation.items[0]?.marketValue).toBeGreaterThan(valuation.items[1]?.marketValue ?? 0);

    const totalAllocation = valuation.items.reduce((sum, item) => sum + item.allocation, 0);
    expect(totalAllocation).toBeCloseTo(1, 6);
  });
});
