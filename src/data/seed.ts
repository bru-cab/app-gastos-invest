import type { Account, AppState, Budget, Category, RecurringRule, Tag, Transaction } from "../types";
import { createId } from "../lib/id";
import { todayIso } from "../lib/date";

const createdAt = new Date().toISOString();

export const defaultAccounts: Account[] = [
  {
    id: "account_itau_uyu",
    name: "Itaú Cuenta UYU",
    institution: "Itaú",
    currency: "UYU",
    initialBalance: 42500,
    active: true,
    color: "#2f855a",
    createdAt
  },
  {
    id: "account_itau_usd",
    name: "Itaú Cuenta USD",
    institution: "Itaú",
    currency: "USD",
    initialBalance: 1850,
    active: true,
    color: "#2b6cb0",
    createdAt
  },
  {
    id: "account_mercadopago_uyu",
    name: "MercadoPago",
    institution: "MercadoPago",
    currency: "UYU",
    initialBalance: 7800,
    active: true,
    color: "#00a3e0",
    createdAt
  }
];

export const defaultCategories: Category[] = [
  { id: "cat_food", name: "Comida", color: "#f97316", icon: "utensils" },
  { id: "cat_groceries", name: "Supermercado", parentId: "cat_food", color: "#fb923c", icon: "shopping-bag" },
  { id: "cat_restaurants", name: "Restaurantes", parentId: "cat_food", color: "#fdba74", icon: "coffee" },
  { id: "cat_home", name: "Casa", color: "#2dd4bf", icon: "home" },
  { id: "cat_services", name: "Servicios", parentId: "cat_home", color: "#14b8a6", icon: "receipt" },
  { id: "cat_transport", name: "Transporte", color: "#6366f1", icon: "car" },
  { id: "cat_health", name: "Salud", color: "#fb7185", icon: "heart" },
  { id: "cat_leisure", name: "Ocio", color: "#a855f7", icon: "sparkles" },
  { id: "cat_income", name: "Ingresos", color: "#22c55e", icon: "wallet" },
  { id: "cat_uncategorized", name: "Sin categorizar", color: "#64748b", icon: "circle" }
];

export const defaultTags: Tag[] = [
  { id: "tag_recurrente", name: "recurrente", color: "#475569" },
  { id: "tag_trabajo", name: "trabajo", color: "#2563eb" },
  { id: "tag_casa", name: "casa", color: "#0f766e" }
];

export const defaultBudgets: Budget[] = [
  {
    id: "budget_groceries",
    categoryId: "cat_groceries",
    amountUyu: 22000,
    mode: "reset",
    active: true,
    startsAtMonth: "2026-01"
  },
  {
    id: "budget_restaurants",
    categoryId: "cat_restaurants",
    amountUyu: 12000,
    mode: "rollover",
    active: true,
    startsAtMonth: "2026-01"
  },
  {
    id: "budget_transport",
    categoryId: "cat_transport",
    amountUyu: 7000,
    mode: "reset",
    active: true,
    startsAtMonth: "2026-01"
  }
];

export const defaultRecurringRules: RecurringRule[] = [
  {
    id: "rec_internet",
    name: "Internet",
    type: "expense",
    accountId: "account_itau_uyu",
    amount: 1990,
    currency: "UYU",
    categoryId: "cat_services",
    tagIds: ["tag_recurrente", "tag_casa"],
    payee: "Antel",
    frequency: "monthly",
    nextDueDate: todayIso(),
    autoCreate: false
  }
];

const sampleTransactionId = createId("txn");

export const defaultTransactions: Transaction[] = [
  {
    id: sampleTransactionId,
    type: "expense",
    date: todayIso(),
    accountId: "account_itau_uyu",
    payee: "Disco",
    note: "Compra semanal",
    currency: "UYU",
    amount: 3420,
    amountUyu: 3420,
    fxRateToUyu: 1,
    fxSource: "not_applicable",
    paymentMethod: "credit",
    status: "confirmed",
    splits: [
      {
        id: createId("split"),
        categoryId: "cat_groceries",
        tagIds: [],
        amount: 3420,
        amountUyu: 3420
      }
    ],
    source: "manual",
    createdAt
  }
];

export const createInitialState = (): AppState => ({
  accounts: defaultAccounts,
  categories: defaultCategories,
  tags: defaultTags,
  transactions: defaultTransactions,
  budgets: defaultBudgets,
  recurringRules: defaultRecurringRules,
  importBatches: [],
  inboxDrafts: [],
  fxRates: [],
  agentConversations: [],
  investmentPortfolio: null
});
