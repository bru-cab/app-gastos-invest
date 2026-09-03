const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_VISION_MODEL = "gpt-5.6";

export async function parseReceiptImageWithOpenAI({
  imageDataUrl,
  fileName = "captura",
  state,
  apiKey,
  model = DEFAULT_VISION_MODEL,
  nowIso = todayIso(),
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!isSupportedImageDataUrl(imageDataUrl)) throw new Error("Image data URL is required");

  const response = await createResponse(fetchImpl, apiKey, {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildReceiptPrompt(state, fileName, nowIso) },
          { type: "input_image", image_url: imageDataUrl, detail: "high" }
        ]
      }
    ],
    store: false,
    max_output_tokens: 3200
  });

  const parsed = parseJsonObject(extractOutputText(response));
  const rawText = String(parsed?.rawText ?? parsed?.text ?? fileName).trim() || fileName;

  return {
    ok: true,
    source: "openai_vision",
    agentName: "Lector de tickets",
    rawText,
    parsed: normalizeDraft(parsed?.draft ?? parsed, rawText, state, nowIso)
  };
}

async function createResponse(fetchImpl, apiKey, body) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = payload?.error?.message ? `: ${payload.error.message}` : "";
    throw new Error(`OpenAI image parse failed (${response.status})${detail}`);
  }

  return payload;
}

function buildReceiptPrompt(state, fileName, nowIso) {
  const accounts = state.accounts
    .filter((account) => account.active)
    .map((account) => ({
      id: account.id,
      name: account.name,
      institution: account.institution,
      currency: account.currency
    }));
  const categories = state.categories
    .filter((category) => !category.archived)
    .map((category) => ({ id: category.id, name: category.name, parentId: category.parentId ?? null }));
  const tags = state.tags.map((tag) => ({ id: tag.id, name: tag.name }));

  return `
Sos el Lector de tickets de Bruno. Extraé datos de una captura, ticket, factura o notificación bancaria.
Fecha actual: ${nowIso}. Archivo: ${fileName}.

Cuentas disponibles:
${JSON.stringify(accounts)}

Categorías disponibles:
${JSON.stringify(categories)}

Tags disponibles:
${JSON.stringify(tags)}

Reglas:
- No confirmes ni crees movimientos. Solo devolvé un borrador revisable.
- Si es una notificación bancaria, extraé local/comercio, monto, moneda, fecha si aparece y cuenta probable.
- Si es un ticket/factura, extraé el total y también TODOS los productos como lineItems, sin omitir ninguno.
- Cada lineItem debe tener description, quantity, amount, categoryId si podés mapearlo, tagIds y confidence.
- En lineItems, amount es el importe final del producto luego de descuentos y antes de envío.
- CRÍTICO descuentos: si junto a un producto aparece un importe original y un descuento (ej. "$354,00 -$88,50 $265,50" o "descuento $88,50"), guardá SIEMPRE: originalAmount = importe original, discountAmount = importe del descuento en positivo, y amount = importe final. Nunca dejes originalAmount ni discountAmount vacíos si el ticket muestra un descuento.
- En La Molienda los números negativos en rojo junto a cada producto son el ahorro por pagar con tarjeta Itaú: discountSource debe ser "Itaú". Reconocé el encabezado o logo de La Molienda / Itaú en la captura y usá payee "La Molienda" y discountSource "Itaú" en ese caso. Incluí en rawText cualquier mención de Itaú, La Molienda o porcentaje de descuento visible.
- Si hay "Costo de envío", no lo trates como producto: prorratealo por importe entre los productos y guardá esa parte en shippingAmount. Si no podés prorratearlo, devolvé la línea de envío para que la app lo haga.
- Usá IDs existentes para accountId, categoryId y tagIds. Si no estás seguro, dejalos vacíos.
- Para USD, si aparece tipo de cambio usalo como fxRateToUyu y fxSource "bank"; si no aparece, fxSource "estimated".
- Si falta local, fecha, monto, cuenta o categoría, agregalo en missingFields.
- La moneda por defecto en Uruguay es UYU.

Respondé solamente JSON válido:
{
  "rawText": "texto visible o resumen OCR",
  "draft": {
    "type": "expense",
    "date": "YYYY-MM-DD",
    "accountId": "id o vacío",
    "payee": "local/comercio",
    "note": "resumen breve",
    "currency": "UYU|USD",
    "amount": 0,
    "fxRateToUyu": 1,
    "fxSource": "bank|estimated|manual|not_applicable",
    "categoryId": "id o vacío",
    "tagIds": [],
    "lineItems": [
      {"description": "producto", "quantity": 1, "unitPrice": 0, "originalAmount": 0, "discountAmount": 0, "discountSource": "Itaú", "shippingAmount": 0, "amount": 0, "categoryId": "id o vacío", "tagIds": [], "confidence": 0.8}
    ],
    "missingFields": [],
    "confidence": 0.8
  }
}
`.trim();
}

