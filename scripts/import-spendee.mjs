import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";

const workspaceRoot = process.cwd();
const outputPath = path.join(workspaceRoot, "src/data/importedState.json");

const inputFiles = [
  "/Users/bruno/Downloads/transactions_export_2026-09-01_exa.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_lrm.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_payoneer.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_stm.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_paypal.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_itau-uyu-6354.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_prex-usd.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_prex-uyu.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_prestamos.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_mercadopago.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_cash-usd.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_itau-usd.csv",
  "/Users/bruno/Downloads/transactions_export_2026-09-01_billetera.csv"
];

const palette = [
  "#2f855a",
  "#2b6cb0",
  "#e76f51",
  "#7c3aed",
  "#0f766e",
  "#d97706",
  "#475569",
  "#db2777",
  "#0891b2",
  "#4f46e5",
  "#65a30d",
  "#be123c",
  "#9333ea",
  "#2563eb",
  "#ea580c"
];

const createdAt = new Date().toISOString();

const initialBalanceOverrides = new Map([
  ["Itau UYU - 6354|UYU", 10431.39],
  ["Itau USD|USD", 352.42],
  ["Préstamos|UYU", 28549]
]);

const rawRows = [];
for (const file of inputFiles) {
  const csv = await fs.readFile(file, "utf8");
  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (parsed.errors.length) {
    throw new Error(`No pude parsear ${file}: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }

  parsed.data.forEach((row, index) => {
    rawRows.push(normalizeRow(row, file, index));
  });
}

const accountMap = new Map();
for (const row of rawRows) {
  const key = `${row.wallet}|${row.currency}`;
  if (!accountMap.has(key)) {
    accountMap.set(key, {
      id: `account_${slugify(row.wallet)}_${row.currency.toLowerCase()}`,
      name: row.wallet,
      institution: inferInstitution(row.wallet),
      currency: row.currency,
      initialBalance: initialBalanceOverrides.get(key) ?? 0,
      active: true,
      color: palette[accountMap.size % palette.length],
      createdAt
    });
  }
  row.accountId = accountMap.get(key).id;
}

const transferPairs = pairTransfers(rawRows);
const pairRates = buildPairRates(transferPairs);
const fxRatesByDate = buildFxRatesByDate(pairRates);

const categoryMap = new Map([
  [
    "Transferencias",
    {
      id: "cat_transferencias",
      name: "Transferencias",
      color: "#475569",
      icon: "arrow-down-up"
    }
  ],
  [
    "Sin categorizar",
    {
      id: "cat_sin_categorizar",
      name: "Sin categorizar",
      color: "#64748b",
      icon: "circle"
    }
  ]
]);

for (const row of rawRows) {
  const categoryName = row.type === "transfer" ? "Transferencias" : row.category || "Sin categorizar";
  if (!categoryMap.has(categoryName)) {
    categoryMap.set(categoryName, {
      id: `cat_${slugify(categoryName)}`,
      name: categoryName,
      color: palette[categoryMap.size % palette.length],
      icon: "circle"
    });
  }
  row.categoryId = categoryMap.get(categoryName).id;
}

const tagMap = new Map();
for (const row of rawRows) {
  for (const label of row.labels) {
    if (!tagMap.has(label)) {
      tagMap.set(label, {
        id: `tag_${slugify(label)}`,
        name: label,
        color: palette[tagMap.size % palette.length]
      });
    }
  }
  row.tagIds = row.labels.map((label) => tagMap.get(label).id);
}

const transactions = rawRows
  .map((row) => {
    const pairRate = pairRates.get(row.rawId);
    const fxRateToUyu = row.currency === "UYU" ? 1 : pairRate?.rate ?? findNearestFxRate(row.date, fxRatesByDate)?.rate ?? 40;
    const fxSource = row.currency === "UYU" ? "not_applicable" : pairRate ? "bank" : "estimated";
    const amountUyu = money(row.amount * fxRateToUyu);
    const type = row.type;
    const noteParts = [row.note, row.labels.length ? `Labels: ${row.labels.join(", ")}` : ""].filter(Boolean);

    return {
      id: `txn_${row.rawId}`,
      type,
      date: row.date,
      accountId: row.accountId,
      transferDirection: row.transferDirection,
      payee: buildPayee(row),
      note: noteParts.join(" · "),
      currency: row.currency,
      amount: row.amount,
      amountUyu,
      fxRateToUyu,
      fxSource,
      paymentMethod: type === "transfer" ? "transfer" : "other",
      status: "confirmed",
      splits: [
        {
          id: `split_${row.rawId}`,
          categoryId: row.categoryId,
          tagIds: row.tagIds,
          amount: row.amount,
          amountUyu
        }
      ],
      importBatchId: "batch_spendee_2026_09_01",
      source: "import",
      createdAt: row.dateTime
    };
  })
  .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));

const fxRates = Array.from(fxRatesByDate.entries())
  .map(([date, values], index) => ({
    id: `fx_usd_${date.replaceAll("-", "_")}_${index}`,
    date,
    currency: "USD",
    rateToUyu: money(values.reduce((sum, value) => sum + value.rate, 0) / values.length),
    source: "bank",
    createdAt
  }))
  .sort((a, b) => a.date.localeCompare(b.date));

const accounts = Array.from(accountMap.values()).sort((a, b) => a.name.localeCompare(b.name));
const categories = Array.from(categoryMap.values()).sort((a, b) => {
  if (a.id === "cat_transferencias") return -1;
  if (b.id === "cat_transferencias") return 1;
  if (a.id === "cat_sin_categorizar") return 1;
  if (b.id === "cat_sin_categorizar") return -1;
  return a.name.localeCompare(b.name);
});
const tags = Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name));

const state = {
  accounts,
  categories,
  tags,
  transactions,
  budgets: [],
  recurringRules: [],
  importBatches: [
    {
      id: "batch_spendee_2026_09_01",
      source: "spendee",
      fileName: "transactions_export_2026-09-01_*.csv",
      createdAt,
      rowCount: rawRows.length,
      importedCount: transactions.length,
      duplicateCount: 0,
      notes: [
        "Import generado desde exports por wallet de Spendee.",
        `${transferPairs.length} pares de transferencias detectados; ${fxRates.length} días con tasa USD→UYU inferida.`
      ]
    }
  ],
  inboxDrafts: [],
  fxRates,
  agentConversations: []
};

const summary = buildSummary(state, rawRows, transferPairs, fxRatesByDate);
await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: "spendee-2026-09-01-all-v3",
      summary,
      state
    },
    null,
    2
  )}\n`
);

console.log(JSON.stringify(summary, null, 2));

function normalizeRow(row, file, index) {
  const typeText = text(row.Type);
  const amountSigned = parseMoney(row.Amount);
  const dateTime = text(row.Date);
  const date = dateTime.slice(0, 10);
  const rawId = `${slugify(path.basename(file, ".csv"))}_${index + 1}`;

  return {
    rawId,
    file: path.basename(file),
    date,
    dateTime,
    wallet: normalizeSpaces(row.Wallet),
    type: normalizeType(typeText),
    transferDirection: typeText.toLowerCase().includes("incoming")
      ? "incoming"
      : typeText.toLowerCase().includes("outgoing")
        ? "outgoing"
        : undefined,
    category: normalizeSpaces(row["Category name"]),
    amount: money(Math.abs(amountSigned)),
    amountSigned: money(amountSigned),
    currency: normalizeCurrency(row.Currency),
    note: normalizeSpaces(row.Note),
    labels: parseLabels(row.Labels),
    author: normalizeSpaces(row.Author)
  };
}

function normalizeType(typeText) {
  const lower = typeText.toLowerCase();
  if (lower.includes("transfer")) return "transfer";
  if (lower.includes("income")) return "income";
  return "expense";
}

function normalizeCurrency(value) {
  return text(value).toUpperCase() === "USD" ? "USD" : "UYU";
}

function parseMoney(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLabels(value) {
  const normalized = normalizeSpaces(value);
  if (!normalized) return [];
  return normalized
    .split(/[;,]/)
    .map((item) => normalizeSpaces(item))
    .filter(Boolean);
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeSpaces(value) {
  return text(value).replace(/\s+/g, " ");
}

function slugify(value) {
  const slug = normalizeSpaces(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "sin_nombre";
}

function inferInstitution(wallet) {
  const lower = wallet.toLowerCase();
  if (lower.includes("itau")) return "Itaú";
  if (lower.includes("mercadopago")) return "MercadoPago";
  if (lower.includes("prex")) return "Prex";
  if (lower.includes("paypal")) return "PayPal";
  if (lower.includes("payoneer")) return "Payoneer";
  if (lower.includes("cash") || lower.includes("billetera")) return "Efectivo";
  return wallet;
}

function pairTransfers(rows) {
  const transfers = rows
    .map((row, index) => ({ row, index, time: Date.parse(row.dateTime) }))
    .filter((item) => item.row.type === "transfer")
    .sort((a, b) => a.time - b.time);
  const used = new Set();
  const pairs = [];

  for (const source of transfers) {
    if (used.has(source.index)) continue;
    let best;
    for (const target of transfers) {
      if (source.index === target.index || used.has(target.index)) continue;
      if (source.row.transferDirection === target.row.transferDirection) continue;
      const seconds = Math.abs(source.time - target.time) / 1000;
      if (seconds > 180) continue;

      const candidate = scoreTransferPair(source, target, seconds);
      if (!candidate) continue;
      if (!best || candidate.score < best.score) best = candidate;
    }

    if (!best) continue;
    used.add(source.index);
    used.add(best.target.index);
    pairs.push({
      left: source.row.rawId,
      right: best.target.row.rawId,
      rate: best.rate,
      date: source.row.date
    });
  }

  return pairs;
}

function scoreTransferPair(source, target, seconds) {
  if (source.row.currency === target.row.currency) {
    const diffRatio = Math.abs(source.row.amount - target.row.amount) / Math.max(source.row.amount, target.row.amount, 1);
    if (diffRatio > 0.01) return undefined;
    return { target, rate: undefined, score: seconds + diffRatio * 10000 };
  }

  const usd = source.row.currency === "USD" ? source.row : target.row;
  const uyu = source.row.currency === "UYU" ? source.row : target.row;
  const rate = uyu.amount / usd.amount;
  if (!Number.isFinite(rate) || rate < 20 || rate > 60) return undefined;
  return { target, rate: money(rate), score: seconds + Math.abs(rate - 40) };
}

function buildPairRates(pairs) {
  const rates = new Map();
  for (const pair of pairs) {
    if (!pair.rate) continue;
    rates.set(pair.left, { rate: pair.rate, date: pair.date });
    rates.set(pair.right, { rate: pair.rate, date: pair.date });
  }
  return rates;
}

function buildFxRatesByDate(pairRates) {
  const byDate = new Map();
  for (const value of pairRates.values()) {
    if (!byDate.has(value.date)) byDate.set(value.date, []);
    byDate.get(value.date).push(value);
  }
  return byDate;
}

function findNearestFxRate(date, fxRatesByDate) {
  if (fxRatesByDate.has(date)) {
    const values = fxRatesByDate.get(date);
    return { rate: money(values.reduce((sum, value) => sum + value.rate, 0) / values.length), source: "bank" };
  }

  const target = Date.parse(`${date}T00:00:00Z`);
  let best;
  for (const [rateDate, values] of fxRatesByDate.entries()) {
    const distance = Math.abs(Date.parse(`${rateDate}T00:00:00Z`) - target);
    const rate = money(values.reduce((sum, value) => sum + value.rate, 0) / values.length);
    if (!best || distance < best.distance) best = { rate, distance, source: "estimated" };
  }
  return best;
}

function buildPayee(row) {
  if (row.note) return row.note.slice(0, 80);
  if (row.labels.length) return row.labels[0].slice(0, 80);
  if (row.type === "transfer") return row.transferDirection === "incoming" ? "Transferencia entrante" : "Transferencia saliente";
  return row.category || "Sin detalle";
}

function buildSummary(state, rows, transferPairs, fxRatesByDate) {
  const typeCounts = countBy(rows, (row) => row.type === "transfer" ? `${row.transferDirection} transfer` : row.type);
  const walletBalances = state.accounts.map((account) => {
    const rowsForAccount = rows.filter((row) => row.accountId === account.id);
    return {
      wallet: account.name,
      currency: account.currency,
      rows: rowsForAccount.length,
      net: money(rowsForAccount.reduce((sum, row) => sum + row.amountSigned, 0))
    };
  });
  const categoryCounts = countBy(rows, (row) => row.category || "(blank)");

  return {
    sourceFiles: inputFiles.map((file) => path.basename(file)),
    rowCount: rows.length,
    transactionCount: state.transactions.length,
    accountCount: state.accounts.length,
    categoryCount: state.categories.length,
    tagCount: state.tags.length,
    dateRange: {
      from: rows.reduce((min, row) => row.date < min ? row.date : min, rows[0]?.date ?? ""),
      to: rows.reduce((max, row) => row.date > max ? row.date : max, rows[0]?.date ?? "")
    },
    typeCounts,
    walletBalances,
    transferPairs: transferPairs.length,
    inferredFxRateDays: fxRatesByDate.size,
    topCategories: Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, rows]) => ({ name, rows }))
  };
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function money(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
