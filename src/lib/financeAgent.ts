import type {
  Account,
  AgentAnswer,
  AgentEvidenceRow,
  AppState,
  Category,
  Currency,
  Tag,
  Transaction,
  TransactionLineItem
} from "../types";
import { getMonthSummary, getMonthTransactions, getSplitAmountUyu, normalizeMoney } from "./calculations";
import { monthKey, todayIso } from "./date";
import { getReceiptLineItemDiscount, getReceiptLineItemShipping, getReceiptLineItemTotal } from "./inboxParser";

interface Lookups {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  tags: Map<string, Tag>;
}

interface MonthTarget {
  month: string;
  label: string;
}

interface TravelTrip {
  label: string;
  transactions: Transaction[];
  from: string;
  to: string;
  explicitLabel: boolean;
}

interface ProductRecord {
  transaction: Transaction;
  item: TransactionLineItem;
}

interface SavingsRecord extends ProductRecord {
  discountUyu: number;
}

const monthNames = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
];

const monthAliases: Record<string, number> = {
  enero: 1,
  january: 1,
  febrero: 2,
  february: 2,
  marzo: 3,
  march: 3,
  abril: 4,
  april: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  june: 6,
  julio: 7,
  july: 7,
  agosto: 8,
  august: 8,
  septiembre: 9,
  setiembre: 9,
  september: 9,
  octubre: 10,
  october: 10,
  noviembre: 11,
  november: 11,
  diciembre: 12,
  december: 12
};

const europePlacePattern =
  /\b(europa|europe|amsterdam|bruselas|brussels|praga|prague|paris|madrid|barcelona|roma|rome|lisboa|lisbon|londres|london|italia|italy|francia|france|espana|spain|alemania|germany|holanda|netherlands|belgica|belgium|portugal)\b/;

const stopwords = new Set([
  "acerca",
  "ahora",
  "algo",
  "ante",
  "antes",
  "cada",
  "como",
  "con",
  "contra",
  "cual",
  "cuando",
  "cuanto",
  "cuanta",
  "cuantos",
  "cuantas",
  "de",
  "del",
  "desde",
  "donde",
  "el",
  "ella",
  "ellos",
  "en",
  "era",
  "ese",
  "esta",
  "este",
  "fue",
  "gaste",
  "gasto",
  "gastos",
  "hace",
  "la",
  "las",
  "le",
  "los",
  "mas",
  "me",
  "mes",
  "meses",
  "mi",
  "mis",
  "para",
  "por",
  "que",
  "se",
  "sin",
  "sobre",
  "tu",
  "un",
  "una",
  "y"
]);

const productSynonymGroups = [
  ["pollo", "suprema", "ave", "pechuga", "pata", "muslo", "nugget", "nuggets"],
  ["papas", "papa", "papita", "papitas"],
  ["carne", "bife", "asado", "vacuno", "entraña", "entrana", "milanesa", "lomo", "picada"],
  ["queso", "quesos", "mozzarella", "parmesano", "provolone"],
  ["huevo", "huevos"],
  ["yogur", "yogurt", "yogurisimo", "yogurísimo"],
  ["pan", "panes", "baguette"],
  ["gaseosa", "refresco", "coca", "pepsi"],
  ["verduras", "verdura", "vegetal", "vegetales"]
];

const moneyFormatters: Record<Currency, Intl.NumberFormat> = {
  UYU: new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "UYU",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }),
  USD: new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
};

export function askFinanceAgent(question: string, state: AppState, nowIso: string = todayIso()): AgentAnswer {
  const normalizedQuestion = normalizeLookupKey(question);
  const lookups = createLookups(state);

  const answer = !normalizedQuestion
    ? buildFallbackAnswer(state, nowIso)
    : isTravelQuestion(normalizedQuestion)
      ? answerTravelQuestion(normalizedQuestion, state, lookups)
      : isIncomeQuestion(normalizedQuestion)
        ? answerIncomeQuestion(normalizedQuestion, state, lookups, nowIso)
        : isSavingsQuestion(normalizedQuestion)
          ? answerSavingsQuestion(normalizedQuestion, state, lookups)
        : isProductQuestion(normalizedQuestion, state, lookups)
          ? answerProductQuestion(normalizedQuestion, state, lookups)
          : isMonthSummaryQuestion(normalizedQuestion)
            ? answerMonthSummaryQuestion(normalizedQuestion, state, lookups, nowIso)
            : buildFallbackAnswer(state, nowIso);

  return { ...answer, agentName: "Analista local" };
}

