const TIMEZONE = "America/Montevideo";
const MAX_QUERY_LIMIT = 100;
const MAX_GROUP_LIMIT = 60;
const MAX_REFERENCE_LIMIT = 12;
const MAX_CHART_POINTS = 24;

const chartPalette = ["#2b6cb0", "#2f855a", "#e76f51", "#7c3aed", "#0f766e", "#c2410c", "#5b6c7d", "#b45309"];

const typeColors = {
  expense: "#e76f51",
  income: "#2f855a",
  transfer: "#2b6cb0",
  adjustment: "#7c3aed",
  refund: "#0f766e"
};

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

const europePlacePattern =
  /\b(europa|europe|amsterdam|bruselas|brussels|praga|prague|paris|madrid|barcelona|roma|rome|lisboa|lisbon|londres|london|italia|italy|francia|france|espana|spain|alemania|germany|holanda|netherlands|belgica|belgium|portugal)\b/;

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

export const financeToolDefinitions = [
  {
    type: "function",
    name: "get_finance_schema",
    description:
      "Return available accounts, categories, tags, date range, and useful hints for querying Bruno's finance data.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "query_transactions",
    description:
      "Return matching transactions. Use this for evidence rows after aggregating, or when the user asks for movement details.",
    parameters: {
      type: "object",
      properties: {
        filters: { $ref: "#/$defs/transactionFilters" },
        limit: { type: "number", description: "Maximum rows, capped at 100." },
        sort: { type: "string", enum: ["date_desc", "date_asc", "amount_desc"] }
      },
      $defs: {
        transactionFilters: transactionFiltersSchema()
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "aggregate_transactions",
    description:
      "Aggregate matching transactions by month, category, account, payee, tag, currency, or type. Use this for totals, salaries by year, expenses by category, and income summaries.",
    parameters: {
      type: "object",
      properties: {
        filters: { $ref: "#/$defs/transactionFilters" },
        groupBy: {
          type: "string",
          enum: ["month", "category", "account", "payee", "tag", "currency", "type", "none"]
        },
        limit: { type: "number", description: "Maximum groups, capped at 60." },
        sort: { type: "string", enum: ["key_asc", "key_desc", "amount_desc"] },
        includeSamples: { type: "boolean" }
      },
      $defs: {
        transactionFilters: transactionFiltersSchema()
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "build_transaction_chart",
    description:
      "Build chart-ready data from Bruno's finance transactions. Use this when the user asks to graph, chart, plot, visualize, compare visually, see trends/evolution, bars, lines, or pie charts.",
    parameters: {
      type: "object",
      properties: {
        filters: { $ref: "#/$defs/transactionFilters" },
        groupBy: {
          type: "string",
          enum: ["month", "category", "account", "payee", "tag", "currency", "type"]
        },
        chartType: { type: "string", enum: ["bar", "line", "pie"] },
        metric: { type: "string", enum: ["totalUyu", "count", "averageUyu"] },
        title: { type: "string", description: "Short chart title in Spanish." },
        limit: { type: "number", description: "Maximum chart points, capped at 24." },
        sort: { type: "string", enum: ["key_asc", "key_desc", "amount_desc"] }
      },
      $defs: {
        transactionFilters: transactionFiltersSchema()
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "find_trip_groups",
    description:
      "Find travel expense groups. Prefer this for questions about trips, destinations, Europa 2026, Ruta 66, or latest travel.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Destination or trip label, e.g. Europa, Ruta 66, Amsterdam." },
        startDate: { type: "string", description: "YYYY-MM-DD inclusive." },
        endDate: { type: "string", description: "YYYY-MM-DD inclusive." },
        latestOnly: { type: "boolean" },
        limit: { type: "number", description: "Maximum trip groups." }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "compare_products",
    description:
      "Analyze receipt line items by product/merchant, including units, allocated shipping and item discounts/savings. Use this for questions about products, prices, discounts, savings or whether chicken/pollo is more expensive than before.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product search text, e.g. pollo, papas." },
        merchant: { type: "string", description: "Optional merchant/local search text." },
        discountSource: { type: "string", description: "Optional discount source search text, e.g. Itau." },
        startDate: { type: "string", description: "YYYY-MM-DD inclusive." },
        endDate: { type: "string", description: "YYYY-MM-DD inclusive." },
        limit: { type: "number", description: "Maximum rows, capped at 100." }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "find_referenced_transaction",
    description:
      "Find a transaction mentioned earlier in the conversation by amount plus contextual words such as trip, merchant, category, or account. Use for follow-ups like 'ese gasto', 'el de 489,48', or 'ya te dije'.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "The amount the user mentioned, e.g. 489.48." },
        context: { type: "string", description: "Relevant words from the conversation, e.g. ruta 66, europa, itau." },
        currency: { type: "string", enum: ["UYU", "USD"] },
        limit: { type: "number", description: "Maximum rows, capped at 12." }
      },
      additionalProperties: false
    }
  }
];

export function createFinanceToolExecutor(state, nowIso = todayIso()) {
  const lookups = createLookups(state);

  return function executeFinanceTool(name, args = {}) {
    if (name === "get_finance_schema") return getFinanceSchema(state, lookups, nowIso);
    if (name === "query_transactions") return queryTransactions(state, lookups, args);
    if (name === "aggregate_transactions") return aggregateTransactions(state, lookups, args);
    if (name === "build_transaction_chart") return buildTransactionChart(state, lookups, args);
    if (name === "find_trip_groups") return findTripGroups(state, lookups, args);
    if (name === "compare_products") return compareProducts(state, lookups, args);
    if (name === "find_referenced_transaction") return findReferencedTransaction(state, lookups, args);
    return { error: `Unknown tool: ${name}` };
  };
}

export function getFinanceSchema(state, lookups = createLookups(state), nowIso = todayIso()) {
  const confirmedTransactions = state.transactions.filter((transaction) => transaction.status === "confirmed");
  const sortedDates = confirmedTransactions.map((transaction) => transaction.date).sort();
  const countByNeedle = (needle) =>
    confirmedTransactions.filter((transaction) => transactionSearchText(transaction, lookups).includes(needle)).length;

  return {
    nowIso,
    timezone: TIMEZONE,
    dateRange: {
      from: sortedDates[0] ?? nowIso,
      to: sortedDates[sortedDates.length - 1] ?? nowIso
    },
    counts: {
      accounts: state.accounts.length,
      categories: state.categories.length,
      tags: state.tags.length,
      transactions: confirmedTransactions.length,
      salaryLikeTransactions: countByNeedle("salary"),
      travelLikeTransactions: countByNeedle("travel"),
      receiptLineItems: state.transactions.reduce((count, transaction) => count + (transaction.lineItems?.length ?? 0), 0)
    },
    accounts: state.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      institution: account.institution,
      currency: account.currency,
      active: account.active
    })),
    categories: state.categories.map((category) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId ?? null
    })),
    tags: state.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    queryHints: {
      salary: "For salaries, filter type=income and salary=true, or category/search Salary.",
      currentYear: `For 'este año', use ${nowIso.slice(0, 4)}-01-01 through ${nowIso}.`,
      month: "Use YYYY-MM for month filters and YYYY-MM-DD for exact dates.",
      evidence: "After an aggregate, query a small set of matching transactions for evidence rows."
    }
  };
}

