import { XMLParser } from "fast-xml-parser";
import type { InvestmentHolding, InvestmentPortfolioSnapshot } from "../types";

const SHARE_SCALE = 100_000_000;
const PRICE_SCALE = 100_000_000;

type XmlNode = Record<string, unknown>;

interface ParsedSecurity {
  index: number;
  uuid: string;
  name: string;
  symbol: string;
  lastPrice: number;
  lastPriceDate: string;
  quoteProvider: InvestmentHolding["quoteProvider"];
}

interface ParsedPortfolio {
  uuid: string;
  name: string;
  transactions: XmlNode[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asObject(value: unknown): XmlNode | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as XmlNode) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getLastSecurityPrice(security: XmlNode) {
  const latest = asObject(security.latest);
  const latestPrice = Number(asString(latest?.["@_v"]));
  const latestDate = asString(latest?.["@_t"]);
  if (Number.isFinite(latestPrice) && latestPrice > 0) {
    return {
      price: latestPrice / PRICE_SCALE,
      date: latestDate || new Date().toISOString().slice(0, 10)
    };
  }

  const pricesNode = asObject(security.prices);
  const prices = asArray(asObject(pricesNode?.price) ?? pricesNode?.price).map((entry) => asObject(entry)).filter((entry): entry is XmlNode => entry !== null);
  const lastEntry = prices.at(-1);
  const fallbackPrice = Number(asString(lastEntry?.["@_v"]));
  return {
    price: Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice / PRICE_SCALE : 0,
    date: asString(lastEntry?.["@_t"]) || new Date().toISOString().slice(0, 10)
  };
}

function guessQuoteProvider(feed: string, symbol: string): InvestmentHolding["quoteProvider"] {
  if (feed === "BINANCE" || symbol.endsWith("USDT")) return "binance";
  if (feed === "YAHOO" || symbol.includes("-USD") || /^[A-Z.^-]+$/.test(symbol)) return "yahoo";
  return "xml";
}

function resolveSecurityIndex(reference: string) {
  const match = reference.match(/security(?:\[(\d+)])?$/);
  if (!match) return null;
  return Number(match[1] ?? "1");
}

function getSelectedPortfolioIds(client: XmlNode) {
  const settings = asObject(client.settings);
  const configurationSets = asObject(settings?.configurationSets);
  const entries = asArray(asObject(configurationSets?.entry) ?? configurationSets?.entry)
    .map((entry) => asObject(entry))
    .filter((entry): entry is XmlNode => entry !== null);

  const selectionEntry = entries.find((entry) => entry.string === "client-filter-selection");
  const definitionEntry = entries.find((entry) => entry.string === "client-filter-definitions");
  if (!selectionEntry || !definitionEntry) return null;

  const selectionConfigs = asArray(asObject(asObject(selectionEntry["config-set"])?.configurations)?.config ?? asObject(asObject(selectionEntry["config-set"])?.configurations)?.configurations)
    .map((config) => asObject(config))
    .filter((config): config is XmlNode => config !== null);
  const selectedConfig = selectionConfigs.find((config) => config.uuid === "SecuritiesPerformanceView");
  const selectedFilterId = asString(selectedConfig?.data).trim();
  if (!selectedFilterId) return null;

  const definitionConfigs = asArray(asObject(asObject(definitionEntry["config-set"])?.configurations)?.config ?? asObject(asObject(definitionEntry["config-set"])?.configurations)?.configurations)
    .map((config) => asObject(config))
    .filter((config): config is XmlNode => config !== null);
  const selectedDefinition = definitionConfigs.find((config) => config.uuid === selectedFilterId);
  if (!selectedDefinition) return null;

  return {
    filterId: selectedFilterId,
    filterName: asString(selectedDefinition.name).trim() || "Filtro activo",
    portfolioIds: new Set(
      asString(selectedDefinition.data)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  };
}

function collectFullPortfolios(node: unknown, map: Map<string, ParsedPortfolio>) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectFullPortfolios(item, map));
    return;
  }

  const object = asObject(node);
  if (!object) return;

  const uuid = asString(object.uuid);
  const name = asString(object.name);
  const transactionsNode = asObject(object.transactions);
  const transactions = asArray(transactionsNode?.["portfolio-transaction"])
    .map((item) => asObject(item))
    .filter((item): item is XmlNode => item !== null);

  if (uuid && name && transactions.length && !map.has(uuid)) {
    map.set(uuid, { uuid, name, transactions });
  }

  Object.values(object).forEach((value) => collectFullPortfolios(value, map));
}

