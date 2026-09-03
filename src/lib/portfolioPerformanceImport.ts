import type { InvestmentHolding, InvestmentPortfolioSnapshot } from "../types";

const SHARE_SCALE = 1_000_000;
const PRICE_SCALE = 100_000_000;

interface ParsedSecurity {
  index: number;
  name: string;
  symbol: string;
  lastPrice: number;
  lastPriceDate: string;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeSymbol(symbol: string, name: string) {
  const cleaned = symbol.trim();
  if (cleaned) return cleaned;
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function guessQuoteProvider(symbol: string): InvestmentHolding["quoteProvider"] {
  if (symbol.endsWith("USDT")) return "binance";
  if (symbol.includes("-USD") || /^[A-Z.^-]+$/.test(symbol)) return "yahoo";
  return "xml";
}

function extractSecurityIndex(reference: string) {
  const match = reference.match(/security(?:\[(\d+)\])?$/);
  if (!match) return null;
  return Number(match[1] ?? "1");
}

export function parsePortfolioPerformanceXml(xml: string, fileName: string): InvestmentPortfolioSnapshot {
  const securityMatches = [...xml.matchAll(/<security>([\s\S]*?)<\/security>/g)];
  const securities: ParsedSecurity[] = securityMatches.map((match, index) => {
    const block = match[1];
    const name = decodeXmlText(block.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? `Security ${index + 1}`);
    const symbol = decodeXmlText(block.match(/<tickerSymbol>([\s\S]*?)<\/tickerSymbol>/)?.[1]?.trim() ?? "");
    const latest = block.match(/<latest t="([^"]+)" v="([^"]+)"/);
    return {
      index: index + 1,
      name,
      symbol: normalizeSymbol(symbol, name),
      lastPriceDate: latest?.[1] ?? new Date().toISOString().slice(0, 10),
      lastPrice: latest ? Number(latest[2]) / PRICE_SCALE : 0
    };
  });

  const securityByIndex = new Map(securities.map((security) => [security.index, security]));
  const sharesBySymbol = new Map<string, number>();

  for (const match of xml.matchAll(/<portfolio-transaction>([\s\S]*?)<\/portfolio-transaction>/g)) {
    const block = match[1];
    const reference = block.match(/<security reference="([^"]+)"\s*\/>/)?.[1];
    const type = block.match(/<type>(BUY|SELL)<\/type>/)?.[1];
    const rawShares = block.match(/<shares>([^<]+)<\/shares>/)?.[1];
    if (!reference || !type || !rawShares) continue;

    const securityIndex = extractSecurityIndex(reference);
    const security = securityIndex ? securityByIndex.get(securityIndex) : undefined;
    if (!security) continue;

    const signedShares = (type === "SELL" ? -1 : 1) * (Number(rawShares) / SHARE_SCALE);
    sharesBySymbol.set(security.symbol, (sharesBySymbol.get(security.symbol) ?? 0) + signedShares);
  }

  const holdings: InvestmentHolding[] = securities
    .map((security) => {
      const shares = sharesBySymbol.get(security.symbol) ?? 0;
      if (shares <= 0) return null;

      return {
        id: security.symbol.toLowerCase(),
        symbol: security.symbol,
        name: security.name,
        shares: Number(shares.toFixed(8)),
        currency: "USD",
        lastPrice: security.lastPrice,
        lastPriceDate: security.lastPriceDate,
        quoteProvider: guessQuoteProvider(security.symbol)
      } satisfies InvestmentHolding;
    })
    .filter((holding): holding is InvestmentHolding => holding !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!holdings.length) {
    throw new Error("No encontré posiciones activas en el XML de Portfolio Performance.");
  }

  return {
    source: "portfolio-performance",
    sourceFileName: fileName,
    importedAt: new Date().toISOString(),
    holdings
  };
}
