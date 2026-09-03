import type { Account, Category, Currency, DraftMissingField, ParsedTransactionDraft, ReceiptLineItemDraft, Tag } from "../types";
import { normalizeMoney, toUyu } from "./calculations";
import { todayIso } from "./date";

const currencyPatterns: Array<{ currency: Currency; pattern: RegExp }> = [
  { currency: "USD", pattern: /\b(?:usd|us\$|d[oó]lares|dolar|dólar)\b/i },
  { currency: "UYU", pattern: /\b(?:uyu|\$u|pesos|peso|uruguayos)\b/i }
];

const merchantStopWords = [
  "compra",
  "consumo",
  "aprobado",
  "autorizado",
  "tarjeta",
  "credito",
  "crédito",
  "debito",
  "débito",
  "itau",
  "itaú",
  "mercadopago",
  "mercado",
  "pago"
];

const moneyNumberSource =
  "[0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?";
const optionalCurrencySource = "(?:\\$|U\\$S|USD|UYU|US\\$)?";
const trailingAmountPattern = new RegExp(`${optionalCurrencySource}\\s*(${moneyNumberSource})\\s*$`, "i");
const trailingAmountCleanupPattern = new RegExp(`${optionalCurrencySource}\\s*(?:${moneyNumberSource})\\s*$`, "i");
const signedDiscountPattern = new RegExp(`-\\s*${optionalCurrencySource}\\s*(${moneyNumberSource})`, "gi");
const wordDiscountPattern = new RegExp(`\\b(?:descuento|dto\\.?|disc\\.?|ahorro|bonificaci[oó]n|promo)\\s*:?\\s*${optionalCurrencySource}\\s*(${moneyNumberSource})`, "gi");
const currencyAmountCleanupPattern = new RegExp(`-?\\s*(?:\\$|U\\$S|USD|UYU|US\\$)\\s*(?:${moneyNumberSource})`, "gi");

export function parseInboxText(text: string, accounts: Account[], categories: Category[], tags: Tag[]): ParsedTransactionDraft {
  const normalized = text.replace(/\s+/g, " ").trim();
  const currency = detectCurrency(normalized);
  const amount = detectAmount(text);
  const fxRate = currency === "USD" ? detectFxRate(normalized) : 1;
  const account = detectAccount(normalized, accounts, currency);
  const category = detectCategory(normalized, categories);
  const detectedTags = detectTags(normalized, tags);
  const payee = detectPayee(text);
  const dateInfo = detectDate(text);
  const lineItems = detectReceiptLineItems(text, categories, tags, category);
  const missingFields = getMissingFields({
    amount,
    accountFound: Boolean(account),
    category,
    payee,
    explicitDate: dateInfo.explicit
  });
  const confidence =
    [amount > 0, !isMissingPayee(payee), Boolean(account), Boolean(category) && !isUncategorizedCategory(category), dateInfo.explicit].filter(Boolean)
      .length / 5;

  return {
    type: "expense",
    date: dateInfo.date,
    accountId: account?.id,
    payee,
    note: normalized,
    currency,
    amount,
    fxRateToUyu: fxRate,
    fxSource: currency === "UYU" ? "not_applicable" : fxRate ? "bank" : "estimated",
    categoryId: category?.id,
    tagIds: detectedTags.map((tag) => tag.id),
    lineItems,
    missingFields,
    confidence
  };
}

function detectCurrency(text: string): Currency {
  return currencyPatterns.find((item) => item.pattern.test(text))?.currency ?? "UYU";
}

export function detectAmount(text: string): number {
  const receiptTotal = detectReceiptTotal(text);
  if (receiptTotal) return receiptTotal;

  const lineItemTotal = detectLineItemTotal(text);
  if (lineItemTotal) return lineItemTotal;

  const withoutDates = text.replace(/\b[0-3]?\d[/-][0-1]?\d(?:[/-]\d{2,4})?\b/g, " ");
  const explicitCurrencyAmount = [
    ...withoutDates.matchAll(/(?:U\$S|US\$|USD|UYU|\$)\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)/gi)
  ]
    .map((match) => parseLocaleNumber(match[1]))
    .filter((value) => value > 0);
  if (explicitCurrencyAmount.length > 0) return explicitCurrencyAmount[0];

  const candidates = [...withoutDates.matchAll(/([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)/gi)]
    .map((match) => parseLocaleNumber(match[1]))
    .filter((value) => value > 0);
  return candidates[0] ?? 0;
}

