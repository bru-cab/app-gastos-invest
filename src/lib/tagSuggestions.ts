import type { Currency, Tag, Transaction } from "../types";
import { toUyu } from "./calculations";

export interface TagSuggestionInput {
  payee: string;
  note: string;
  amount: number;
  currency: Currency;
  fxRateToUyu?: number;
}

const TAG_STOPWORDS = new Set([
  "compra",
  "comprado",
  "consumo",
  "pago",
  "pagado",
  "tarjeta",
  "credito",
  "credito",
  "debito",
  "aprobado",
  "autorizado",
  "itau",
  "itaú",
  "mercado",
  "mercados",
  "pago",
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "en",
  "con",
  "sin",
  "por",
  "para",
  "mi",
  "su",
  "y",
  "o",
  "a",
  "the",
  "and",
  "of",
  "for",
  "with"
]);

function normalizeTagToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function tokenize(value: string): string[] {
  const tokens = value
    .split(/[^a-z0-9áéíóúüñ]+/i)
    .map(normalizeTagToken)
    .filter((token) => token.length > 1 && !TAG_STOPWORDS.has(token));
  return [...new Set(tokens)];
}

function collectTransactionTagIds(transaction: Transaction): string[] {
  const ids = transaction.splits.flatMap((split) => split.tagIds);
  (transaction.lineItems ?? []).forEach((item) => ids.push(...(item.tagIds ?? [])));
  return [...new Set(ids)];
}

export function getTagUsageCounts(transactions: Transaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  transactions
    .filter((transaction) => transaction.status === "confirmed")
    .forEach((transaction) => {
      collectTransactionTagIds(transaction).forEach((tagId) => {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      });
    });
  return counts;
}

export function orderTagsByFrequency(tags: Tag[], transactions: Transaction[]): Tag[] {
  const counts = getTagUsageCounts(transactions);
  return [...tags].sort((a, b) => {
    const frequencyDiff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    return frequencyDiff || a.name.localeCompare(b.name, "es");
  });
}

function amountSimilarity(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

export function suggestTags(tags: Tag[], transactions: Transaction[], input: TagSuggestionInput, limit = 5): Tag[] {
  const inputTokens = tokenize(`${input.payee} ${input.note}`);
  const inputAmountUyu =
    input.amount > 0 ? toUyu(input.amount, input.currency, input.currency === "USD" ? input.fxRateToUyu : 1) : 0;
  const usageCounts = getTagUsageCounts(transactions);

  if (inputTokens.length === 0 && inputAmountUyu <= 0) {
    return [];
  }

  if (inputTokens.length === 0) {
    return orderTagsByFrequency(tags, transactions).slice(0, limit);
  }

  const scores = new Map<string, number>();
  transactions
    .filter((transaction) => transaction.status === "confirmed")
    .forEach((transaction) => {
      const transactionTokens = tokenize(`${transaction.payee} ${transaction.note}`);
      if (transactionTokens.length === 0) return;
      const shared = inputTokens.filter((token) => transactionTokens.includes(token));
      if (shared.length === 0) return;

      const tagIds = collectTransactionTagIds(transaction);
      if (tagIds.length === 0) return;

      const textScore = shared.length / Math.min(inputTokens.length, transactionTokens.length);
      const amountScore = inputAmountUyu > 0 ? amountSimilarity(inputAmountUyu, transaction.amountUyu) : 0;
      const weight = textScore * (0.6 + amountScore * 0.4);

      tagIds.forEach((tagId) => scores.set(tagId, (scores.get(tagId) ?? 0) + weight));
    });

  const ranked = tags
    .map((tag) => ({ tag, score: scores.get(tag.id) ?? 0 }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (usageCounts.get(b.tag.id) ?? 0) - (usageCounts.get(a.tag.id) ?? 0) ||
        a.tag.name.localeCompare(b.tag.name, "es")
    )
    .map((item) => item.tag);

  const suggestedIds = new Set(ranked.map((tag) => tag.id));
  const fallback = orderTagsByFrequency(tags, transactions).filter((tag) => !suggestedIds.has(tag.id));

  return [...ranked, ...fallback].slice(0, limit);
}
