import Papa from "papaparse";
import type {
  Account,
  Category,
  Currency,
  ImportBatch,
  ImportPreview,
  ImportPreviewRow,
  ParsedTransactionDraft,
  Transaction
} from "../types";
import { buildDuplicateKey, toUyu } from "./calculations";
import { createId } from "./id";

type RawRow = Record<string, string>;

const fieldAliases = {
  date: ["date", "fecha", "transaction date", "created at"],
  amount: ["amount", "monto", "value", "importe"],
  currency: ["currency", "moneda"],
  category: ["category", "categoría", "categoria"],
  subcategory: ["subcategory", "subcategoría", "subcategoria"],
  account: ["wallet", "account", "cuenta", "billetera"],
  payee: ["payee", "merchant", "comercio", "beneficiary", "description"],
  note: ["note", "notes", "nota", "memo", "description"],
  type: ["type", "tipo"],
  fxRate: ["fx rate", "exchange rate", "tipo de cambio", "tc"]
};

export function parseSpendeeFile(text: string, fileName: string, accounts: Account[], categories: Category[], existing: Transaction[]): ImportPreview {
  const parsed = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  const existingKeys = new Set(existing.map(buildDuplicateKey));
  const rows = (parsed.data ?? []).map((raw, index) => previewRow(raw, index, accounts, categories, existingKeys));

  return {
    fileName,
    source: "spendee",
    rows
  };
}

function previewRow(
  raw: RawRow,
  index: number,
  accounts: Account[],
  categories: Category[],
  existingKeys: Set<string>
): ImportPreviewRow {
  const date = normalizeDate(readField(raw, fieldAliases.date));
  const amount = Math.abs(parseNumber(readField(raw, fieldAliases.amount)));
  const currency = normalizeCurrency(readField(raw, fieldAliases.currency));
  const fxRate = currency === "USD" ? parseNumber(readField(raw, fieldAliases.fxRate)) || undefined : 1;
  const account = matchAccount(readField(raw, fieldAliases.account), accounts, currency);
  const category = matchCategory(readField(raw, fieldAliases.subcategory) || readField(raw, fieldAliases.category), categories);
  const payee = readField(raw, fieldAliases.payee) || readField(raw, fieldAliases.note) || "Importado";
  const rawType = readField(raw, fieldAliases.type).toLowerCase();
  const type = rawType.includes("transfer")
    ? "transfer"
    : rawType.includes("income") || rawType.includes("ingreso") || parseNumber(readField(raw, fieldAliases.amount)) > 0
      ? "income"
      : "expense";
  const transferDirection = rawType.includes("incoming") ? "incoming" : rawType.includes("outgoing") ? "outgoing" : undefined;

  const draft: ParsedTransactionDraft = {
    type,
    date,
    accountId: account?.id,
    payee,
    note: readField(raw, fieldAliases.note),
    currency,
    amount,
    fxRateToUyu: fxRate,
    fxSource: currency === "UYU" ? "not_applicable" : fxRate ? "bank" : "estimated",
    categoryId: category?.id,
    transferDirection,
    tagIds: [],
    confidence: [date, amount > 0, account, category].filter(Boolean).length / 4
  };

  const duplicateKey = buildDuplicateKey({
    date: draft.date,
    accountId: draft.accountId ?? "",
    amount: draft.amount,
    currency: draft.currency,
    payee: draft.payee
  });

  return {
    id: createId(`import_row_${index}`),
    raw,
    draft,
    duplicateOf: existingKeys.has(duplicateKey) ? duplicateKey : undefined,
    warnings: buildWarnings(draft)
  };
}

function readField(raw: RawRow, aliases: string[]): string {
  const entry = Object.entries(raw).find(([key]) => aliases.includes(key.trim().toLowerCase()));
  return entry?.[1]?.trim() ?? "";
}

function normalizeDate(value: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const match = value.match(/^([0-3]?\d)[/-]([0-1]?\d)[/-](\d{2,4})/);
  if (!match) return new Date(value).toISOString().slice(0, 10);
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeCurrency(value: string): Currency {
  return /usd|us\$|d[oó]lar/i.test(value) ? "USD" : "UYU";
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  const decimal = comma > dot ? "," : ".";
  const normalized = cleaned.replace(new RegExp(`\\${decimal === "," ? "." : ","}`, "g"), "").replace(decimal, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchAccount(value: string, accounts: Account[], currency: Currency): Account | undefined {
  const lower = value.toLowerCase();
  return (
    accounts.find((account) => account.currency === currency && lower.includes(account.name.toLowerCase())) ??
    accounts.find((account) => account.currency === currency && lower.includes(account.institution.toLowerCase())) ??
    accounts.find((account) => account.currency === currency && account.active)
  );
}

function matchCategory(value: string, categories: Category[]): Category | undefined {
  const lower = value.toLowerCase();
  return (
    categories.find((category) => category.name.toLowerCase() === lower) ??
    categories.find((category) => lower.includes(category.name.toLowerCase())) ??
    categories.find((category) => category.name === "Sin categorizar")
  );
}

function buildWarnings(draft: ParsedTransactionDraft): string[] {
  const warnings: string[] = [];
  if (!draft.accountId) warnings.push("Cuenta sin mapear");
  if (!draft.categoryId) warnings.push("Categoría sin mapear");
  if (!draft.amount) warnings.push("Monto inválido");
  if (draft.currency === "USD" && !draft.fxRateToUyu) warnings.push("Falta tasa bancaria USD→UYU");
  return warnings;
}

export function importRowsToTransactions(preview: ImportPreview, selectedIds: Set<string>): { batch: ImportBatch; transactions: Transaction[] } {
  const batchId = createId("batch");
  const selected = preview.rows.filter((row) => selectedIds.has(row.id) && !row.duplicateOf);
  const createdAt = new Date().toISOString();

  return {
    batch: {
      id: batchId,
      source: preview.source,
      fileName: preview.fileName,
      createdAt,
      rowCount: preview.rows.length,
      importedCount: selected.length,
      duplicateCount: preview.rows.filter((row) => row.duplicateOf).length,
      notes: [...new Set(preview.rows.flatMap((row) => row.warnings))]
    },
    transactions: selected.map((row) => {
      const amountUyu = toUyu(row.draft.amount, row.draft.currency, row.draft.fxRateToUyu);
      return {
        id: createId("txn"),
        type: row.draft.type,
        date: row.draft.date,
        accountId: row.draft.accountId ?? "",
        transferDirection: row.draft.transferDirection,
        payee: row.draft.payee,
        note: row.draft.note,
        currency: row.draft.currency,
        amount: row.draft.amount,
        amountUyu,
        fxRateToUyu: row.draft.currency === "UYU" ? 1 : row.draft.fxRateToUyu ?? 40,
        fxSource: row.draft.fxSource,
        paymentMethod: "other",
        status: "confirmed",
        splits: [
          {
            id: createId("split"),
            categoryId: row.draft.categoryId ?? "cat_uncategorized",
            tagIds: row.draft.tagIds,
            amount: row.draft.amount,
            amountUyu
          }
        ],
        importBatchId: batchId,
        source: "import",
        createdAt
      };
    })
  };
}