function detectReceiptTotal(text: string): number | undefined {
  const totals = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(total|importe|monto)\b/i.test(line) && !/\b(subtotal|iva|cambio|descuento)\b/i.test(line))
    .map((line) => detectTrailingAmount(line))
    .filter((amount): amount is number => Boolean(amount && amount > 0));

  return totals[totals.length - 1];
}

function detectLineItemTotal(text: string): number | undefined {
  const amounts = text
    .split(/\r?\n/)
    .map((line) => cleanReceiptLine(line))
    .filter((line) => line && !isReceiptMetaLine(line) && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line))
    .map((line) => detectTrailingAmount(line))
    .filter((amount): amount is number => Boolean(amount && amount > 0));

  if (amounts.length < 2) return undefined;
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

function detectFxRate(text: string): number | undefined {
  const match = text.match(/(?:tc|tipo de cambio|cambio)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!match) return undefined;
  return parseLocaleNumber(match[1]);
}

function parseLocaleNumber(value: string): number {
  const trimmed = value.trim();
  const commaIndex = trimmed.lastIndexOf(",");
  const dotIndex = trimmed.lastIndexOf(".");
  const decimalSeparator = inferDecimalSeparator(trimmed, commaIndex, dotIndex);
  const normalized = decimalSeparator
    ? trimmed.replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "").replace(decimalSeparator, ".")
    : trimmed.replace(/[.,]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferDecimalSeparator(value: string, commaIndex: number, dotIndex: number): "," | "." | undefined {
  if (commaIndex >= 0 && dotIndex >= 0) return commaIndex > dotIndex ? "," : ".";
  const separator = commaIndex >= 0 ? "," : dotIndex >= 0 ? "." : undefined;
  if (!separator) return undefined;
  const index = separator === "," ? commaIndex : dotIndex;
  const decimals = value.length - index - 1;
  const integerDigits = value.slice(0, index).replace(/\D/g, "").length;
  if (decimals === 3 && integerDigits > 0) return undefined;
  return separator;
}

function detectTrailingAmount(line: string): number | undefined {
  const match = line.match(trailingAmountPattern);
  if (!match) return undefined;
  const amount = parseLocaleNumber(match[1]);
  return amount > 0 ? amount : undefined;
}

function detectAccount(text: string, accounts: Account[], currency: Currency): Account | undefined {
  const lower = text.toLowerCase();
  const sameCurrency = accounts.filter((account) => account.currency === currency);
  return (
    sameCurrency.find((account) => lower.includes(account.name.toLowerCase())) ??
    sameCurrency.find((account) => lower.includes(account.institution.toLowerCase())) ??
    accounts.find((account) => lower.includes(account.name.toLowerCase()) || lower.includes(account.institution.toLowerCase()))
  );
}

function detectCategory(text: string, categories: Category[]): Category | undefined {
  const lower = text.toLowerCase();
  const rules: Array<{ needles: string[]; categories: string[] }> = [
    {
      needles: [
        "disco",
        "devoto",
        "tienda inglesa",
        "la molienda",
        "molienda",
        "super",
        "mercado",
        "pollo",
        "papa",
        "papas",
        "carne",
        "fruta",
        "verdura",
        "pan",
        "leche",
        "queso",
        "yogur"
      ],
      categories: ["Groceries", "Supermercado", "Food & Drink"]
    },
    { needles: ["restaurant", "restaurante", "bar", "cafe", "café", "delivery"], categories: ["Restaurants", "Restaurantes", "Food & Drink"] },
    { needles: ["uber", "cabify", "taxi", "nafta", "estacionamiento"], categories: ["Transport", "Transporte"] },
    { needles: ["antel", "ute", "ose", "netflix", "spotify"], categories: ["Gastos hogar", "Servicios"] },
    { needles: ["farmacia", "mutualista", "medica", "médica"], categories: ["Healthcare", "Salud"] }
  ];
  const match = rules.find((rule) => rule.needles.some((needle) => lower.includes(needle)));
  if (!match) return findFallbackCategory(categories);
  return findCategoryByName(categories, match.categories) ?? findFallbackCategory(categories);
}

function detectTags(text: string, tags: Tag[]): Tag[] {
  const lower = text.toLowerCase();
  return tags.filter((tag) => lower.includes(tag.name.toLowerCase()));
}

function detectReceiptLineItems(
  text: string,
  categories: Category[],
  tags: Tag[],
  fallbackCategory?: Category
): ReceiptLineItemDraft[] {
  const discountSource = detectReceiptDiscountSource(text);
  const detectedItems = text
    .split(/\r?\n/)
    .map((line) => cleanReceiptLine(line))
    .filter(Boolean)
    .filter((line) => !isReceiptMetaLine(line))
    .map((line) => parseReceiptLineItem(line, categories, tags, discountSource, fallbackCategory))
    .filter((item): item is ReceiptLineItemDraft => Boolean(item));

  return normalizeReceiptLineItems(detectedItems, { discountSource }).slice(0, 60);
}

function parseReceiptLineItem(
  line: string,
  categories: Category[],
  tags: Tag[],
  discountSource?: string,
  fallbackCategory?: Category
): ReceiptLineItemDraft | undefined {
  const amount = detectTrailingAmount(line);
  if (!amount) return undefined;
  const description = cleanItemDescription(line.replace(trailingAmountCleanupPattern, ""));
  if (description.length < 2 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(description)) return undefined;
  const detectedCategory = detectCategory(description, categories);
  const category = detectedCategory && !isUncategorizedCategory(detectedCategory) ? detectedCategory : fallbackCategory;
  const detectedTags = detectTags(description, tags);
  const quantityInfo = detectReceiptQuantity(line);
  const discountAmount = detectReceiptDiscountAmount(line);
  const quantity = quantityInfo?.quantity;
  const unitPrice = quantityInfo?.unitPrice ?? (quantity ? normalizeMoney(amount / quantity) : undefined);
  const item: ReceiptLineItemDraft = {
    description,
    quantity,
    unitPrice,
    amount,
    categoryId: category?.id,
    tagIds: detectedTags.map((tag) => tag.id),
    confidence: category && !isUncategorizedCategory(category) ? 0.76 : 0.56
  };

  if (discountAmount) {
    item.originalAmount = normalizeMoney(amount + discountAmount);
    item.discountAmount = discountAmount;
    item.discountSource = discountSource ?? "Descuento";
  }

  return item;
}

function detectReceiptQuantity(line: string): { quantity?: number; unitPrice?: number } | undefined {
  const multiplicationMatch = line.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)\b/);
  if (multiplicationMatch) {
    return {
      quantity: parseLocaleNumber(multiplicationMatch[1]),
      unitPrice: parseLocaleNumber(multiplicationMatch[2])
    };
  }

  const unitMatches = [
    ...line.matchAll(/\b([0-9]+(?:[.,][0-9]+)?)\s*(uni|unid|unidades?|uds?|u)\.?(?=\s|$)/gi)
  ];
  const preferredMatch =
    unitMatches
      .filter((match) => !/^unidades?$/i.test(match[2]))
      .at(-1) ?? (unitMatches.length > 1 ? unitMatches.at(-1) : undefined);
  if (!preferredMatch) return undefined;

  return { quantity: parseLocaleNumber(preferredMatch[1]) };
}