function answerIncomeQuestion(question: string, state: AppState, lookups: Lookups, nowIso: string): AgentAnswer {
  const salaryOnly = /\b(salario|salarios|sueldo|sueldos|salary|nomina)\b/.test(question);
  if (salaryOnly && isYearQuestion(question)) return answerYearlySalaryQuestion(question, state, lookups, nowIso);

  const target = parseMonthTarget(question, nowIso);
  const monthTransactions = getMonthTransactions(state.transactions, target.month);
  const matchingTransactions = monthTransactions.filter(
    (transaction) => transaction.type === "income" && (!salaryOnly || isSalaryTransaction(transaction, lookups))
  );
  const allIncome = monthTransactions.filter((transaction) => transaction.type === "income");
  const totalUyu = sumTransactionUyu(matchingTransactions);
  const originalTotals = formatCurrencyBreakdown(matchingTransactions);
  const rowTitle = salaryOnly ? "salario" : "ingresos";

  if (matchingTransactions.length === 0) {
    return {
      intent: "income",
      title: salaryOnly ? `Salario en ${target.label}` : `Ingresos en ${target.label}`,
      answer: salaryOnly
        ? `No encontré movimientos marcados como salario en ${target.label}. En ese mes hay ${formatMoney(
            sumTransactionUyu(allIncome),
            "UYU"
          )} de ingresos totales.`
        : `No encontré ingresos confirmados en ${target.label}.`,
      confidence: "media",
      facts: [
        { label: "Mes", value: target.label, tone: "neutral" },
        { label: "Movimientos", value: "0", tone: "neutral" },
        { label: "Ingresos totales", value: formatMoney(sumTransactionUyu(allIncome), "UYU"), tone: "good" }
      ],
      rows: buildTransactionRows(allIncome.slice(0, 6), lookups, "good"),
      suggestions: ["¿Cuál fue mi salario este mes?", "¿Cuál fue mi salario hace 5 meses?", "Resumen de ingresos este mes"],
      data: { totalUyu: 0, count: 0, month: target.month }
    };
  }

  return {
    intent: "income",
    title: `${capitalize(rowTitle)} en ${target.label}`,
    answer: `En ${target.label} encontré ${pluralize(matchingTransactions.length, "movimiento")} de ${rowTitle} por ${formatMoney(
      totalUyu,
      "UYU"
    )} equivalente. En moneda original: ${originalTotals}.`,
    confidence: salaryOnly ? "alta" : "media",
    facts: [
      { label: salaryOnly ? "Total salario" : "Total ingresos", value: formatMoney(totalUyu, "UYU"), tone: "good" },
      { label: "Mes", value: target.label, tone: "neutral" },
      { label: "Movimientos", value: String(matchingTransactions.length), tone: "neutral" },
      { label: "Original", value: originalTotals, tone: "accent" }
    ],
    rows: buildTransactionRows(matchingTransactions, lookups, "good"),
    suggestions: ["¿Cuál fue mi salario el mes pasado?", "¿Cuál fue mi salario hace 5 meses?", "¿Cuánto ingresé este mes?"],
    data: { totalUyu, count: matchingTransactions.length, month: target.month }
  };
}

function answerYearlySalaryQuestion(question: string, state: AppState, lookups: Lookups, nowIso: string): AgentAnswer {
  const year = question.match(/\b(20\d{2})\b/)?.[1] ?? nowIso.slice(0, 4);
  const startDate = `${year}-01-01`;
  const endDate = year === nowIso.slice(0, 4) ? nowIso : `${year}-12-31`;
  const salaryTransactions = state.transactions
    .filter((transaction) => transaction.status === "confirmed")
    .filter((transaction) => transaction.date >= startDate && transaction.date <= endDate)
    .filter((transaction) => isSalaryTransaction(transaction, lookups));
  const totalUyu = sumTransactionUyu(salaryTransactions);
  const originalTotals = formatCurrencyBreakdown(salaryTransactions);
  const monthRows = buildIncomeMonthRows(salaryTransactions);

  if (salaryTransactions.length === 0) {
    return {
      intent: "income",
      title: `Salarios ${year}`,
      answer: `No encontré movimientos marcados como salario entre ${formatDate(startDate)} y ${formatDate(endDate)}.`,
      confidence: "media",
      facts: [
        { label: "Periodo", value: `${formatDate(startDate)} - ${formatDate(endDate)}`, tone: "neutral" },
        { label: "Movimientos", value: "0", tone: "neutral" }
      ],
      rows: [],
      suggestions: ["¿Cuál fue mi salario este mes?", "¿Cuál fue mi salario hace 5 meses?", "¿Cuánto ingresé este año?"],
      data: { totalUyu: 0, count: 0, year }
    };
  }

  return {
    intent: "income",
    title: `Salarios ${year}`,
    answer: `Entre ${formatDate(startDate)} y ${formatDate(endDate)} encontré ${pluralize(
      salaryTransactions.length,
      "movimiento"
    )} de salario por ${formatMoney(totalUyu, "UYU")} equivalente. En moneda original: ${originalTotals}.`,
    confidence: "alta",
    facts: [
      { label: "Total salario", value: formatMoney(totalUyu, "UYU"), tone: "good" },
      { label: "Periodo", value: `${formatDate(startDate)} - ${formatDate(endDate)}`, tone: "neutral" },
      { label: "Meses", value: String(monthRows.length), tone: "accent" },
      { label: "Original", value: originalTotals, tone: "accent" }
    ],
    rows: monthRows,
    suggestions: ["¿Cuál fue mi salario el mes pasado?", "¿Cuánto ingresé este mes?", "¿Cuánto gasté este año?"],
    data: { totalUyu, count: salaryTransactions.length, year }
  };
}

