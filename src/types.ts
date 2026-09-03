export type Currency = "UYU" | "USD";

export type TransactionType = "expense" | "income" | "transfer" | "adjustment" | "refund";

export type FxSource = "bank" | "bcu" | "manual" | "estimated" | "not_applicable";

export type BudgetMode = "reset" | "rollover";

export type RecurringFrequency = "weekly" | "monthly" | "yearly";

export type InboxSourceType = "text" | "image";

export type DraftStatus = "pending" | "converted" | "dismissed";

export type TransferDirection = "incoming" | "outgoing";

export type DraftMissingField = "payee" | "date" | "amount" | "account" | "category";

export type AgentIntent = "real_agent" | "travel" | "income" | "product" | "savings" | "month_summary" | "fallback";

export type AgentConfidence = "alta" | "media" | "baja";

export interface AgentFact {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral" | "accent";
}

export interface AgentEvidenceRow {
  date: string;
  title: string;
  meta: string;
  amount: string;
  tone?: "good" | "bad" | "neutral" | "accent";
}

export interface AgentToolCall {
  name: string;
  summary: string;
  args?: string;
  result?: string;
}

export type AgentChartType = "bar" | "line" | "pie";

export interface AgentChartPoint {
  label: string;
  value: number;
  valueFormatted: string;
  color?: string;
  meta?: string;
}

export interface AgentChart {
  type: AgentChartType;
  title: string;
  subtitle?: string;
  valueLabel?: string;
  totalFormatted?: string;
  points: AgentChartPoint[];
}

export interface AgentAnswer {
  intent: AgentIntent;
  title: string;
  answer: string;
  confidence: AgentConfidence;
  facts: AgentFact[];
  rows: AgentEvidenceRow[];
  suggestions: string[];
  chart?: AgentChart;
  toolCalls?: AgentToolCall[];
  agentName?: string;
  mode?: "openai" | "offline";
  model?: string;
  data: Record<string, string | number | boolean>;
}

export interface AgentConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: AgentAnswer;
  error?: boolean;
  createdAt: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentConversationMessage[];
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  currency: Currency;
  initialBalance: number;
  active: boolean;
  color: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  color: string;
  icon: string;
  archived?: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface TransactionSplit {
  id: string;
  categoryId: string;
  tagIds: string[];
  amount: number;
  amountUyu: number;
}

export interface ReceiptLineItemDraft {
  description: string;
  quantity?: number;
  unitPrice?: number;
  originalAmount?: number;
  discountAmount?: number;
  discountSource?: string;
  shippingAmount?: number;
  amount: number;
  categoryId?: string;
  tagIds: string[];
  confidence: number;
}

export interface TransactionLineItem extends ReceiptLineItemDraft {
  id: string;
  amountUyu: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  accountId: string;
  toAccountId?: string;
  transferDirection?: TransferDirection;
  payee: string;
  note: string;
  currency: Currency;
  amount: number;
  amountUyu: number;
  fxRateToUyu: number;
  fxSource: FxSource;
  paymentMethod: "debit" | "credit" | "cash" | "transfer" | "other";
  status: "confirmed" | "draft";
  splits: TransactionSplit[];
  lineItems?: TransactionLineItem[];
  recurringRuleId?: string;
  importBatchId?: string;
  source?: "manual" | "import" | "inbox" | "recurring";
  createdAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  amountUyu: number;
  mode: BudgetMode;
  active: boolean;
  startsAtMonth: string;
}

export interface RecurringRule {
  id: string;
  name: string;
  type: Extract<TransactionType, "expense" | "income">;
  accountId: string;
  amount: number;
  currency: Currency;
  categoryId: string;
  tagIds: string[];
  payee: string;
  frequency: RecurringFrequency;
  nextDueDate: string;
  autoCreate: false;
}

export interface ImportBatch {
  id: string;
  source: "spendee" | "portfolio-performance" | "generic";
  fileName: string;
  createdAt: string;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  notes: string[];
}

export interface ParsedTransactionDraft {
  type: TransactionType;
  date: string;
  accountId?: string;
  payee: string;
  note: string;
  currency: Currency;
  amount: number;
  fxRateToUyu?: number;
  fxSource: FxSource;
  categoryId?: string;
  transferDirection?: TransferDirection;
  tagIds: string[];
  lineItems?: ReceiptLineItemDraft[];
  missingFields?: DraftMissingField[];
  confidence: number;
}

export interface InboxDraft {
  id: string;
  sourceType: InboxSourceType;
  rawText: string;
  imageDataUrl?: string;
  parsed: ParsedTransactionDraft;
  status: DraftStatus;
  createdAt: string;
}

export interface FxRate {
  id: string;
  date: string;
  currency: Exclude<Currency, "UYU">;
  rateToUyu: number;
  source: Exclude<FxSource, "not_applicable">;
  createdAt: string;
}

export interface InvestmentHolding {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  currency: "USD";
  lastPrice: number;
  lastPriceDate: string;
  quoteProvider: "yahoo" | "binance" | "xml";
}

export interface InvestmentPortfolioSnapshot {
  source: "portfolio-performance" | "manual";
  sourceFileName: string;
  importedAt: string;
  holdings: InvestmentHolding[];
}

export interface AppState {
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  transactions: Transaction[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
  importBatches: ImportBatch[];
  inboxDrafts: InboxDraft[];
  fxRates: FxRate[];
  agentConversations: AgentConversation[];
  investmentPortfolio: InvestmentPortfolioSnapshot | null;
}

export interface ImportPreviewRow {
  id: string;
  raw: Record<string, string>;
  draft: ParsedTransactionDraft;
  duplicateOf?: string;
  warnings: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  fileName: string;
  source: ImportBatch["source"];
}