function detectReceiptDiscountAmount(line: string): number | undefined {
  const discounts = [...line.matchAll(signedDiscountPattern), ...line.matchAll(wordDiscountPattern)]
    .map((match) => parseLocaleNumber(match[1]))
    .filter((amount) => amount > 0);
  if (discounts.length === 0) return undefined;
  return normalizeMoney(discounts.reduce((sum, amount) => sum + amount, 0));
}

function detectReceiptDiscountSource(text: string): string | undefined {
  if (/\b(?:itau|itaú)\b/i.test(text) || /\bla\s+molienda\b/i.test(text)) return "Itaú";
  return undefined;
}

export function normalizeReceiptLineItems(
  lineItems: ReceiptLineItemDraft[],
  options: { discountSource?: string } = {}
): ReceiptLineItemDraft[] {
  const normalizedItems = lineItems
    .map((item) => normalizeReceiptLineItem(item, options.discountSource))
    .filter((item): item is ReceiptLineItemDraft => Boolean(item));
  const shippingTotal = normalizeMoney(
    normalizedItems
      .filter((item) => isReceiptShippingItem(item.description))
      .reduce((sum, item) => sum + getReceiptLineItemTotal(item), 0)
  );
  const products = normalizedItems.filter((item) => !isReceiptShippingItem(item.description));
  const existingShipping = normalizeMoney(products.reduce((sum, item) => sum + getReceiptLineItemShipping(item), 0));

  if (shippingTotal <= 0 || products.length === 0 || existingShipping > 0.01) return products;
  return allocateShippingByProductAmount(products, shippingTotal);
}