function answerTravelQuestion(question: string, state: AppState, lookups: Lookups): AgentAnswer {
  const destination = detectTravelDestination(question);
  const transactions = state.transactions.filter((transaction) => {
    if (transaction.status !== "confirmed") return false;
    if (transaction.type !== "expense" && transaction.type !== "refund") return false;
    if (destination === "Europa") return isEuropeTravelTransaction(transaction, lookups);
    if (destination === "Ruta 66") return transactionSearchText(transaction, lookups).includes("ruta 66");
    return isTravelTransaction(transaction, lookups);
  });
  const trips = buildTravelTrips(transactions, lookups);
  const latestTrip = trips.sort((a, b) => b.to.localeCompare(a.to))[0];

  if (!latestTrip) {
    return {
      intent: "travel",
      title: destination ? `Viaje a ${destination}` : "Viajes",
      answer: destination
        ? `No encontré gastos confirmados asociados a ${destination}.`
        : `No encontré gastos confirmados asociados a viajes.`,
      confidence: "baja",
      facts: [{ label: "Movimientos", value: "0", tone: "neutral" }],
      rows: [],
      suggestions: ["¿Cuánto gasté en Travel este año?", "¿Cuánto gasté en Ruta 66?", "¿Cuánto gasté este mes?"],
      data: { totalUyu: 0, count: 0 }
    };
  }

  const signedTransactions = latestTrip.transactions;
  const totalUyu = sumTransactionUyu(signedTransactions);
  const originalTotals = formatCurrencyBreakdown(signedTransactions);
  const titleDestination = destination ? ` a ${destination}` : "";
  const title = `Último viaje${titleDestination}: ${latestTrip.label}`;
  const evidenceNote = latestTrip.explicitLabel
    ? `Usé la etiqueta/nombre "${latestTrip.label}" y gastos de Travel cercanos al mismo viaje.`
    : `Lo inferí por movimientos de Travel agrupados por fecha.`;
  const subject = destination ? `tu último viaje a ${destination}` : "tu último viaje";

  return {
    intent: "travel",
    title,
    answer: `Para ${subject} encontré el grupo ${latestTrip.label}: ${pluralize(
      signedTransactions.length,
      "movimiento"
    )} entre ${formatDate(latestTrip.from)} y ${formatDate(latestTrip.to)} por ${formatMoney(
      totalUyu,
      "UYU"
    )} equivalente. En moneda original: ${originalTotals}. ${evidenceNote}`,
    confidence: latestTrip.explicitLabel ? "alta" : "media",
    facts: [
      { label: "Total", value: formatMoney(totalUyu, "UYU"), tone: "bad" },
      { label: "Grupo", value: latestTrip.label, tone: "accent" },
      { label: "Periodo", value: `${formatDate(latestTrip.from)} - ${formatDate(latestTrip.to)}`, tone: "neutral" },
      { label: "Original", value: originalTotals, tone: "neutral" }
    ],
    rows: buildTransactionRows(
      [...signedTransactions].sort((a, b) => signedAmountUyu(b) - signedAmountUyu(a)).slice(0, 8),
      lookups,
      "bad"
    ),
    suggestions: ["¿Cuánto gasté en Ruta 66?", "¿Cuánto gasté este mes?", "¿Cuál fue mi salario este mes?"],
    data: { totalUyu, count: signedTransactions.length, from: latestTrip.from, to: latestTrip.to, trip: latestTrip.label }
  };
}

