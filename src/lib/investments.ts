import type { InvestmentHolding } from "../types";

export interface InvestmentQuote {
  price: number;
  asOf: string;
  source: "yahoo" | "binance" | "xml";
}

export interface InvestmentHoldingValue extends InvestmentHolding {
  price: number;
  priceAsOf: string;
  priceSource: InvestmentQuote["source"];
  marketValue: number;
  allocation: number;
}

const QUOTE_CACHE_KEY = "gastos-invest-quotes-v1";
export const QUOTE_REFRESH_MS = 15 * 60 * 1000;

export function buildFallbackQuoteMap(holdings: InvestmentHolding[]): Record<string, InvestmentQuote> {
  return Object.fromEntries(
    holdings.map((holding) => [
      holding.symbol,
      {
        price: holding.lastPrice,
        asOf: holding.lastPriceDate,
        source: "xml"
      } satisfies InvestmentQuote
    ])
  );
}

export function readCachedQuotes(): { savedAt: number; quotes: Record<string, InvestmentQuote> } | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(QUOTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; quotes?: Record<string, InvestmentQuote> };
    if (!parsed.savedAt || !parsed.quotes) return null;
    return { savedAt: parsed.savedAt, quotes: parsed.quotes };
  } catch {
    return null;
  }
}

export function persistCachedQuotes(quotes: Record<string, InvestmentQuote>) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    QUOTE_CACHE_KEY,
    JSON.stringify({
      savedAt: Date.now(),
      quotes
    })
  );
}

export function shouldRefreshQuotes(savedAt?: number) {
  if (!savedAt) return true;
  return Date.now() - savedAt >= QUOTE_REFRESH_MS;
}

export async function refreshQuotes(holdings: InvestmentHolding[], currentQuotes: Record<string, InvestmentQuote>) {
  const updates = await Promise.all(
    holdings.map(async (holding) => {
      const fresh = await fetchQuoteForHolding(holding);
      return fresh ? [holding.symbol, fresh] : [holding.symbol, currentQuotes[holding.symbol]] as const;
    })
  );

  return Object.fromEntries(updates.filter((entry): entry is readonly [string, InvestmentQuote] => Boolean(entry[1])));
}

async function fetchQuoteForHolding(holding: InvestmentHolding): Promise<InvestmentQuote | null> {
  if (holding.quoteProvider === "binance") {
    return fetchBinanceQuote(holding.symbol);
  }

  if (holding.quoteProvider === "yahoo") {
    return fetchYahooChartQuote(holding.symbol);
  }

  return null;
}

async function fetchYahooChartQuote(symbol: string): Promise<InvestmentQuote | null> {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number; regularMarketTime?: number } }> };
    };
    const meta = payload.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.chartPreviousClose;
    if (!price) return null;

    return {
      price,
      asOf: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      source: "yahoo"
    };
  } catch {
    return null;
  }
}

async function fetchBinanceQuote(symbol: string): Promise<InvestmentQuote | null> {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
    if (!response.ok) return null;

    const payload = (await response.json()) as { price?: string };
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      price,
      asOf: new Date().toISOString(),
      source: "binance"
    };
  } catch {
    return null;
  }
}

export function buildPortfolioValuation(
  holdings: InvestmentHolding[],
  quotes: Record<string, InvestmentQuote>
): { totalValue: number; items: InvestmentHoldingValue[] } {
  const items = holdings
    .map((holding) => {
      const quote = quotes[holding.symbol];
      if (!quote) return null;

      const marketValue = holding.shares * quote.price;
      return {
        ...holding,
        price: quote.price,
        priceAsOf: quote.asOf,
        priceSource: quote.source,
        marketValue,
        allocation: 0
      } satisfies InvestmentHoldingValue;
    })
    .filter((item): item is InvestmentHoldingValue => item !== null)
    .sort((left, right) => right.marketValue - left.marketValue);

  const totalValue = items.reduce((sum, item) => sum + item.marketValue, 0);

  return {
    totalValue,
    items: items.map((item) => ({
      ...item,
      allocation: totalValue > 0 ? item.marketValue / totalValue : 0
    }))
  };
}
