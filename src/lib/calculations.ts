import type {
  Account,
  AppState,
  Budget,
  Category,
  Currency,
  Transaction,
  TransactionSplit
} from "../types";
import { enumerateMonths, monthKey } from "./date";

export interface AccountBalance {
  account: Account;
  balance: number;
  balanceUyu: number;
  lastMovement?: Transaction;
}

export interface BudgetUsage {
  budget: Budget;
  category: Category;
  spentUyu: number;
  allowanceUyu: number;
  remainingUyu: number;
  percent: number;
  state: "ok" | "near" | "over";
  mode: Budget["mode"];
}

export interface MonthSummary {
  incomeUyu: number;
  expenseUyu: number;
  refundUyu: number;
  netUyu: number;
}

export function normalizeMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function toUyu(amount: number, currency: Currency, fxRateToUyu?: number): number {
  if (currency === "UYU") return normalizeMoney(amount);
  return normalizeMoney(amount * (fxRateToUyu && fxRateToUyu > 0 ? fxRateToUyu : 1));
}

export function convertAmount(amount: number, from: Currency, to: Currency, fxRateToUyu: number): number {
  if (from === to) return normalizeMoney(amount);
  if (to === "UYU") return toUyu(amount, from, fxRateToUyu);
  return normalizeMoney(amount / (fxRateToUyu || 1));
}

export function getCategoryLineage(categoryId: string, categories: Category[]): string[] {
  const ids = [categoryId];
  let current = categories.find((category) => category.id === categoryId);
  while (current?.parentId) {
    ids.push(current.parentId);
    current = categories.find((category) => category.id === current?.parentId);
  }
  return ids;
}

export function isSplitInBudget(split: TransactionSplit, budget: Budget, categories: Category[]): boolean {
  return getCategoryLineage(split.categoryId, categories).includes(budget.categoryId);
}

export function getSplitAmountUyu(split: TransactionSplit, transaction: Transaction): number {
  if (transaction.amount === 0) return split.amountUyu;
  if (split.amountUyu) return split.amountUyu;
  return normalizeMoney((split.amount / transaction.amount) * transaction.amountUyu);
}

export function getDefaultAccountId(accounts: Account[], currency: Currency): string {
  const matching = accounts.filter((account) => account.currency === currency);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const itau = matching.find(
    (account) => account.active && normalize(`${account.institution ?? ""} ${account.name ?? ""}`).includes("itau")
  );
  if (itau) return itau.id;

  const active = matching.find((account) => account.active);
  if (active) return active.id;

  return matching[0]?.id ?? "";
}