function answerProductQuestion(question: string, state: AppState, lookups: Lookups): AgentAnswer {
  const records = getProductRecords(state);
  const productTerm = detectProductTerm(question, records);
  const matchingRecords = productTerm
    ? records.filter((record) => matchesProductDescription(record.item.description, productTerm))
    : records;
  const totalUyu = normalizeMoney(matchingRecords.reduce((sum, record) => sum + record.item.amountUyu, 0));

  if (matchingRecords.length === 0) {
    return {
      intent: "product",
      title: "Productos",
      answer: "No encontré items de tickets que coincidan con esa búsqueda.",
      confidence: "media",
      facts: [{ label: "Items", value: "0", tone: "neutral" }],
      rows: [],
      suggestions: ["¿Cuánto gasté en pollo?", "¿Qué productos compré más este mes?", "¿Cuánto gasté este mes?"],
      data: { totalUyu: 0, count: 0 }
    };
  }

  const sortedRecords = [...matchingRecords].sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
  const latest = sortedRecords[0];
  const previous = sortedRecords.find((record) => record.transaction.id !== latest.transaction.id);
  const comparison = previous
    ? ` La compra anterior comparable fue ${formatMoney(previous.item.amountUyu, "UYU")} en ${previous.transaction.payee || "sin comercio"}; la última fue ${formatMoney(
        latest.item.amountUyu,
        "UYU"
      )}.`
    : "";
  const termLabel = productTerm ? `"${productTerm}"` : "items de tickets";
  const totalQuantity = normalizeMoney(matchingRecords.reduce((sum, record) => sum + Number(record.item.quantity ?? 1), 0));
  const savingsUyu = normalizeMoney(
    matchingRecords.reduce((sum, record) => sum + convertLineItemAmount(record.transaction, getReceiptLineItemDiscount(record.item)), 0)
  );

  return {
    intent: "product",
    title: productTerm ? `Producto: ${productTerm}` : "Productos de tickets",
    answer: `Encontré ${pluralize(matchingRecords.length, "item")} para ${termLabel} por ${formatMoney(
      totalUyu,
      "UYU"
    )} equivalente.${comparison}`,
    confidence: productTerm ? "media" : "baja",
    facts: [
      { label: "Total", value: formatMoney(totalUyu, "UYU"), tone: "bad" },
      { label: "Items", value: String(matchingRecords.length), tone: "neutral" },
      { label: "Unidades", value: formatQuantity(totalQuantity), tone: "neutral" },
      ...(savingsUyu > 0 ? [{ label: "Ahorro", value: formatMoney(savingsUyu, "UYU"), tone: "good" as const }] : []),
      { label: "Última compra", value: formatDate(latest.transaction.date), tone: "accent" }
    ],
    rows: sortedRecords.slice(0, 8).map((record) => ({
      date: formatDate(record.transaction.date),
      title: record.item.description,
      meta: formatProductRowMeta(record, lookups),
      amount: formatMoney(record.item.amountUyu, "UYU"),
      tone: "bad"
    })),
    suggestions: ["¿Cuánto gasté en pollo?", "¿Qué productos compré más este mes?", "¿Cuánto gasté en supermercado este mes?"],
    data: { totalUyu, count: matchingRecords.length, term: productTerm ?? "" }
  };
}

function answerSavingsQuestion(question: string, state: AppState, lookups: Lookups): AgentAnswer {
  const source = /\b(?:itau|itaú)\b/.test(question) ? "itau" : undefined;
  const records = getSavingsRecords(state, source);
  const totalUyu = normalizeMoney(records.reduce((sum, record) => sum + record.discountUyu, 0));
  const sourceLabel = source === "itau" ? "Itaú" : "descuentos";

  if (records.length === 0) {
    return {
      intent: "savings",
      title: source === "itau" ? "Ahorro Itaú" : "Ahorros por descuentos",
      answer:
        source === "itau"
          ? "Todavía no encontré descuentos guardados como ahorro Itaú."
          : "Todavía no encontré descuentos guardados en tickets.",
      confidence: "media",
      facts: [{ label: "Ahorro", value: formatMoney(0, "UYU"), tone: "neutral" }],
      rows: [],
      suggestions: ["¿Cuánto ahorré con Itaú?", "¿Qué productos tuvieron más descuento?", "¿Cuánto gasté en La Molienda?"],
      data: { totalUyu: 0, count: 0, source: source ?? "" }
    };
  }

  const sortedRecords = [...records].sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
  const totalQuantity = normalizeMoney(sortedRecords.reduce((sum, record) => sum + Number(record.item.quantity ?? 1), 0));

  return {
    intent: "savings",
    title: source === "itau" ? "Ahorro Itaú" : "Ahorros por descuentos",
    answer: `Encontré ${pluralize(records.length, "item")} con ahorro ${sourceLabel} por ${formatMoney(
      totalUyu,
      "UYU"
    )} equivalente.`,
    confidence: "media",
    facts: [
      { label: "Ahorro total", value: formatMoney(totalUyu, "UYU"), tone: "good" },
      { label: "Items", value: String(records.length), tone: "neutral" },
      { label: "Unidades", value: formatQuantity(totalQuantity), tone: "neutral" },
      { label: "Último ahorro", value: formatDate(sortedRecords[0].transaction.date), tone: "accent" }
    ],
    rows: sortedRecords.slice(0, 8).map((record) => ({
      date: formatDate(record.transaction.date),
      title: record.item.description,
      meta: formatProductRowMeta(record, lookups),
      amount: formatMoney(record.discountUyu, "UYU"),
      tone: "good"
    })),
    suggestions: ["¿Cuánto ahorré con Itaú?", "¿Qué productos compré más este mes?", "¿Cuánto gasté en La Molienda?"],
    data: { totalUyu, count: records.length, source: source ?? "" }
  };
}

