import type { Currency, DraftMissingField, FxSource, ParsedTransactionDraft, ReceiptLineItemDraft, TransactionType } from "../types";
import { todayIso } from "./date";
import { normalizeReceiptLineItems } from "./inboxParser";

export interface RemoteInboxImageResult {
  ok: boolean;
  source: string;
  agentName: string;
  rawText: string;
  parsed: ParsedTransactionDraft;
}

export async function parseRemoteInboxImage(fileName: string, imageDataUrl: string): Promise<RemoteInboxImageResult> {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error("No hay backend conectado");

  const response = await fetchWithTimeout(`${apiBase}/api/inbox/parse-image`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fileName, imageDataUrl })
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "No pude analizar la captura");

  return {
    ok: true,
    source: stringValue(body.source, "openai_vision"),
    agentName: stringValue(body.agentName, "Lector de tickets"),
    rawText: stringValue(body.rawText, fileName),
    parsed: normalizeDraft(body.parsed, body.rawText || fileName)
  };
}

function normalizeDraft(value: unknown, rawText: string): ParsedTransactionDraft {
  const draft = value as Partial<ParsedTransactionDraft>;
  const currency = currencyValue(draft.currency);
  const amount = positiveNumber(draft.amount);
  const discountSource = detectReceiptDiscountSource(rawText, draft.payee);
  return {
    type: transactionTypeValue(draft.type),
    date: isIsoDate(draft.date) ? draft.date : todayIso(),
    accountId: stringOrUndefined(draft.accountId),
    payee: stringValue(draft.payee, "Comercio sin identificar"),
    note: stringValue(draft.note, rawText),
    currency,
    amount,
    fxRateToUyu: currency === "UYU" ? 1 : positiveNumberOrUndefined(draft.fxRateToUyu),
    fxSource: currency === "UYU" ? "not_applicable" : fxSourceValue(draft.fxSource),
    categoryId: stringOrUndefined(draft.categoryId),
    transferDirection: draft.transferDirection === "incoming" || draft.transferDirection === "outgoing" ? draft.transferDirection : undefined,
    tagIds: arrayValue(draft.tagIds).map(String).filter(Boolean),
    lineItems: normalizeReceiptLineItems(
      arrayValue(draft.lineItems)
        .map(normalizeLineItem)
        .filter((item): item is ReceiptLineItemDraft => Boolean(item)),
      { discountSource }
    ),
    missingFields: arrayValue(draft.missingFields).filter(isMissingField),
    confidence: clamp(Number(draft.confidence), 0, 1, 0.55)
  };
}

function normalizeLineItem(value: unknown): ReceiptLineItemDraft | undefined {
  const item = value as Partial<ReceiptLineItemDraft>;
  const description = stringValue(item.description, "").trim();
  const amount = positiveNumber(item.amount);
  if (!description || amount <= 0) return undefined;
  return {
    description,
    quantity: positiveNumberOrUndefined(item.quantity),
    unitPrice: positiveNumberOrUndefined(item.unitPrice),
    originalAmount: positiveNumberOrUndefined(item.originalAmount),
    discountAmount: positiveNumberOrUndefined(item.discountAmount),
    discountSource: stringOrUndefined(item.discountSource),
    shippingAmount: positiveNumberOrUndefined(item.shippingAmount),
    amount,
    categoryId: stringOrUndefined(item.categoryId),
    tagIds: arrayValue(item.tagIds).map(String).filter(Boolean),
    confidence: clamp(Number(item.confidence), 0, 1, 0.55)
  };
}

function detectReceiptDiscountSource(rawText: string, payee: unknown): string | undefined {
  const text = `${String(payee ?? "")} ${rawText}`;
  if (/\b(?:itau|itaú)\b/i.test(text) || /\bla\s+molienda\b/i.test(text)) return "Itaú";
  return undefined;
}

function transactionTypeValue(value: unknown): TransactionType {
  return value === "income" || value === "transfer" || value === "adjustment" || value === "refund" ? value : "expense";
}

function currencyValue(value: unknown): Currency {
  return value === "USD" ? "USD" : "UYU";
}

function fxSourceValue(value: unknown): FxSource {
  return value === "bank" || value === "bcu" || value === "manual" ? value : "estimated";
}

function isMissingField(value: unknown): value is DraftMissingField {
  return value === "payee" || value === "date" || value === "amount" || value === "account" || value === "category";
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const number = positiveNumber(value);
  return number > 0 ? number : undefined;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getApiBase(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.protocol === "file:") return undefined;
  return window.location.origin;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 35_000);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
}