function normalizeReceiptLineItem(item: ReceiptLineItemDraft, discountSource?: string): ReceiptLineItemDraft | undefined {
  const description = item.description.trim().slice(0, 100);
  const amount = normalizeMoney(Math.abs(Number(item.amount) || 0));
  if (!description || amount <= 0) return undefined;
  const quantity = positiveNumberOrUndefined(item.quantity);
  const unitPrice = positiveNumberOrUndefined(item.unitPrice) ?? (quantity ? normalizeMoney(amount / quantity) : undefined);
  const discountAmount = positiveNumberOrUndefined(item.discountAmount);
  const originalAmount = positiveNumberOrUndefined(item.originalAmount) ?? (discountAmount ? normalizeMoney(amount + discountAmount) : undefined);
  const shippingAmount = positiveNumberOrUndefined(item.shippingAmount);

  return {
    ...item,
    description,
    quantity,
    unitPrice,
    originalAmount,
    discountAmount,
    discountSource: discountAmount ? item.discountSource?.trim() || discountSource || "Descuento" : undefined,
    shippingAmount,
    amount
  };
}

function allocateShippingByProductAmount(lineItems: ReceiptLineItemDraft[], shippingTotal: number): ReceiptLineItemDraft[] {
  const weightedTotal = normalizeMoney(lineItems.reduce((sum, item) => sum + getReceiptLineItemAmount(item), 0));
  let allocated = 0;

  return lineItems.map((item, index) => {
    const isLast = index === lineItems.length - 1;
    const share =
      weightedTotal > 0
        ? normalizeMoney((getReceiptLineItemAmount(item) / weightedTotal) * shippingTotal)
        : normalizeMoney(shippingTotal / lineItems.length);
    const shippingAmount = isLast ? normalizeMoney(shippingTotal - allocated) : share;
    allocated = normalizeMoney(allocated + shippingAmount);
    return {
      ...item,
      shippingAmount: normalizeMoney(getReceiptLineItemShipping(item) + shippingAmount)
    };
  });
}