function answerMonthSummaryQuestion(question: string, state: AppState, lookups: Lookups, nowIso: string): AgentAnswer {
  const target = parseMonthTarget(question, nowIso);
  const transactions = getMonthTransactions(state.transactions, target.month);
  const summary = getMonthSummary(state.transactions, target.month);
  const categoryRows = getExpenseCategoryRows(transactions, lookups).slice(0, 6);

  return {
    intent: "month_summary",
    title: `Resumen de ${target.label}`,
    answer: `En ${target.label} registraste ${formatMoney(summary.incomeUyu, "UYU")} de ingresos, ${formatMoney(
      summary.expenseUyu,
      "UYU"
    )} de gastos y un neto de ${formatMoney(summary.netUyu, "UYU")}.`,
    confidence: "alta",
    facts: [
      { label: "Ingresos", value: formatMoney(summary.incomeUyu, "UYU"), tone: "good" },
      { label: "Gastos", value: formatMoney(summary.expenseUyu, "UYU"), tone: "bad" },
      { label: "Neto", value: formatMoney(summary.netUyu, "UYU"), tone: summary.netUyu >= 0 ? "good" : "bad" },
      { label: "Movimientos", value: String(transactions.length), tone: "neutral" }
    ],
    rows: categoryRows.map((row) => ({
      date: target.label,
      title: row.name,
      meta: pluralize(row.count, "movimiento"),
      amount: formatMoney(row.amountUyu, "UYU"),
      tone: "bad"
    })),
    suggestions: ["¿Cuál fue mi salario este mes?", "¿Cuánto gasté en mi último viaje a Europa?", "¿Cuál fue mi salario hace 5 meses?"],
    data: { incomeUyu: summary.incomeUyu, expenseUyu: summary.expenseUyu, netUyu: summary.netUyu, month: target.month }
  };
}

function buildIncomeMonthRows(transactions: Transaction[]): AgentEvidenceRow[] {
  const rows = new Map<string, { amountUyu: number; original: Record<Currency, number>; count: number }>();

  transactions.forEach((transaction) => {
    const key = monthKey(transaction.date);
    const current = rows.get(key) ?? { amountUyu: 0, original: { UYU: 0, USD: 0 }, count: 0 };
    current.amountUyu = normalizeMoney(current.amountUyu + signedAmountUyu(transaction));
    current.original[transaction.currency] = normalizeMoney(current.original[transaction.currency] + signedOriginalAmount(transaction));
    current.count += 1;
    rows.set(key, current);
  });

  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, row]) => ({
      date: formatMonthLabel(month),
      title: "Salary",
      meta: pluralize(row.count, "movimiento"),
      amount: `${formatMoney(row.amountUyu, "UYU")} · ${formatOriginalTotals(row.original)}`,
      tone: "good"
    }));
}

function isYearQuestion(question: string): boolean {
  return /\b(ano|year|anual|anuales|este\s+ano|todo\s+este\s+ano)\b/.test(question);
}

function buildFallbackAnswer(state: AppState, nowIso: string): AgentAnswer {
  const currentMonth = monthKey(nowIso);
  const summary = getMonthSummary(state.transactions, currentMonth);
  const ticketItems = state.transactions.reduce((count, transaction) => count + (transaction.lineItems?.length ?? 0), 0);

  return {
    intent: "fallback",
    title: "Agente financiero",
    answer: `Tengo cargados ${state.transactions.length} movimientos y ${ticketItems} items de tickets. Este mes vas en ${formatMoney(
      summary.expenseUyu,
      "UYU"
    )} de gastos y ${formatMoney(summary.incomeUyu, "UYU")} de ingresos.`,
    confidence: "media",
    facts: [
      { label: "Movimientos", value: String(state.transactions.length), tone: "neutral" },
      { label: "Tickets", value: String(ticketItems), tone: "accent" },
      { label: "Gasto mes", value: formatMoney(summary.expenseUyu, "UYU"), tone: "bad" },
      { label: "Ingreso mes", value: formatMoney(summary.incomeUyu, "UYU"), tone: "good" }
    ],
    rows: [],
    suggestions: ["¿Cuánto gasté en mi último viaje a Europa?", "¿Cuál fue mi salario este mes?", "¿Cuál fue mi salario hace 5 meses?"],
    data: { transactions: state.transactions.length, ticketItems, month: currentMonth }
  };
}

function parseMonthTarget(question: string, nowIso: string): MonthTarget {
  const currentMonth = monthKey(nowIso);
  const monthsAgoMatch = question.match(/\bhace\s+(\d+)\s+mes(?:es)?\b/) ?? question.match(/\b(\d+)\s+mes(?:es)?\s+atras\b/);
  if (monthsAgoMatch) {
    const rawValue = monthsAgoMatch[1] ?? monthsAgoMatch[2];
    const month = shiftMonth(currentMonth, -Number(rawValue));
    return { month, label: formatMonthLabel(month) };
  }

  if (/\b(mes\s+pasado|ultimo\s+mes|mes\s+anterior)\b/.test(question)) {
    const month = shiftMonth(currentMonth, -1);
    return { month, label: formatMonthLabel(month) };
  }

  const explicitMonth = Object.entries(monthAliases).find(([alias]) => new RegExp(`\\b${alias}\\b`).test(question));
  if (explicitMonth) {
    const [, monthNumber] = explicitMonth;
    const currentYear = Number(currentMonth.slice(0, 4));
    const currentMonthNumber = Number(currentMonth.slice(5, 7));
    const explicitYear = question.match(/\b(20\d{2})\b/)?.[1];
    const year = explicitYear ? Number(explicitYear) : monthNumber > currentMonthNumber ? currentYear - 1 : currentYear;
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    return { month, label: formatMonthLabel(month) };
  }

  return { month: currentMonth, label: formatMonthLabel(currentMonth) };
}

