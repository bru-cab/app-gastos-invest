import type { InvestmentHolding, InvestmentPortfolioSnapshot } from "../types";

export const portfolioSnapshot: InvestmentHolding[] = [
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
    id: "usdc",
    symbol: "USDC",
    name: "USDC",
    shares: 3423722,
    currency: "USD",
    lastPrice: 0.99977277,
    lastPriceDate: "2025-06-13",
    quoteProvider: "xml"
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
    id: "corgiai",
    symbol: "CORGIAI",
    name: "CorgiAI",
    shares: 1415599984,
    currency: "USD",
    lastPrice: 0.00014418,
    lastPriceDate: "2025-06-13",
    quoteProvider: "xml"
  },
  {
    id: "eth",
    symbol: "ETH-USD",
    name: "ETH",
    shares: 13.718333,
    currency: "USD",
    lastPrice: 2383.49,
    lastPriceDate: "2026-09-02",
    quoteProvider: "yahoo"
  },
  {
    id: "usdt",
    symbol: "USDT-USD",
    name: "USDT",
    shares: 22913,
    currency: "USD",
    lastPrice: 0.99978,
    lastPriceDate: "2026-09-02",
    quoteProvider: "yahoo"
  },
  {
    id: "bnb",
    symbol: "BNBUSDT",
    name: "BNB",
    shares: 0.849,
    currency: "USD",
    lastPrice: 686.26,
    lastPriceDate: "2026-09-02",
    quoteProvider: "binance"
  },
  {
    id: "agix",
    symbol: "AGIX",
    name: "SingularityNET",
    shares: 100,
    currency: "USD",
    lastPrice: 0.3149748,
    lastPriceDate: "2025-06-13",
    quoteProvider: "xml"
  }
];

export const defaultInvestmentPortfolio: InvestmentPortfolioSnapshot = {
  source: "portfolio-performance",
  sourceFileName: "Portfolio_total_sep2_26.xml",
  importedAt: "2026-09-03T00:00:00.000Z",
  holdings: portfolioSnapshot
};