function isReceiptShippingItem(description: string): boolean {
  const normalized = normalizeText(description);
  return /\b(?:envio|delivery|shipping|flete)\b/.test(normalized);
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const number = normalizeMoney(Number(value));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function getReceiptLineItemAmount(item: Pick<ReceiptLineItemDraft, "amount">): number {
  return normalizeMoney(Math.abs(Number(item.amount) || 0));
}

export function getReceiptLineItemShipping(item: Pick<ReceiptLineItemDraft, "shippingAmount">): number {
  return normalizeMoney(Math.max(0, Number(item.shippingAmount) || 0));
}

export function getReceiptLineItemTotal(item: Pick<ReceiptLineItemDraft, "amount" | "shippingAmount">): number {
  return normalizeMoney(getReceiptLineItemAmount(item) + getReceiptLineItemShipping(item));
}

export function getReceiptLineItemDiscount(item: Pick<ReceiptLineItemDraft, "discountAmount">): number {
  return normalizeMoney(Math.max(0, Number(item.discountAmount) || 0));
}

function cleanReceiptLine(line: string): string {
  return line.replace(/\s+/g, " ").replace(/[|]/g, " ").trim();
}

function cleanItemDescription(value: string): string {
  return value
    .replace(/\b[0-9]{5,}\b/g, " ")
    .replace(/\b([0-9]+(?:[.,][0-9]+)?)\s*[xX]\s*([0-9]+(?:[.,][0-9]+)?)\b/g, " ")
    .replace(/\b[0-9]+(?:[.,][0-9]+)?\s*(?:uni|unid|uds?|u)\.?(?=\s|$)/gi, " ")
    .replace(signedDiscountPattern, " ")
    .replace(wordDiscountPattern, " ")
    .replace(/\b(?:descuento|dto\.?|disc\.?|total|importe|subtotal)\b/gi, " ")
    .replace(currencyAmountCleanupPattern, " ")
    .replace(/[*@:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isReceiptMetaLine(line: string): boolean {
  const lower = line.toLowerCase();
  const hasItemDiscount =
    /\b(?:descuento|dto\.?|disc\.?|ahorro|bonificaci[oó]n)\b/.test(lower) ||
    /-\s*(?:\$|U\$S|USD|UYU|US\$)?\s*[0-9]/.test(lower);
  if (hasItemDiscount) return false;

  return (
    /\b(total|subtotal|sub total|iva|impuesto|cambio|efectivo|tarjeta|debito|débito|credito|crédito|ruc|rut|factura|ticket|boleta|autorizacion|autorización|nro|nº|fecha|hora)\b/.test(
      lower
    ) || /^\d+[.,/-]\d+[.,/-]?\d*$/.test(lower)
  );
}

function detectPayee(text: string): string {
  const receiptCandidate = text
    .split(/\r?\n/)
    .map((line) => cleanReceiptLine(line))
    .find((line) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(line) && !detectTrailingAmount(line) && !isReceiptMetaLine(line));
  if (receiptCandidate) return receiptCandidate.slice(0, 48);

  const compact = text.replace(/\s+/g, " ").trim();
  const withoutAmount = compact.replace(/(?:\$|U\$S|USD|UYU|US\$)?\s*[0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?/gi, " ");
  const words = withoutAmount
    .split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !merchantStopWords.includes(word.toLowerCase()));
  return words.slice(0, 3).join(" ") || "Comercio sin identificar";
}

function detectDate(text: string): { date: string; explicit: boolean } {
  const match = text.match(/\b([0-3]?\d)[/-]([0-1]?\d)(?:[/-](\d{2,4}))?\b/);
  if (!match) return { date: todayIso(), explicit: false };
  const now = new Date();
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3] ? normalizeYear(match[3]) : now.getFullYear().toString();
  return { date: `${year}-${month}-${day}`, explicit: true };
}

function normalizeYear(value: string): string {
  if (value.length === 4) return value;
  return Number(value) > 70 ? `19${value}` : `20${value}`;
}

function getMissingFields({
  amount,
  accountFound,
  category,
  payee,
  explicitDate
}: {
  amount: number;
  accountFound: boolean;
  category?: Category;
  payee: string;
  explicitDate: boolean;
}): DraftMissingField[] {
  const missing: DraftMissingField[] = [];
  if (isMissingPayee(payee)) missing.push("payee");
  if (!explicitDate) missing.push("date");
  if (amount <= 0) missing.push("amount");
  if (!accountFound) missing.push("account");
  if (!category || isUncategorizedCategory(category)) missing.push("category");
  return missing;
}

function isMissingPayee(payee: string): boolean {
  return !payee.trim() || payee === "Comercio sin identificar";
}

function isUncategorizedCategory(category?: Category): boolean {
  if (!category) return true;
  const name = normalizeText(category.name);
  return name.includes("sin categorizar") || name.includes("uncategorized") || name === "other";
}

function findCategoryByName(categories: Category[], names: string[]): Category | undefined {
  const normalizedNames = names.map(normalizeText);
  for (const name of normalizedNames) {
    const category = categories.find((item) => normalizeText(item.name) === name);
    if (category) return category;
  }
  return undefined;
}

function findFallbackCategory(categories: Category[]): Category | undefined {
  return findCategoryByName(categories, ["Sin categorizar", "Uncategorized", "Other"]) ?? categories[0];
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function draftAmountUyu(draft: ParsedTransactionDraft): number {
  return toUyu(draft.amount, draft.currency, draft.currency === "USD" ? draft.fxRateToUyu : 1);
}