function buildTravelTrips(transactions: Transaction[], lookups: Lookups): TravelTrip[] {
  const byLabel = new Map<string, TravelTrip>();
  const unlabeled: Transaction[] = [];

  transactions.forEach((transaction) => {
    const label = extractTripLabel(transaction, lookups);
    if (!label) {
      unlabeled.push(transaction);
      return;
    }

    const current = byLabel.get(label) ?? {
      label,
      transactions: [],
      from: transaction.date,
      to: transaction.date,
      explicitLabel: true
    };
    current.transactions.push(transaction);
    current.from = current.from < transaction.date ? current.from : transaction.date;
    current.to = current.to > transaction.date ? current.to : transaction.date;
    byLabel.set(label, current);
  });

  const labelledTrips = Array.from(byLabel.values());
  const remainingUnlabeled: Transaction[] = [];
  unlabeled.forEach((transaction) => {
    const closest = findClosestTrip(transaction, labelledTrips);
    if (!closest || dateDistanceFromRange(transaction.date, closest.from, closest.to) > 60) {
      remainingUnlabeled.push(transaction);
      return;
    }

    closest.transactions.push(transaction);
    closest.from = closest.from < transaction.date ? closest.from : transaction.date;
    closest.to = closest.to > transaction.date ? closest.to : transaction.date;
  });

  return [...labelledTrips, ...groupUnlabeledTrips(remainingUnlabeled)];
}

function groupUnlabeledTrips(transactions: Transaction[]): TravelTrip[] {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const groups: TravelTrip[] = [];

  sorted.forEach((transaction) => {
    const last = groups[groups.length - 1];
    if (!last || daysBetween(last.to, transaction.date) > 21) {
      groups.push({
        label: `Viaje ${formatMonthLabel(monthKey(transaction.date))}`,
        transactions: [transaction],
        from: transaction.date,
        to: transaction.date,
        explicitLabel: false
      });
      return;
    }

    last.transactions.push(transaction);
    last.to = transaction.date;
  });

  return groups;
}

function findClosestTrip(transaction: Transaction, trips: TravelTrip[]): TravelTrip | undefined {
  return trips
    .map((trip) => ({ trip, distance: dateDistanceFromRange(transaction.date, trip.from, trip.to) }))
    .sort((a, b) => a.distance - b.distance)[0]?.trip;
}

function dateDistanceFromRange(date: string, from: string, to: string): number {
  if (date >= from && date <= to) return 0;
  return Math.min(daysBetween(date, from), daysBetween(date, to));
}

function detectTravelDestination(question: string): "Europa" | "Ruta 66" | undefined {
  if (/\b(europa|europe|amsterdam|bruselas|brussels|praga|prague)\b/.test(question)) return "Europa";
  if (/\bruta\s*66\b/.test(question)) return "Ruta 66";
  return undefined;
}

function isTravelQuestion(question: string): boolean {
  return /\b(viaje|viajes|travel|europa|europe|ruta\s*66)\b/.test(question);
}

function isIncomeQuestion(question: string): boolean {
  return /\b(salario|salarios|sueldo|sueldos|salary|nomina|ingreso|ingresos|cobre|cobro)\b/.test(question);
}

function isProductQuestion(question: string, state: AppState, lookups: Lookups): boolean {
  if (/\b(producto|productos|ticket|tickets|factura|facturas|precio|pollo|papas)\b/.test(question)) return true;
  return Boolean(detectProductTerm(question, getProductRecords(state, lookups)));
}

function isSavingsQuestion(question: string): boolean {
  if (/\b(?:descuento|descuentos|promo|promocion|promoción|itau|itaú)\b/.test(question)) return true;
  return /\bahorr/.test(question) && /\b(?:compra|compras|comprando|molienda|ticket|tickets)\b/.test(question);
}

function isMonthSummaryQuestion(question: string): boolean {
  return /\b(resumen|balance|neto|gaste|gasto|gastos|mes|categoria|categorias|supermercado)\b/.test(question);
}

function isSalaryTransaction(transaction: Transaction, lookups: Lookups): boolean {
  const text = transactionSearchText(transaction, lookups);
  return /\b(salary|salario|sueldo|nomina)\b/.test(text);
}