export function getAccountBalances(state: AppState): AccountBalance[] {
  const balances = new Map<string, AccountBalance>();
  state.accounts.forEach((account) => {
    balances.set(account.id, {
      account,
      balance: normalizeMoney(account.initialBalance),
      balanceUyu: account.currency === "UYU" ? account.initialBalance : normalizeMoney(account.initialBalance * latestUsdRate(state)),
      lastMovement: undefined
    });
  });

  state.transactions
    .filter((transaction) => transaction.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((transaction) => {
      const source = balances.get(transaction.accountId);
      if (!source) return;

      const sourceDelta = amountInAccountCurrency(transaction, source.account.currency);

      if (transaction.type === "expense") {
        applyDelta(source, -sourceDelta, transaction);
      } else if (transaction.type === "income" || transaction.type === "refund") {
        applyDelta(source, sourceDelta, transaction);
      } else if (transaction.type === "adjustment") {
        applyDelta(source, sourceDelta, transaction);
      } else if (transaction.type === "transfer") {
        if (transaction.toAccountId) {
          applyDelta(source, -sourceDelta, transaction);
          const destination = balances.get(transaction.toAccountId);
          if (destination) {
            applyDelta(destination, amountInAccountCurrency(transaction, destination.account.currency), transaction);
          }
        } else {
          applyDelta(source, transaction.transferDirection === "incoming" ? sourceDelta : -sourceDelta, transaction);
        }
      }
    });

  return Array.from(balances.values());
}

function latestUsdRate(state: AppState): number {
  const latest = [...state.fxRates].sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest?.rateToUyu ?? 40;
}

function amountInAccountCurrency(transaction: Transaction, accountCurrency: Currency): number {
  return convertAmount(transaction.amount, transaction.currency, accountCurrency, transaction.fxRateToUyu);
}

function applyDelta(balance: AccountBalance, delta: number, transaction: Transaction) {
  balance.balance = normalizeMoney(balance.balance + delta);
  balance.balanceUyu =
    balance.account.currency === "UYU"
      ? normalizeMoney(balance.balance)
      : normalizeMoney(balance.balance * transaction.fxRateToUyu);
  balance.lastMovement = transaction;
}

export function getMonthTransactions(transactions: Transaction[], month: string): Transaction[] {
  return transactions.filter((transaction) => transaction.status === "confirmed" && monthKey(transaction.date) === month);
}

export function getMonthSummary(transactions: Transaction[], month: string): MonthSummary {
  return getMonthTransactions(transactions, month).reduce(
    (summary, transaction) => {
      if (transaction.type === "income") summary.incomeUyu += transaction.amountUyu;
      if (transaction.type === "expense") summary.expenseUyu += transaction.amountUyu;
      if (transaction.type === "refund") summary.refundUyu += transaction.amountUyu;
      summary.netUyu = summary.incomeUyu + summary.refundUyu - summary.expenseUyu;
      return summary;
    },
    { incomeUyu: 0, expenseUyu: 0, refundUyu: 0, netUyu: 0 }
  );
}

export function getSpendForCategory(
  transactions: Transaction[],
  month: string,
  budget: Budget,
  categories: Category[]
): number {
  return normalizeMoney(
    getMonthTransactions(transactions, month).reduce((total, transaction) => {
      if (transaction.type !== "expense" && transaction.type !== "refund") return total;
      const sign = transaction.type === "refund" ? -1 : 1;
      const splitSpend = transaction.splits.reduce((splitTotal, split) => {
        if (!isSplitInBudget(split, budget, categories)) return splitTotal;
        return splitTotal + getSplitAmountUyu(split, transaction);
      }, 0);
      return total + sign * splitSpend;
    }, 0)
  );
}

export function getBudgetUsages(state: AppState, month: string): BudgetUsage[] {
  return state.budgets
    .filter((budget) => budget.active && budget.startsAtMonth <= month)
    .map((budget) => {
      const category = state.categories.find((item) => item.id === budget.categoryId);
      if (!category) return undefined;

      const spentUyu = getSpendForCategory(state.transactions, month, budget, state.categories);
      const allowanceUyu = budget.mode === "rollover" ? getRolloverAllowance(state, budget, month) : budget.amountUyu;
      const remainingUyu = normalizeMoney(allowanceUyu - spentUyu);
      const percent = allowanceUyu <= 0 ? 0 : Math.min(999, Math.round((spentUyu / allowanceUyu) * 100));
      const alertState = percent >= 100 ? "over" : percent >= 80 ? "near" : "ok";

      return {
        budget,
        category,
        spentUyu,
        allowanceUyu,
        remainingUyu,
        percent,
        state: alertState,
        mode: budget.mode
      };
    })
    .filter(Boolean) as BudgetUsage[];
}

function getRolloverAllowance(state: AppState, budget: Budget, month: string): number {
  const months = enumerateMonths(budget.startsAtMonth, month);
  const priorCarry = months.slice(0, -1).reduce((carry, item) => {
    return carry + budget.amountUyu - getSpendForCategory(state.transactions, item, budget, state.categories);
  }, 0);
  return normalizeMoney(budget.amountUyu + priorCarry);
}

export function buildDuplicateKey(transaction: Pick<Transaction, "date" | "accountId" | "amount" | "currency" | "payee">): string {
  return [
    transaction.date,
    transaction.accountId,
    transaction.currency,
    normalizeMoney(transaction.amount).toFixed(2),
    transaction.payee.trim().toLowerCase()
  ].join("|");
}

export function getCategoryOptions(categories: Category[]): Category[] {
  return categories.filter((category) => !category.archived);
}