function normalizeDraft(value, rawText, state, nowIso) {
  const currency = value?.currency === "USD" ? "USD" : "UYU";
  const accountId = validId(value?.accountId, state.accounts);
  const categoryId = validId(value?.categoryId, state.categories) || fallbackCategoryId(state.categories);
  const amount = normalizeMoney(Number(value?.amount) || 0);
  const date = isIsoDate(value?.date) ? value.date : nowIso;
  const lineItems = normalizeLineItems(value?.lineItems, state, categoryId, detectReceiptDiscountSource(rawText, value?.payee), rawText);
  const missingFields = new Set(Array.isArray(value?.missingFields) ? value.missingFields : []);

  if (!String(value?.payee ?? "").trim()) missingFields.add("payee");
  if (!isIsoDate(value?.date)) missingFields.add("date");
  if (amount <= 0) missingFields.add("amount");
  if (!accountId) missingFields.add("account");
  if (!categoryId || isUncategorizedId(categoryId)) missingFields.add("category");

  return {
    type: "expense",
    date,
    accountId,
    payee: String(value?.payee ?? "").trim().slice(0, 80) || "Comercio sin identificar",
    note: String(value?.note ?? rawText).trim().slice(0, 900),
    currency,
    amount,
    fxRateToUyu: currency === "USD" ? Number(value?.fxRateToUyu) || undefined : 1,
    fxSource: currency === "UYU" ? "not_applicable" : normalizeFxSource(value?.fxSource),
    categoryId,
    tagIds: normalizeTagIds(value?.tagIds, state.tags),
    lineItems,
    missingFields: Array.from(missingFields).filter((field) => ["payee", "date", "amount", "account", "category"].includes(field)),
    confidence: clamp(Number(value?.confidence), 0, 1, lineItems.length ? 0.72 : 0.55)
  };
}

function normalizeLineItems(value, state, fallbackCategory, discountSource, rawText) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => {
      const amount = normalizeMoney(Number(item?.amount) || 0);
      const description = String(item?.description ?? "").trim().slice(0, 100);
      if (!description || amount <= 0) return undefined;
      return {
        description,
        quantity: positiveNumberOrUndefined(item?.quantity),
        unitPrice: positiveNumberOrUndefined(item?.unitPrice),
        originalAmount: positiveNumberOrUndefined(item?.originalAmount),
        discountAmount: positiveNumberOrUndefined(item?.discountAmount),
        discountSource: typeof item?.discountSource === "string" && item.discountSource.trim() ? item.discountSource.trim() : undefined,
        shippingAmount: positiveNumberOrUndefined(item?.shippingAmount),
        amount,
        categoryId: validId(item?.categoryId, state.categories) || fallbackCategory,
        tagIds: normalizeTagIds(item?.tagIds, state.tags),
        confidence: clamp(Number(item?.confidence), 0, 1, 0.65)
      };
    })
    .filter(Boolean)
    .slice(0, 80);

  return normalizeReceiptLineItems(backfillReceiptDiscounts(items, rawText, discountSource), { discountSource });
}