function isTravelTransaction(transaction: Transaction, lookups: Lookups): boolean {
  const categoryText = transactionCategoryText(transaction, lookups);
  const text = transactionSearchText(transaction, lookups);
  return /\b(travel|viaje|viajes)\b/.test(categoryText) || /\b(ruta\s*66)\b/.test(text);
}

function isEuropeTravelTransaction(transaction: Transaction, lookups: Lookups): boolean {
  const text = transactionSearchText(transaction, lookups);
  if (/\b(europa|europe)\b/.test(text)) return true;
  return isTravelTransaction(transaction, lookups) && europePlacePattern.test(text);
}

function extractTripLabel(transaction: Transaction, lookups: Lookups): string | undefined {
  const tagLabel = transaction.splits
    .flatMap((split) => split.tagIds)
    .map((tagId) => lookups.tags.get(tagId)?.name)
    .find((name) => name && /\b(europa|europe|ruta\s*66|viaje|travel)\b/i.test(name));
  if (tagLabel) return tagLabel;

  const noteLabel = transaction.note.match(/labels?:\s*([^·.\n\r]+)/i)?.[1];
  const label = noteLabel
    ?.split(/[;,]/)
    .map((item) => item.trim())
    .find((item) => /\b(europa|europe|ruta\s*66|viaje|travel)\b/i.test(item));
  if (label) return label;

  if (/\beuropa\s+20\d{2}\b/i.test(transaction.payee)) return transaction.payee.trim();
  if (/\bruta\s*66\b/i.test(transaction.payee)) return "Ruta 66";
  return undefined;
}

function getProductRecords(state: AppState, lookups?: Lookups): ProductRecord[] {
  const localLookups = lookups ?? createLookups(state);
  return state.transactions
    .filter((transaction) => transaction.status === "confirmed")
    .flatMap((transaction) =>
      (transaction.lineItems ?? []).map((item) => ({
        transaction,
        item: {
          ...item,
          amountUyu: item.amountUyu || convertLineItemAmount(transaction, getReceiptLineItemTotal(item)),
          categoryId: item.categoryId ?? transaction.splits[0]?.categoryId
        }
      }))
    )
    .filter((record) => record.item.description.trim() && transactionSearchText(record.transaction, localLookups));
}

function getSavingsRecords(state: AppState, source?: string): SavingsRecord[] {
  const normalizedSource = source ? normalizeLookupKey(source) : "";
  return getProductRecords(state)
    .map((record) => {
      const discountUyu = convertLineItemAmount(record.transaction, getReceiptLineItemDiscount(record.item));
      return { ...record, discountUyu };
    })
    .filter((record) => {
      if (record.discountUyu <= 0) return false;
      if (!normalizedSource) return true;
      return normalizeLookupKey(record.item.discountSource ?? "").includes(normalizedSource);
    });
}

function convertLineItemAmount(transaction: Transaction, amount: number): number {
  return normalizeMoney(amount * (transaction.currency === "USD" ? transaction.fxRateToUyu : 1));
}

function formatProductRowMeta(record: ProductRecord, lookups: Lookups): string {
  const quantity = Number(record.item.quantity ?? 1);
  const shippingUyu = convertLineItemAmount(record.transaction, getReceiptLineItemShipping(record.item));
  const parts = [record.transaction.payee || accountName(record.transaction, lookups)];
  if (quantity > 0) parts.push(`${formatQuantity(quantity)} un.`);
  if (shippingUyu > 0) parts.push(`envío ${formatMoney(shippingUyu, "UYU")}`);
  return parts.join(" · ");
}

function detectProductTerm(question: string, records: ProductRecord[]): string | undefined {
  const tokens = question
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3 && !stopwords.has(token));

  return tokens.find((token) => records.some((record) => matchesProductDescription(record.item.description, token)));
}

function getExpenseCategoryRows(transactions: Transaction[], lookups: Lookups) {
  const rows = new Map<string, { name: string; amountUyu: number; count: number }>();

  transactions.forEach((transaction) => {
    if (transaction.type !== "expense") return;
    transaction.splits.forEach((split) => {
      const category = lookups.categories.get(split.categoryId);
      const name = category?.name ?? "Sin categoria";
      const current = rows.get(split.categoryId) ?? { name, amountUyu: 0, count: 0 };
      current.amountUyu = normalizeMoney(current.amountUyu + getSplitAmountUyu(split, transaction));
      current.count += 1;
      rows.set(split.categoryId, current);
    });
  });

  return Array.from(rows.values()).sort((a, b) => b.amountUyu - a.amountUyu);
}