function transactionShareDelta(type: string) {
  switch (type) {
    case "BUY":
    case "TRANSFER_IN":
    case "DELIVERY_INBOUND":
      return 1;
    case "SELL":
    case "TRANSFER_OUT":
    case "DELIVERY_OUTBOUND":
      return -1;
    default:
      return 0;
  }
}

export function parsePortfolioPerformanceXml(xml: string, fileName: string): InvestmentPortfolioSnapshot {
  const parsed = xmlParser.parse(xml) as { client?: XmlNode };
  const client = asObject(parsed.client);
  if (!client) {
    throw new Error("No pude leer el archivo XML de Portfolio Performance.");
  }

  const securities = asArray(asObject(asObject(client.securities)?.security) ?? asObject(client.securities)?.security)
    .map((entry) => asObject(entry))
    .filter((entry): entry is XmlNode => entry !== null)
    .map((security, index) => {
      const symbol = asString(security.tickerSymbol).trim() || asString(security.name).trim();
      const latest = getLastSecurityPrice(security);
      return {
        index: index + 1,
        uuid: asString(security.uuid),
        name: asString(security.name).trim() || `Security ${index + 1}`,
        symbol,
        lastPrice: latest.price,
        lastPriceDate: latest.date,
        quoteProvider: guessQuoteProvider(asString(security.feed).trim(), symbol)
      } satisfies ParsedSecurity;
    });

  const securityByIndex = new Map(securities.map((security) => [security.index, security]));
  const selectedFilter = getSelectedPortfolioIds(client);

  const portfolioMap = new Map<string, ParsedPortfolio>();
  collectFullPortfolios(client, portfolioMap);

  const portfolios = [...portfolioMap.values()].filter((portfolio) =>
    selectedFilter?.portfolioIds.has(portfolio.uuid) ?? true
  );
  const portfoliosToUse = portfolios.length > 0 ? portfolios : [...portfolioMap.values()];

  const holdingsBySecurityId = new Map<string, number>();

  for (const portfolio of portfoliosToUse) {
    for (const transaction of portfolio.transactions) {
      const type = asString(transaction.type);
      const sign = transactionShareDelta(type);
      if (!sign) continue;

      const securityRef = asString(asObject(transaction.security)?.["@_reference"]);
      const rawShares = Number(asString(transaction.shares));
      if (!securityRef || !Number.isFinite(rawShares) || rawShares <= 0) continue;

      const securityIndex = resolveSecurityIndex(securityRef);
      const security = securityIndex ? securityByIndex.get(securityIndex) : undefined;
      if (!security) continue;

      holdingsBySecurityId.set(security.uuid, (holdingsBySecurityId.get(security.uuid) ?? 0) + sign * (rawShares / SHARE_SCALE));
    }
  }

  const holdings: InvestmentHolding[] = securities
    .map((security) => {
      const shares = holdingsBySecurityId.get(security.uuid) ?? 0;
      if (shares <= 0) return null;

      return {
        id: security.uuid || security.symbol.toLowerCase(),
        symbol: security.symbol,
        name: security.name,
        shares: Number(shares.toFixed(8)),
        currency: "USD",
        lastPrice: security.lastPrice,
        lastPriceDate: security.lastPriceDate,
        quoteProvider: security.quoteProvider
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
    holdings,
    filterName: selectedFilter?.filterName ?? null
  };
}