export function queryTransactions(state, lookups = createLookups(state), args = {}) {
  const limit = clampLimit(args.limit, MAX_QUERY_LIMIT);
  const transactions = filterTransactions(state, lookups, args.filters ?? {});
  const sorted = sortTransactions(transactions, args.sort ?? "date_desc");

  return {
    filtersApplied: normalizeFilters(args.filters ?? {}),
    count: transactions.length,
    returned: Math.min(limit, transactions.length),
    rows: sorted.slice(0, limit).map((transaction) => serializeTransaction(transaction, lookups))
  };
}

export function aggregateTransactions(state, lookups = createLookups(state), args = {}) {
  const groupBy = args.groupBy ?? "none";
  const limit = clampLimit(args.limit, MAX_GROUP_LIMIT);
  const transactions = filterTransactions(state, lookups, args.filters ?? {});
  const groups = new Map();

  transactions.forEach((transaction) => {
    const items = getGroupItems(transaction, lookups, groupBy);
    items.forEach(({ key, label, amountUyu, originalAmount }) => {
      const current = groups.get(key) ?? {
        key,
        label,
        count: 0,
        totalUyu: 0,
        originalTotals: { UYU: 0, USD: 0 },
        samples: []
      };
      current.count += 1;
      current.totalUyu = normalizeMoney(current.totalUyu + amountUyu);
      current.originalTotals[transaction.currency] = normalizeMoney(
        current.originalTotals[transaction.currency] + originalAmount
      );
      if (current.samples.length < 5) current.samples.push(serializeTransaction(transaction, lookups));
      groups.set(key, current);
    });
  });

  const rows = sortGroups(Array.from(groups.values()), args.sort ?? defaultGroupSort(groupBy))
    .slice(0, limit)
    .map((group) => ({
      ...group,
      totalUyuFormatted: formatMoney(group.totalUyu, "UYU"),
      originalTotalsFormatted: formatCurrencyBreakdown(group.originalTotals),
      samples: args.includeSamples ? group.samples : undefined
    }));

  const originalTotals = totalOriginals(transactions);
  const totalUyu = normalizeMoney(transactions.reduce((total, transaction) => total + analysisAmountUyu(transaction), 0));

  return {
    filtersApplied: normalizeFilters(args.filters ?? {}),
    groupBy,
    count: transactions.length,
    totalUyu,
    totalUyuFormatted: formatMoney(totalUyu, "UYU"),
    originalTotals,
    originalTotalsFormatted: formatCurrencyBreakdown(originalTotals),
    returnedGroups: rows.length,
    groups: rows
  };
}