function buildTransactionRows(transactions: Transaction[], lookups: Lookups, tone: AgentEvidenceRow["tone"]): AgentEvidenceRow[] {
  return [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((transaction) => ({
      date: formatDate(transaction.date),
      title: transaction.payee || formatTransactionKind(transaction),
      meta: `${accountName(transaction, lookups)} · ${categoryName(transaction, lookups)}`,
      amount: formatMoney(transaction.amount, transaction.currency),
      tone: transaction.type === "income" ? "good" : tone
    }));
}

function formatCurrencyBreakdown(transactions: Transaction[]): string {
  const totals = transactions.reduce(
    (current, transaction) => {
      current[transaction.currency] = normalizeMoney(current[transaction.currency] + signedOriginalAmount(transaction));
      return current;
    },
    { UYU: 0, USD: 0 } satisfies Record<Currency, number>
  );
  const parts = (Object.keys(totals) as Currency[])
    .filter((currency) => Math.abs(totals[currency]) > 0.001)
    .map((currency) => formatMoney(totals[currency], currency));
  return parts.length ? parts.join(" + ") : formatMoney(0, "UYU");
}

function formatOriginalTotals(totals: Record<Currency, number>): string {
  const parts = (Object.keys(totals) as Currency[])
    .filter((currency) => Math.abs(totals[currency]) > 0.001)
    .map((currency) => formatMoney(totals[currency], currency));
  return parts.length ? parts.join(" + ") : formatMoney(0, "UYU");
}

function sumTransactionUyu(transactions: Transaction[]): number {
  return normalizeMoney(transactions.reduce((total, transaction) => total + signedAmountUyu(transaction), 0));
}

function signedAmountUyu(transaction: Transaction): number {
  return transaction.type === "refund" ? -transaction.amountUyu : transaction.amountUyu;
}

function signedOriginalAmount(transaction: Transaction): number {
  return transaction.type === "refund" ? -transaction.amount : transaction.amount;
}

function createLookups(state: AppState): Lookups {
  return {
    accounts: new Map(state.accounts.map((account) => [account.id, account])),
    categories: new Map(state.categories.map((category) => [category.id, category])),
    tags: new Map(state.tags.map((tag) => [tag.id, tag]))
  };
}

function transactionSearchText(transaction: Transaction, lookups: Lookups): string {
  const tagNames = transaction.splits
    .flatMap((split) => split.tagIds)
    .map((tagId) => lookups.tags.get(tagId)?.name)
    .filter(Boolean);
  const lineItems = (transaction.lineItems ?? []).map((item) => item.description);
  return normalizeLookupKey(
    [transaction.payee, transaction.note, transactionCategoryText(transaction, lookups), ...tagNames, ...lineItems].join(" ")
  );
}

function transactionCategoryText(transaction: Transaction, lookups: Lookups): string {
  return normalizeLookupKey(
    transaction.splits
      .map((split) => lookups.categories.get(split.categoryId)?.name)
      .filter(Boolean)
      .join(" ")
  );
}

function categoryName(transaction: Transaction, lookups: Lookups): string {
  return lookups.categories.get(transaction.splits[0]?.categoryId)?.name ?? "Sin categoria";
}

function accountName(transaction: Transaction, lookups: Lookups): string {
  return lookups.accounts.get(transaction.accountId)?.name ?? "Sin cuenta";
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1, 12));
  return date.toISOString().slice(0, 7);
}

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${monthNames[monthNumber - 1]} ${year}`;
}

function formatDate(dateIso: string): string {
  const [year, month, day] = dateIso.split("-");
  return `${day}/${month}/${year}`;
}

function formatMoney(amount: number, currency: Currency): string {
  return moneyFormatters[currency].format(normalizeMoney(amount));
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("es-UY", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatTransactionKind(transaction: Transaction): string {
  if (transaction.type === "expense") return "Gasto";
  if (transaction.type === "income") return "Ingreso";
  if (transaction.type === "refund") return "Reembolso";
  if (transaction.type === "transfer") return "Transferencia";
  return "Ajuste";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

function daysBetween(firstDate: string, secondDate: string): number {
  const first = Date.parse(`${firstDate}T12:00:00Z`);
  const second = Date.parse(`${secondDate}T12:00:00Z`);
  return Math.abs(Math.round((second - first) / 86_400_000));
}

function normalizeLookupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesProductDescription(description: string, product: string): boolean {
  const text = normalizeLookupKey(description);
  const terms = expandProductTerms(product);
  if (terms.some((term) => matchesTerm(text, term))) return true;
  const queryTokens = tokenizeLookup(product).filter((token) => token.length >= 4);
  const textTokens = new Set(tokenizeLookup(description).filter((token) => token.length >= 4));
  return queryTokens.some((token) => textTokens.has(token));
}

function expandProductTerms(product: string): string[] {
  const tokens = tokenizeLookup(product);
  const terms = new Set(tokens);
  productSynonymGroups.forEach((group) => {
    const normalized = group.map((term) => normalizeLookupKey(term));
    if (normalized.some((term) => tokens.includes(term))) {
      normalized.forEach((term) => terms.add(term));
    }
  });
  return Array.from(terms).filter((term) => term.length >= 3);
}

function matchesTerm(text: string, term: string): boolean {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`).test(text)) return true;
  return term.length >= 5 && text.includes(term);
}

function tokenizeLookup(value: string): string[] {
  return normalizeLookupKey(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