function normalizeReceiptLineItems(lineItems, options = {}) {
  const normalizedItems = lineItems.map((item) => normalizeReceiptLineItem(item, options.discountSource)).filter(Boolean);
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

function normalizeReceiptLineItem(item, discountSource) {
  const description = String(item.description ?? "").trim().slice(0, 100);
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

function allocateShippingByProductAmount(lineItems, shippingTotal) {
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

function isReceiptShippingItem(description) {
  return /\b(?:envio|delivery|shipping|flete)\b/.test(normalizeText(description));
}

function getReceiptLineItemAmount(item) {
  return normalizeMoney(Math.abs(Number(item.amount) || 0));
}

function getReceiptLineItemShipping(item) {
  return normalizeMoney(Math.max(0, Number(item.shippingAmount) || 0));
}

function getReceiptLineItemTotal(item) {
  return normalizeMoney(getReceiptLineItemAmount(item) + getReceiptLineItemShipping(item));
}

function detectReceiptDiscountSource(rawText, payee) {
  const text = `${String(payee ?? "")} ${String(rawText ?? "")}`;
  if (/\b(?:itau|itaú)\b/i.test(text) || /\bla\s+molienda\b/i.test(text)) return "Itaú";
  return undefined;
}

const RAW_MONEY_TOKEN = String.raw`\$?\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?`;
const DISCOUNT_WORD_PATTERN = String.raw`(?:descuento|dto\.?|disc\.?|ahorro|bonificaci[oó]n|promo)`;

function backfillReceiptDiscounts(lineItems, rawText, discountSource) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  if (items.length === 0 || !rawText) return items;

  const discounts = extractRawTextDiscounts(rawText);
  if (discounts.length === 0) return items;

  const remaining = [...discounts];

  return items.map((item, index) => {
    if (positiveNumberOrUndefined(item?.discountAmount)) return item;
    const finalAmount = normalizeMoney(Number(item?.amount) || 0);
    if (finalAmount <= 0) return item;

    const match =
      remaining.find((entry) => Math.abs(normalizeMoney(entry.original - entry.discount) - finalAmount) < 0.01) ??
      (index < remaining.length ? remaining[index] : undefined);

    if (!match) return item;

    remaining.splice(remaining.indexOf(match), 1);
    const discountAmount = normalizeMoney(match.discount);
    if (discountAmount <= 0) return item;

    return {
      ...item,
      discountAmount,
      originalAmount: normalizeMoney(match.original) || normalizeMoney(finalAmount + discountAmount),
      discountSource: item?.discountSource?.trim() || discountSource || "Descuento"
    };
  });
}

function extractRawTextDiscounts(rawText) {
  const re = new RegExp(
    `(${RAW_MONEY_TOKEN})\\s*[,;]?\\s*${DISCOUNT_WORD_PATTERN}\\s*:?\\s*(${RAW_MONEY_TOKEN})`,
    "gi"
  );
  const tuples = [];
  for (const match of String(rawText ?? "").matchAll(re)) {
    const original = parseRawMoney(match[1]);
    const discount = parseRawMoney(match[2]);
    if (original > 0 && discount > 0 && discount < original) {
      tuples.push({ original, discount });
    }
  }
  return tuples;
}

function parseRawMoney(value) {
  const trimmed = String(value ?? "").replace(/[$%\s]/g, "");
  const commaIndex = trimmed.lastIndexOf(",");
  const dotIndex = trimmed.lastIndexOf(".");
  const decimalSeparator = commaIndex > dotIndex ? "," : dotIndex > commaIndex ? "." : undefined;
  let normalized;
  if (decimalSeparator) {
    const other = decimalSeparator === "," ? "." : ",";
    normalized = trimmed.split(other).join("").replace(decimalSeparator, ".");
  } else {
    normalized = trimmed.replace(/[.,]/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTagIds(value, tags) {
  if (!Array.isArray(value)) return [];
  const available = new Set(tags.map((tag) => tag.id));
  return [...new Set(value.filter((tagId) => available.has(tagId)))].slice(0, 12);
}

function normalizeFxSource(value) {
  return ["bank", "bcu", "manual", "estimated"].includes(value) ? value : "estimated";
}

function validId(value, items) {
  if (typeof value !== "string" || !value) return undefined;
  return items.some((item) => item.id === value) ? value : undefined;
}

function fallbackCategoryId(categories) {
  return (
    categories.find((category) => normalizeText(category.name).includes("sin categorizar"))?.id ??
    categories.find((category) => normalizeText(category.name).includes("other"))?.id ??
    categories[0]?.id
  );
}

function isUncategorizedId(categoryId) {
  return /uncategorized|sin_categorizar|other/.test(categoryId);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isSupportedImageDataUrl(value) {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value);
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n");
}

function parseJsonObject(text) {
  const cleaned = String(text ?? "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return undefined;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function positiveNumberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeMoney(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