export function buildTransactionChart(state, lookups = createLookups(state), args = {}) {
  const groupBy = normalizeChartGroupBy(args.groupBy);
  const metric = normalizeChartMetric(args.metric);
  const chartType = normalizeChartType(args.chartType, groupBy);
  const sort = args.sort ?? (groupBy === "month" ? "key_asc" : "amount_desc");
  const aggregate = aggregateTransactions(state, lookups, {
    filters: args.filters ?? {},
    groupBy,
    limit: clampLimit(args.limit, MAX_CHART_POINTS),
    sort,
    includeSamples: false
  });
  const points = aggregate.groups.map((group, index) => {
    const value = chartValueForMetric(group, metric);
    return {
      key: group.key,
      label: group.label,
      value,
      valueFormatted: metric === "count" ? String(value) : formatMoney(value, "UYU"),
      color: colorForGroup(groupBy, group.key, lookups, index),
      meta: pluralize(group.count, "movimiento")
    };
  });

  return {
    filtersApplied: aggregate.filtersApplied,
    groupBy,
    chartType,
    metric,
    count: aggregate.count,
    totalUyu: aggregate.totalUyu,
    totalUyuFormatted: aggregate.totalUyuFormatted,
    returnedPoints: points.length,
    chart: {
      type: chartType,
      title: cleanChartTitle(args.title) || defaultChartTitle(aggregate.filtersApplied, groupBy, metric),
      subtitle: `${dateRangeLabel(aggregate.filtersApplied)} · ${pluralize(aggregate.count, "movimiento")}`,
      valueLabel: metricLabel(metric),
      totalFormatted: metric === "count" ? String(aggregate.count) : aggregate.totalUyuFormatted,
      points
    }
  };
}

export function findTripGroups(state, lookups = createLookups(state), args = {}) {
  const destination = normalizeLookupKey(args.destination ?? "");
  const transactions = filterTransactions(state, lookups, {
    startDate: args.startDate,
    endDate: args.endDate,
    type: "expense",
    travel: true
  }).filter((transaction) => {
    if (!destination) return true;
    const text = transactionSearchText(transaction, lookups);
    if (destination.includes("europa") || destination.includes("europe")) return isEuropeTravelTransaction(transaction, lookups);
    return text.includes(destination);
  });

  const trips = buildTravelTrips(transactions, lookups)
    .map((trip) => {
      const originals = totalOriginals(trip.transactions);
      const totalUyu = normalizeMoney(trip.transactions.reduce((total, transaction) => total + analysisAmountUyu(transaction), 0));
      return {
        label: trip.label,
        from: trip.from,
        to: trip.to,
        explicitLabel: trip.explicitLabel,
        count: trip.transactions.length,
        totalUyu,
        totalUyuFormatted: formatMoney(totalUyu, "UYU"),
        originalTotals: originals,
        originalTotalsFormatted: formatCurrencyBreakdown(originals),
        topRows: sortTransactions(trip.transactions, "amount_desc").slice(0, 8).map((transaction) => serializeTransaction(transaction, lookups))
      };
    })
    .sort((a, b) => b.to.localeCompare(a.to));

  return {
    destination: args.destination ?? null,
    count: trips.length,
    trips: (args.latestOnly ? trips.slice(0, 1) : trips.slice(0, clampLimit(args.limit, 20)))
  };
}

export function compareProducts(state, lookups = createLookups(state), args = {}) {
  const product = normalizeLookupKey(args.product ?? "");
  const merchant = normalizeLookupKey(args.merchant ?? "");
  const discountSource = normalizeLookupKey(args.discountSource ?? "");
  const records = state.transactions
    .filter((transaction) => transaction.status === "confirmed")
    .filter((transaction) => isWithinDateRange(transaction.date, args.startDate, args.endDate))
    .flatMap((transaction) =>
      (transaction.lineItems ?? []).map((item) => ({
        transaction,
        item: {
          ...item,
          amountUyu: lineItemAmountUyu(transaction, item)
        }
      }))
    )
    .filter((record) => {
      const itemText = normalizeLookupKey(record.item.description);
      const merchantText = normalizeLookupKey(record.transaction.payee);
      const itemDiscountSource = normalizeLookupKey(record.item.discountSource ?? "");
      return (
        (!product || matchesProduct(itemText, product)) &&
        (!merchant || merchantText.includes(merchant)) &&
        (!discountSource || itemDiscountSource.includes(discountSource))
      );
    })
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));

  const limit = clampLimit(args.limit, MAX_QUERY_LIMIT);
  const totalUyu = normalizeMoney(records.reduce((total, record) => total + record.item.amountUyu, 0));
  const totalDiscountUyu = normalizeMoney(records.reduce((total, record) => total + lineItemDiscountUyu(record.transaction, record.item), 0));
  const totalShippingUyu = normalizeMoney(records.reduce((total, record) => total + lineItemShippingUyu(record.transaction, record.item), 0));
  const totalQuantity = normalizeMoney(records.reduce((total, record) => total + Number(record.item.quantity ?? 1), 0));
  const amounts = records.map((record) => record.item.amountUyu).sort((a, b) => a - b);
  const byMerchant = aggregateRecords(records, (record) => record.transaction.payee || "Sin comercio");
  const rows = records.slice(0, limit).map((record) => ({
    date: record.transaction.date,
    merchant: record.transaction.payee,
    description: record.item.description,
    quantity: record.item.quantity ?? 1,
    unitPrice: record.item.unitPrice ?? null,
    unitPriceUyu: lineItemUnitPriceUyu(record.transaction, record.item),
    unitPriceFormatted: formatUnitPrice(record.item.unitPrice, record.transaction.currency),
    unitPriceUyuFormatted: formatMoney(lineItemUnitPriceUyu(record.transaction, record.item), "UYU"),
    originalAmount: record.item.originalAmount ?? null,
    discountAmount: getLineItemDiscount(record.item),
    discountSource: record.item.discountSource ?? null,
    shippingAmount: getLineItemShipping(record.item),
    totalAmount: getLineItemTotal(record.item),
    amount: record.item.amount,
    amountUyu: record.item.amountUyu,
    amountFormatted: formatMoney(record.item.amount, record.transaction.currency),
    amountUyuFormatted: formatMoney(record.item.amountUyu, "UYU"),
    discountUyuFormatted: formatMoney(lineItemDiscountUyu(record.transaction, record.item), "UYU"),
    shippingUyuFormatted: formatMoney(lineItemShippingUyu(record.transaction, record.item), "UYU"),
    transactionId: record.transaction.id
  }));

  return {
    filtersApplied: {
      product: args.product ?? null,
      merchant: args.merchant ?? null,
      discountSource: args.discountSource ?? null,
      startDate: args.startDate ?? null,
      endDate: args.endDate ?? null
    },
    count: records.length,
    totalQuantity,
    totalUyu,
    totalUyuFormatted: formatMoney(totalUyu, "UYU"),
    totalDiscountUyu,
    totalDiscountUyuFormatted: formatMoney(totalDiscountUyu, "UYU"),
    totalShippingUyu,
    totalShippingUyuFormatted: formatMoney(totalShippingUyu, "UYU"),
    averageUyu: records.length ? normalizeMoney(totalUyu / records.length) : 0,
    averageUyuFormatted: records.length ? formatMoney(totalUyu / records.length, "UYU") : formatMoney(0, "UYU"),
    minUyu: amounts[0] ?? 0,
    maxUyu: amounts[amounts.length - 1] ?? 0,
    byMerchant,
    unitPriceComparison: buildUnitPriceComparison(rows),
    rows
  };
}

