import { describe, expect, it } from "vitest";
import type { InvestmentPortfolioSnapshot } from "../types";
import { sanitizeInvestmentPortfolio } from "./storage";

describe("sanitizeInvestmentPortfolio", () => {
  it("drops the legacy inflated snapshot", () => {
    const legacy: InvestmentPortfolioSnapshot = {
      source: "portfolio-performance",
      sourceFileName: "Portfolio_total_sep2_26.xml",
      importedAt: "2026-09-02T21:00:00.000Z",
      holdings: [
        {
          id: "btc",
          symbol: "BTC-USD",
          name: "BTC",
          shares: 2201.720695,
          currency: "USD",
          lastPrice: 77074.14,
          lastPriceDate: "2026-09-02",
          quoteProvider: "yahoo"
        },
        {
          id: "voog",
          symbol: "VOOG",
          name: "Vanguard S&P 500 Growth ETF",
          shares: 6000.000012,
          currency: "USD",
          lastPrice: 83.49,
          lastPriceDate: "2026-09-02",
          quoteProvider: "yahoo"
        },
        {
          id: "meta",
          symbol: "META",
          name: "Meta Platforms, Inc.",
          shares: 3540.746,
          currency: "USD",
          lastPrice: 592.85,
          lastPriceDate: "2026-09-02",
          quoteProvider: "yahoo"
        }
      ]
    };

    expect(sanitizeInvestmentPortfolio(legacy)).toBeNull();
  });

  it("keeps a plausible imported portfolio", () => {
    const imported: InvestmentPortfolioSnapshot = {
      source: "portfolio-performance",
      sourceFileName: "Portfolio_total_sep2_26.xml",
      importedAt: "2026-09-03T10:00:00.000Z",
      holdings: [
        {
          id: "btc",
          symbol: "BTC-USD",
          name: "BTC",
          shares: 0.2,
          currency: "USD",
          lastPrice: 78750.48,
          lastPriceDate: "2026-09-03",
          quoteProvider: "yahoo"
        },
        {
          id: "voog",
          symbol: "VOOG",
          name: "Vanguard S&P 500 Growth ETF",
          shares: 312,
          currency: "USD",
          lastPrice: 84.185,
          lastPriceDate: "2026-09-03",
          quoteProvider: "yahoo"
        }
      ],
      filterName: "Relevants"
    };

    expect(sanitizeInvestmentPortfolio(imported)).toEqual(imported);
  });
});