export function findReferencedTransaction(state, lookups = createLookups(state), args = {}) {
  const amount = Number(args.amount);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const contextTerms = normalizeLookupKey(args.context ?? "")
    .split(/\s+/)
    .filter((term) => term.length > 2);
  const currency = args.currency === "USD" || args.currency === "UYU" ? args.currency : undefined;
  const limit = clampLimit(args.limit, MAX_REFERENCE_LIMIT);

  const scored = state.transactions
    .filter((transaction) => transaction.status === "confirmed")
    .filter((transaction) => !currency || transaction.currency === currency)
    .map((transaction) => {
      const text = transactionSearchText(transaction, lookups);
      const amountDistance = hasAmount ? Math.min(Math.abs(transaction.amount - amount), Math.abs(transaction.amountUyu - amount)) : 0;
      const amountScore = !hasAmount ? 8 : amountDistance <= 0.05 ? 80 : amountDistance <= 1 ? 54 : amountDistance <= 10 ? 22 : 0;
      const contextScore = contextTerms.reduce((score, term) => score + (text.includes(term) ? 12 : 0), 0);
      const typeScore = transaction.type === "expense" || transaction.type === "refund" ? 8 : 0;
      return { transaction, score: amountScore + contextScore + typeScore, amountDistance };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.amountDistance - b.amountDistance || b.transaction.date.localeCompare(a.transaction.date))
    .slice(0, limit);

  return {
    filtersApplied: {
      amount: hasAmount ? amount : null,
      context: args.context ?? "",
      currency: currency ?? null
    },
    count: scored.length,
    rows: scored.map((item) => ({
      score: item.score,
      amountDistance: normalizeMoney(item.amountDistance),
      ...serializeTransaction(item.transaction, lookups)
    }))
  };
}

function transactionFiltersSchema() {
  return {
    type: "object",
    properties: {
      startDate: { type: "string", description: "YYYY-MM-DD inclusive." },
      endDate: { type: "string", description: "YYYY-MM-DD inclusive." },
      month: { type: "string", description: "YYYY-MM." },
      year: { type: "number", description: "Four digit year." },
      type: { type: "string", enum: ["expense", "income", "transfer", "adjustment", "refund"] },
      currency: { type: "string", enum: ["UYU", "USD"] },
      amount: { type: "number", description: "Original transaction amount, e.g. 489.48." },
      amountUyu: { type: "number", description: "Transaction amount converted to UYU." },
      amountTolerance: { type: "number", description: "Allowed difference when matching amount or amountUyu. Defaults to 0.05." },
      account: { type: "string", description: "Account id or name text." },
      category: { type: "string", description: "Category id or name text." },
      tag: { type: "string", description: "Tag id or name text." },
      search: { type: "string", description: "Free text searched in merchant, notes, categories, tags and receipt items." },
      salary: { type: "boolean", description: "True for salary/sueldo income." },
      travel: { type: "boolean", description: "True for travel/viaje expense movements." },
      includeTransfers: { type: "boolean", description: "Include transfer rows when type is not explicitly transfer." }
    },
    additionalProperties: false
  };
}

function filterTransactions(state, lookups, filters = {}) {
  const normalized = normalizeFilters(filters);
  return state.transactions.filter((transaction) => {
    if (transaction.status !== "confirmed") return false;
    if (!normalized.includeTransfers && !normalized.type && transaction.type === "transfer") return false;
    if (normalized.type && transaction.type !== normalized.type) return false;
    if (normalized.currency && transaction.currency !== normalized.currency) return false;
    if (Number.isFinite(normalized.amount) && Math.abs(transaction.amount - normalized.amount) > normalized.amountTolerance) return false;
    if (Number.isFinite(normalized.amountUyu) && Math.abs(transaction.amountUyu - normalized.amountUyu) > normalized.amountTolerance) return false;
    if (!isWithinDateRange(transaction.date, normalized.startDate, normalized.endDate)) return false;
    if (normalized.account && !matchesAccount(transaction, lookups, normalized.account)) return false;
    if (normalized.category && !matchesCategory(transaction, lookups, normalized.category)) return false;
    if (normalized.tag && !matchesTag(transaction, lookups, normalized.tag)) return false;
    if (normalized.salary && !isSalaryTransaction(transaction, lookups)) return false;
    if (normalized.travel && !isTravelTransaction(transaction, lookups)) return false;
    if (normalized.search && !matchesSearch(transaction, lookups, normalized.search)) return false;
    return true;
  });
}

function normalizeFilters(filters = {}) {
  const normalized = { ...filters };
  if (normalized.month && !normalized.startDate && !normalized.endDate) {
    normalized.startDate = `${normalized.month}-01`;
    normalized.endDate = endOfMonth(normalized.month);
  }
  if (normalized.year && !normalized.startDate && !normalized.endDate) {
    const year = normalizeYear(normalized.year);
    if (year) {
      normalized.startDate = `${year}-01-01`;
      normalized.endDate = `${year}-12-31`;
    }
  }

  return {
    ...normalized,
    account: normalizeLookupKey(normalized.account ?? ""),
    category: normalizeLookupKey(normalized.category ?? ""),
    tag: normalizeLookupKey(normalized.tag ?? ""),
    search: normalizeLookupKey(normalized.search ?? ""),
    currency: normalized.salary && normalized.currency === "UYU" ? undefined : normalized.currency,
    year: normalizeYear(normalized.year),
    amount: positiveNumberOrUndefined(normalized.amount),
    amountUyu: positiveNumberOrUndefined(normalized.amountUyu),
    amountTolerance: numberOrUndefined(normalized.amountTolerance) ?? 0.05
  };
}

function getGroupItems(transaction, lookups, groupBy) {
  const defaultAmount = {
    amountUyu: analysisAmountUyu(transaction),
    originalAmount: analysisOriginalAmount(transaction)
  };

  if (groupBy === "month") {
    return [{ key: transaction.date.slice(0, 7), label: formatMonthLabel(transaction.date.slice(0, 7)), ...defaultAmount }];
  }
  if (groupBy === "category") {
    return transaction.splits.map((split) => {
      const category = lookups.categories.get(split.categoryId);
      return {
        key: split.categoryId,
        label: category?.name ?? "Sin categoria",
        amountUyu: splitAnalysisAmountUyu(split, transaction),
        originalAmount: splitAnalysisOriginalAmount(split, transaction)
      };
    });
  }

  if (groupBy === "account") {
    const account = lookups.accounts.get(transaction.accountId);
    return [{ key: transaction.accountId, label: account?.name ?? "Sin cuenta", ...defaultAmount }];
  }
  if (groupBy === "payee") {
    return [{ key: normalizeLookupKey(transaction.payee || "Sin comercio"), label: transaction.payee || "Sin comercio", ...defaultAmount }];
  }
  if (groupBy === "tag") {
    const tagIds = new Set(transaction.splits.flatMap((split) => split.tagIds));
    if (tagIds.size === 0) return [{ key: "sin_tag", label: "Sin tag", ...defaultAmount }];
    return Array.from(tagIds).map((tagId) => ({ key: tagId, label: lookups.tags.get(tagId)?.name ?? "Sin tag", ...defaultAmount }));
  }
  if (groupBy === "currency") return [{ key: transaction.currency, label: transaction.currency, ...defaultAmount }];
  if (groupBy === "type") return [{ key: transaction.type, label: transaction.type, ...defaultAmount }];
  return [{ key: "total", label: "Total", ...defaultAmount }];
}

function buildTravelTrips(transactions, lookups) {
  const byLabel = new Map();
  const unlabeled = [];

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
  const remainingUnlabeled = [];

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

function groupUnlabeledTrips(transactions) {
  const sorted = sortTransactions(transactions, "date_asc");
  const groups = [];

  sorted.forEach((transaction) => {
    const last = groups[groups.length - 1];
    if (!last || daysBetween(last.to, transaction.date) > 21) {
      groups.push({
        label: `Viaje ${formatMonthLabel(transaction.date.slice(0, 7))}`,
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

function extractTripLabel(transaction, lookups) {
  const tagLabel = transaction.splits
    .flatMap((split) => split.tagIds)
    .map((tagId) => lookups.tags.get(tagId)?.name)
    .find((name) => name && /\b(europa|europe|ruta\s*66|viaje|travel)\b/i.test(name));
  if (tagLabel) return tagLabel;

  const noteLabel = transaction.note?.match(/labels?:\s*([^·.\n\r]+)/i)?.[1];
  const label = noteLabel
    ?.split(/[;,]/)
    .map((item) => item.trim())
    .find((item) => /\b(europa|europe|ruta\s*66|viaje|travel)\b/i.test(item));
  if (label) return label;

  if (/\beuropa\s+20\d{2}\b/i.test(transaction.payee)) return transaction.payee.trim();
  if (/\bruta\s*66\b/i.test(transaction.payee)) return "Ruta 66";
  return undefined;
}

function findClosestTrip(transaction, trips) {
  return trips
    .map((trip) => ({ trip, distance: dateDistanceFromRange(transaction.date, trip.from, trip.to) }))
    .sort((a, b) => a.distance - b.distance)[0]?.trip;
}

function serializeTransaction(transaction, lookups) {
  const account = lookups.accounts.get(transaction.accountId);
  const category = lookups.categories.get(transaction.splits?.[0]?.categoryId);
  const tagNames = transaction.splits.flatMap((split) => split.tagIds).map((tagId) => lookups.tags.get(tagId)?.name).filter(Boolean);

  return {
    id: transaction.id,
    date: transaction.date,
    type: transaction.type,
    payee: transaction.payee,
    note: truncate(transaction.note ?? "", 220),
    account: account?.name ?? "Sin cuenta",
    accountId: transaction.accountId,
    category: category?.name ?? "Sin categoria",
    categoryId: category?.id ?? null,
    tags: Array.from(new Set(tagNames)),
    currency: transaction.currency,
    amount: transaction.amount,
    amountFormatted: formatMoney(transaction.amount, transaction.currency),
    amountUyu: transaction.amountUyu,
    amountUyuFormatted: formatMoney(transaction.amountUyu, "UYU"),
    fxRateToUyu: transaction.fxRateToUyu,
    lineItems: (transaction.lineItems ?? []).slice(0, 8).map((item) => ({
      description: item.description,
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice ?? null,
      originalAmount: item.originalAmount ?? null,
      discountAmount: getLineItemDiscount(item),
      discountSource: item.discountSource ?? null,
      shippingAmount: getLineItemShipping(item),
      totalAmount: getLineItemTotal(item),
      amount: item.amount,
      amountUyu: lineItemAmountUyu(transaction, item),
      amountUyuFormatted: formatMoney(lineItemAmountUyu(transaction, item), "UYU")
    }))
  };
}

function sortTransactions(transactions, sort) {
  return [...transactions].sort((a, b) => {
    if (sort === "date_asc") return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
    if (sort === "amount_desc") return Math.abs(analysisAmountUyu(b)) - Math.abs(analysisAmountUyu(a));
    return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
  });
}

function sortGroups(groups, sort) {
  return [...groups].sort((a, b) => {
    if (sort === "key_asc") return a.key.localeCompare(b.key);
    if (sort === "key_desc") return b.key.localeCompare(a.key);
    return Math.abs(b.totalUyu) - Math.abs(a.totalUyu);
  });
}

function defaultGroupSort(groupBy) {
  return groupBy === "month" ? "key_asc" : "amount_desc";
}

function normalizeChartGroupBy(value) {
  const allowed = ["month", "category", "account", "payee", "tag", "currency", "type"];
  return allowed.includes(value) ? value : "month";
}

function normalizeChartMetric(value) {
  const allowed = ["totalUyu", "count", "averageUyu"];
  return allowed.includes(value) ? value : "totalUyu";
}

function normalizeChartType(value, groupBy) {
  if (value === "bar" || value === "line" || value === "pie") return value;
  return groupBy === "month" ? "line" : "bar";
}

function chartValueForMetric(group, metric) {
  if (metric === "count") return group.count;
  if (metric === "averageUyu") return group.count ? normalizeMoney(group.totalUyu / group.count) : 0;
  return group.totalUyu;
}

function metricLabel(metric) {
  if (metric === "count") return "Cantidad";
  if (metric === "averageUyu") return "Promedio UYU";
  return "Total UYU";
}

function defaultChartTitle(filters, groupBy, metric) {
  const metricText = metric === "count" ? "Cantidad" : metric === "averageUyu" ? "Promedio" : "Total";
  const groupText = {
    month: "por mes",
    category: "por categoria",
    account: "por cuenta",
    payee: "por comercio",
    tag: "por tag",
    currency: "por moneda",
    type: "por tipo"
  }[groupBy];
  const typeText = filters.type ? `${transactionTypeLabel(filters.type)} ` : "";
  return `${metricText} de ${typeText}movimientos ${groupText}`;
}

function transactionTypeLabel(type) {
  if (type === "expense") return "gastos";
  if (type === "income") return "ingresos";
  if (type === "refund") return "reembolsos";
  if (type === "transfer") return "transferencias";
  if (type === "adjustment") return "ajustes";
  return "movimientos";
}

function dateRangeLabel(filters) {
  if (filters.month) return formatMonthLabel(filters.month);
  if (filters.year) return String(filters.year);
  if (filters.startDate && filters.endDate) return `${filters.startDate} a ${filters.endDate}`;
  if (filters.startDate) return `desde ${filters.startDate}`;
  if (filters.endDate) return `hasta ${filters.endDate}`;
  return "Todo el historial";
}

function cleanChartTitle(value) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  return title.slice(0, 80);
}

function colorForGroup(groupBy, key, lookups, index) {
  const lookupColor =
    groupBy === "category"
      ? lookups.categories.get(key)?.color
      : groupBy === "account"
        ? lookups.accounts.get(key)?.color
        : groupBy === "tag"
          ? lookups.tags.get(key)?.color
          : groupBy === "type"
            ? typeColors[key]
            : undefined;
  return isSafeCssColor(lookupColor) ? lookupColor : chartPalette[index % chartPalette.length];
}

function isSafeCssColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);
}

function pluralize(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function isWithinDateRange(date, startDate, endDate) {
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function matchesAccount(transaction, lookups, accountQuery) {
  const source = lookups.accounts.get(transaction.accountId);
  const destination = lookups.accounts.get(transaction.toAccountId);
  return [transaction.accountId, transaction.toAccountId, source?.name, source?.institution, destination?.name, destination?.institution]
    .filter(Boolean)
    .some((value) => normalizeLookupKey(value).includes(accountQuery));
}

function matchesCategory(transaction, lookups, categoryQuery) {
  return transaction.splits.some((split) => {
    const category = lookups.categories.get(split.categoryId);
    const categoryText = normalizeLookupKey([split.categoryId, category?.name].filter(Boolean).join(" "));
    return categoryText.includes(categoryQuery) || (isSalaryNeedle(categoryQuery) && categoryText.includes("salary"));
  });
}

function matchesTag(transaction, lookups, tagQuery) {
  return transaction.splits.some((split) =>
    split.tagIds.some((tagId) => [tagId, lookups.tags.get(tagId)?.name].filter(Boolean).some((value) => normalizeLookupKey(value).includes(tagQuery)))
  );
}

function isSalaryTransaction(transaction, lookups) {
  return transaction.type === "income" && /\b(salary|salario|sueldo|nomina)\b/.test(transactionSearchText(transaction, lookups));
}

function matchesSearch(transaction, lookups, searchQuery) {
  const text = transactionSearchText(transaction, lookups);
  if (text.includes(searchQuery)) return true;
  if (isSalaryNeedle(searchQuery)) return isSalaryTransaction(transaction, lookups);
  return false;
}

function isSalaryNeedle(value) {
  return /\b(salary|salario|salarios|sueldo|sueldos|nomina)\b/.test(value);
}

function isTravelTransaction(transaction, lookups) {
  const text = transactionSearchText(transaction, lookups);
  return /\b(travel|viaje|viajes|ruta\s*66)\b/.test(text) || isEuropeTravelTransaction(transaction, lookups);
}

function isEuropeTravelTransaction(transaction, lookups) {
  const text = transactionSearchText(transaction, lookups);
  if (/\b(europa|europe)\b/.test(text)) return true;
  return /\b(travel|viaje|viajes)\b/.test(text) && europePlacePattern.test(text);
}

function transactionSearchText(transaction, lookups) {
  const categoryNames = transaction.splits.map((split) => lookups.categories.get(split.categoryId)?.name).filter(Boolean);
  const tagNames = transaction.splits.flatMap((split) => split.tagIds).map((tagId) => lookups.tags.get(tagId)?.name).filter(Boolean);
  const lineItems = (transaction.lineItems ?? []).map((item) => item.description);
  return normalizeLookupKey([transaction.payee, transaction.note, ...categoryNames, ...tagNames, ...lineItems].join(" "));
}

function analysisAmountUyu(transaction) {
  if (transaction.type === "refund") return -transaction.amountUyu;
  return transaction.amountUyu;
}

function analysisOriginalAmount(transaction) {
  if (transaction.type === "refund") return -transaction.amount;
  return transaction.amount;
}

function splitAnalysisAmountUyu(split, transaction) {
  const sign = transaction.type === "refund" ? -1 : 1;
  if (Number.isFinite(split.amountUyu) && split.amountUyu !== 0) return normalizeMoney(sign * split.amountUyu);
  if (!transaction.amount) return normalizeMoney(sign * (split.amount ?? 0));
  return normalizeMoney(sign * ((split.amount ?? 0) / transaction.amount) * transaction.amountUyu);
}

function splitAnalysisOriginalAmount(split, transaction) {
  const sign = transaction.type === "refund" ? -1 : 1;
  return normalizeMoney(sign * (Number(split.amount) || 0));
}

function totalOriginals(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      totals[transaction.currency] = normalizeMoney(totals[transaction.currency] + analysisOriginalAmount(transaction));
      return totals;
    },
    { UYU: 0, USD: 0 }
  );
}

function aggregateRecords(records, keyForRecord) {
  const groups = new Map();
  records.forEach((record) => {
    const key = keyForRecord(record);
    const current = groups.get(key) ?? { label: key, count: 0, quantity: 0, totalUyu: 0, discountUyu: 0, shippingUyu: 0 };
    current.count += 1;
    current.quantity = normalizeMoney(current.quantity + Number(record.item.quantity ?? 1));
    current.totalUyu = normalizeMoney(current.totalUyu + record.item.amountUyu);
    current.discountUyu = normalizeMoney(current.discountUyu + lineItemDiscountUyu(record.transaction, record.item));
    current.shippingUyu = normalizeMoney(current.shippingUyu + lineItemShippingUyu(record.transaction, record.item));
    groups.set(key, current);
  });
  return Array.from(groups.values())
    .sort((a, b) => b.totalUyu - a.totalUyu)
    .slice(0, 12)
    .map((group) => ({
      ...group,
      totalUyuFormatted: formatMoney(group.totalUyu, "UYU"),
      discountUyuFormatted: formatMoney(group.discountUyu, "UYU"),
      shippingUyuFormatted: formatMoney(group.shippingUyu, "UYU")
    }));
}

function lineItemAmountUyu(transaction, item) {
  return item.amountUyu || normalizeMoney(getLineItemTotal(item) * transactionFxRate(transaction));
}

function lineItemDiscountUyu(transaction, item) {
  return normalizeMoney(getLineItemDiscount(item) * transactionFxRate(transaction));
}

function lineItemShippingUyu(transaction, item) {
  return normalizeMoney(getLineItemShipping(item) * transactionFxRate(transaction));
}

function transactionFxRate(transaction) {
  return transaction.currency === "USD" ? transaction.fxRateToUyu || 1 : 1;
}

function lineItemUnitPriceUyu(transaction, item) {
  const fx = transactionFxRate(transaction);
  if (Number(item.unitPrice) > 0) return normalizeMoney(Number(item.unitPrice) * fx);
  const quantity = Number(item.quantity);
  if (quantity > 0) return normalizeMoney(lineItemAmountUyu(transaction, item) / quantity);
  return 0;
}

function formatUnitPrice(unitPrice, currency) {
  const value = Number(unitPrice);
  return value > 0 ? formatMoney(value, currency) : null;
}

function buildUnitPriceComparison(rows) {
  const comparable = rows
    .map((row) => ({
      ...row,
      unitPriceUyu: Number(row.unitPriceUyu) || 0
    }))
    .filter((row) => row.unitPriceUyu > 0);
  if (comparable.length === 0) return null;

  const sorted = [...comparable].sort((a, b) => a.unitPriceUyu - b.unitPriceUyu);
  const averageUyu = normalizeMoney(sorted.reduce((total, row) => total + row.unitPriceUyu, 0) / sorted.length);

  return {
    metric: "unitPriceUyu",
    note: "Precio por unidad (kilo/unidad) convertido a UYU. Un valor menor significa más barato.",
    count: sorted.length,
    minUyu: sorted[0].unitPriceUyu,
    minFormatted: formatMoney(sorted[0].unitPriceUyu, "UYU"),
    maxUyu: sorted[sorted.length - 1].unitPriceUyu,
    maxFormatted: formatMoney(sorted[sorted.length - 1].unitPriceUyu, "UYU"),
    averageUyu,
    averageFormatted: formatMoney(averageUyu, "UYU"),
    cheapest: pickUnitPriceExtreme(sorted[0]),
    priciest: pickUnitPriceExtreme(sorted[sorted.length - 1])
  };
}

function pickUnitPriceExtreme(row) {
  return {
    date: row.date,
    merchant: row.merchant,
    description: row.description,
    quantity: row.quantity,
    unitPriceUyu: row.unitPriceUyu,
    unitPriceFormatted: row.unitPriceFormatted,
    unitPriceUyuFormatted: row.unitPriceUyuFormatted
  };
}

function matchesProduct(description, product) {
  const text = normalizeLookupKey(description);
  const terms = expandProductTerms(product);
  if (terms.some((term) => matchesTerm(text, term))) return true;
  const queryTokens = tokenizeLookup(product).filter((token) => token.length >= 4);
  const textTokens = new Set(tokenizeLookup(description).filter((token) => token.length >= 4));
  return queryTokens.some((token) => textTokens.has(token));
}

function expandProductTerms(product) {
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

function matchesTerm(text, term) {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`).test(text)) return true;
  return term.length >= 5 && text.includes(term);
}

function tokenizeLookup(value) {
  return normalizeLookupKey(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function getLineItemAmount(item) {
  return normalizeMoney(Math.abs(Number(item.amount) || 0));
}

function getLineItemShipping(item) {
  return normalizeMoney(Math.max(0, Number(item.shippingAmount) || 0));
}

function getLineItemTotal(item) {
  return normalizeMoney(getLineItemAmount(item) + getLineItemShipping(item));
}

function getLineItemDiscount(item) {
  return normalizeMoney(Math.max(0, Number(item.discountAmount) || 0));
}

function formatCurrencyBreakdown(totals) {
  return Object.entries(totals)
    .filter(([, amount]) => Math.abs(amount) > 0.001)
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" + ") || formatMoney(0, "UYU");
}

function createLookups(state) {
  return {
    accounts: new Map(state.accounts.map((account) => [account.id, account])),
    categories: new Map(state.categories.map((category) => [category.id, category])),
    tags: new Map(state.tags.map((tag) => [tag.id, tag]))
  };
}

function normalizeMoney(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalizeMoney(amount));
}

function formatMonthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${monthNames[monthNumber - 1]} ${year}`;
}

function endOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10);
}

function daysBetween(firstDate, secondDate) {
  const first = Date.parse(`${firstDate}T12:00:00Z`);
  const second = Date.parse(`${secondDate}T12:00:00Z`);
  return Math.abs(Math.round((second - first) / 86_400_000));
}

function dateDistanceFromRange(date, from, to) {
  if (date >= from && date <= to) return 0;
  return Math.min(daysBetween(date, from), daysBetween(date, to));
}

function clampLimit(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return Math.min(20, max);
  return Math.min(Math.floor(number), max);
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : undefined;
}

function truncate(value, length) {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeLookupKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
