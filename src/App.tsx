import { ChangeEvent, FormEvent, ReactElement, ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  BadgeDollarSign,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Camera,
  Car,
  Check,
  CircleDollarSign,
  Cloud,
  CloudOff,
  Clapperboard,
  Coffee,
  CreditCard,
  Download,
  Dumbbell,
  Eye,
  EyeOff,
  FileUp,
  Filter,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Home,
  Image as ImageIcon,
  Landmark,
  MoreHorizontal,
  Pencil,
  PieChart,
  Plane,
  Plus,
  ReceiptText,
  RefreshCcw,
  Save,
  Search,
  Send,
  Shirt,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Smartphone,
  Tags,
  Trash2,
  Upload,
  Utensils,
  Wallet,
  X,
  type LucideIcon
} from "lucide-react";
import { createWorker } from "tesseract.js";
import type {
  AppState,
  Account,
  AgentAnswer,
  AgentChart,
  AgentChartPoint,
  AgentConversation,
  AgentConversationMessage,
  Budget,
  Category,
  Currency,
  ImportPreview,
  InboxDraft,
  ParsedTransactionDraft,
  ReceiptLineItemDraft,
  RecurringRule,
  Transaction,
  TransactionSplit,
  TransactionType
} from "./types";
import { todayIso, monthKey } from "./lib/date";
import {
  AccountBalance,
  BudgetUsage,
  convertAmount,
  getAccountBalances,
  getBudgetUsages,
  getCategoryOptions,
  getDefaultAccountId,
  getMonthSummary,
  getMonthTransactions,
  normalizeMoney,
  toUyu
} from "./lib/calculations";
import {
  draftAmountUyu,
  getReceiptLineItemAmount,
  getReceiptLineItemDiscount,
  getReceiptLineItemShipping,
  getReceiptLineItemTotal,
  parseInboxText
} from "./lib/inboxParser";
import { parseRemoteInboxImage } from "./lib/inboxClient";
import { importRowsToTransactions, parseSpendeeFile } from "./lib/spendeeImport";
import { exportState } from "./lib/storage";
import { useFinanceStore } from "./hooks/useFinanceStore";
import { askFinanceAgent } from "./lib/financeAgent";
import { askRemoteFinanceAgent, getAgentHealth, type AgentHealth } from "./lib/agentClient";
import { orderTagsByFrequency, suggestTags } from "./lib/tagSuggestions";

type MainTab = "expenses" | "investments" | "agent";
type ExpenseTab = "create" | "month" | "analytics" | "accounts";

const moneyFormatterUyu = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "UYU",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const moneyFormatterUsd = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function formatMoney(amount: number, currency: Currency = "UYU") {
  return currency === "UYU" ? moneyFormatterUyu.format(amount) : moneyFormatterUsd.format(amount);
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-UY", {
    maximumFractionDigits: 2
  }).format(value);
}

const paymentMethods: Array<{ value: Transaction["paymentMethod"]; label: string }> = [
  { value: "credit", label: "Crédito" },
  { value: "debit", label: "Débito" },
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "other", label: "Otro" }
];

const categoryIconMap: Record<string, LucideIcon> = {
  "arrow-down-up": ArrowDownUp,
  "badge-dollar": BadgeDollarSign,
  "briefcase": BriefcaseBusiness,
  "car": Car,
  "clapperboard": Clapperboard,
  "coffee": Coffee,
  "credit-card": CreditCard,
  "dumbbell": Dumbbell,
  "gift": Gift,
  "graduation-cap": GraduationCap,
  "hand-coins": HandCoins,
  "heart-pulse": HeartPulse,
  "home": Home,
  "landmark": Landmark,
  "more-horizontal": MoreHorizontal,
  "plane": Plane,
  "receipt": ReceiptText,
  "shield-check": ShieldCheck,
  "shirt": Shirt,
  "shopping-bag": ShoppingBag,
  "smartphone": Smartphone,
  "sparkles": Sparkles,
  "utensils": Utensils,
  "wallet": Wallet
};

const transientAgentWelcome: AgentConversationMessage = {
  id: "agent_welcome_transient",
  role: "assistant",
  content: "Listo. Puedo consultar tus movimientos con herramientas financieras y responder con evidencia.",
  createdAt: ""
};

export default function App() {
  const { state, actions, syncStatus } = useFinanceStore();
  const [mainTab, setMainTab] = useState<MainTab>("expenses");
  const [expenseTab, setExpenseTab] = useState<ExpenseTab>("create");
  const currentMonth = monthKey(todayIso());

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <CircleDollarSign size={24} />
          </div>
          <div>
            <strong>Gastos Invest</strong>
            <span>Finanzas personales</span>
          </div>
        </div>

        <nav className="mainNav" aria-label="Principal">
          <button className={mainTab === "expenses" ? "active" : ""} onClick={() => setMainTab("expenses")}>
            <ReceiptText size={18} />
            Gastos
          </button>
          <button className={mainTab === "investments" ? "active" : ""} onClick={() => setMainTab("investments")}>
            <BarChart3 size={18} />
            Inversiones
          </button>
          <button className={mainTab === "agent" ? "active" : ""} onClick={() => setMainTab("agent")}>
            <Bot size={18} />
            Agente
          </button>
        </nav>

        <div className="sidebarFooter">
          <SyncStatusPill status={syncStatus} />
          <button className="iconText ghost" onClick={() => downloadBackup(state)} title="Exportar backup JSON">
            <Download size={16} />
            Backup
          </button>
          <button className="iconText ghost danger" onClick={() => actions.resetDemoData()} title="Restaurar datos demo">
            <RefreshCcw size={16} />
            Reset
          </button>
        </div>
      </aside>

      <main className="mainPanel">
        {mainTab === "expenses" && (
          <ExpensesWorkspace
            state={state}
            actions={actions}
            expenseTab={expenseTab}
            setExpenseTab={setExpenseTab}
            currentMonth={currentMonth}
          />
        )}
        {mainTab === "investments" && <Placeholder icon={<BarChart3 />} title="Inversiones" />}
        {mainTab === "agent" && <AgentWorkspace state={state} actions={actions} />}
      </main>
    </div>
  );
}

function SyncStatusPill({ status }: { status: ReturnType<typeof useFinanceStore>["syncStatus"] }) {
  const online = status.state === "synced" || status.state === "saving" || status.state === "checking";
  return (
    <div className={`syncPill ${online ? "online" : "offline"}`} title={status.state === "synced" ? `Revision ${status.revision}` : status.label}>
      {online ? <Cloud size={16} /> : <CloudOff size={16} />}
      <span>{status.label}</span>
    </div>
  );
}

function ExpensesWorkspace({
  state,
  actions,
  expenseTab,
  setExpenseTab,
  currentMonth
}: {
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  expenseTab: ExpenseTab;
  setExpenseTab: (tab: ExpenseTab) => void;
  currentMonth: string;
}) {
  const balances = useMemo(() => getAccountBalances(state), [state]);
  const activeBalances = useMemo(() => balances.filter((balance) => balance.account.active), [balances]);
  const summary = useMemo(() => getMonthSummary(state.transactions, currentMonth), [state.transactions, currentMonth]);
  const budgetUsages = useMemo(() => getBudgetUsages(state, currentMonth), [state, currentMonth]);

  return (
    <section className="workspace">
      <header className="topBar">
        <div>
          <span className="eyebrow">Gastos</span>
          <h1>Tu mes, tus cuentas y cada movimiento en orden.</h1>
        </div>
        <div className="topMetrics">
          <Metric label="Gasto mes" value={formatMoney(summary.expenseUyu)} accent="coral" />
          <Metric label="Neto mes" value={formatMoney(summary.netUyu)} accent={summary.netUyu >= 0 ? "green" : "red"} />
          <Metric label="Disponible" value={formatMoney(activeBalances.reduce((total, item) => total + item.balanceUyu, 0))} accent="blue" />
        </div>
      </header>

      <div className="subTabs" role="tablist" aria-label="Gastos">
        <button className={expenseTab === "create" ? "active" : ""} onClick={() => setExpenseTab("create")}>
          <Plus size={16} />
          Crear
        </button>
        <button className={expenseTab === "month" ? "active" : ""} onClick={() => setExpenseTab("month")}>
          <Filter size={16} />
          Mes
        </button>
        <button className={expenseTab === "analytics" ? "active" : ""} onClick={() => setExpenseTab("analytics")}>
          <PieChart size={16} />
          Analítica
        </button>
        <button className={expenseTab === "accounts" ? "active" : ""} onClick={() => setExpenseTab("accounts")}>
          <Wallet size={16} />
          Cuentas
        </button>
      </div>

      {expenseTab === "create" && <CreateExpenseView state={state} actions={actions} />}
      {expenseTab === "month" && <MonthAnalysisView state={state} actions={actions} month={currentMonth} budgetUsages={budgetUsages} />}
      {expenseTab === "analytics" && <AnalyticsView state={state} month={currentMonth} />}
      {expenseTab === "accounts" && <AccountsView state={state} actions={actions} balances={balances} />}
    </section>
  );
}

function Metric({ label, value, accent }: { label: ReactNode; value: string; accent: "coral" | "green" | "red" | "blue" }) {
  return (
    <div className={`metric ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ItauBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "itauBadge compact" : "itauBadge"} title="Ahorro por pagar con tarjeta Itaú">
      <span className="itauMark" aria-hidden="true">i</span>
      Itaú
    </span>
  );
}

function isItauSavings(item: ReceiptLineItemDraft): boolean {
  return normalizeLookupKey(item.discountSource ?? "").includes("itau");
}

function CreateExpenseView({ state, actions }: { state: AppState; actions: ReturnType<typeof useFinanceStore>["actions"] }) {
  const [kind, setKind] = useState<"quick" | "inbox" | "import" | "recurring">("quick");

  return (
    <div className="singleColumn">
      <div className="panel">
        <Segmented
          options={[
            { value: "quick", label: "Movimiento", icon: <Plus size={16} /> },
            { value: "inbox", label: "Inbox", icon: <Camera size={16} /> },
            { value: "import", label: "Importar", icon: <FileUp size={16} /> },
            { value: "recurring", label: "Recurrentes", icon: <RefreshCcw size={16} /> }
          ]}
          value={kind}
          onChange={(value) => setKind(value as typeof kind)}
        />

        {kind === "quick" && <QuickTransactionForm state={state} onSubmit={actions.addTransaction} />}
        {kind === "inbox" && <InboxPanel state={state} actions={actions} />}
        {kind === "import" && <ImportPanel state={state} actions={actions} />}
        {kind === "recurring" && <RecurringPanel state={state} actions={actions} />}
      </div>
    </div>
  );
}

function QuickTransactionForm({
  state,
  onSubmit
}: {
  state: AppState;
  onSubmit: ReturnType<typeof useFinanceStore>["actions"]["addTransaction"];
}) {
  const firstAccount = getDefaultAccountId(state.accounts, "UYU");
  const [type, setType] = useState<TransactionType>("expense");
  const categoryOptions = useMemo(() => getManualCategoryOptionsForType(state.categories, type), [state.categories, type]);
  const firstCategory = categoryOptions[0]?.id ?? "cat_uncategorized";
  const [amount, setAmount] = useState("0");
  const [reveal, setReveal] = useState(false);
  const [currency, setCurrency] = useState<Currency>("UYU");
  const accountOptions = useMemo(() => state.accounts.filter((account) => account.active && account.currency === currency), [state.accounts, currency]);
  const [accountId, setAccountId] = useState(firstAccount);
  const [toAccountId, setToAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<Transaction["paymentMethod"]>("credit");
  const [date, setDate] = useState(todayIso());
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [fxRate, setFxRate] = useState("40");
  const [splits, setSplits] = useState<Array<Omit<TransactionSplit, "id" | "amountUyu">>>([
    { categoryId: firstCategory, tagIds: [], amount: 0 }
  ]);

  const numericAmount = Number(amount) || 0;
  const totalSplits = splits.reduce((total, split) => total + Number(split.amount || 0), 0);
  const amountUyu = toUyu(numericAmount, currency, currency === "USD" ? Number(fxRate) || 40 : 1);
  const splitMismatch = splits.length > 1 && Math.abs(totalSplits - numericAmount) > 0.01;

  useEffect(() => {
    if (accountOptions.some((account) => account.id === accountId)) return;
    setAccountId(getDefaultAccountId(state.accounts, currency));
  }, [accountId, accountOptions]);

  useEffect(() => {
    if (categoryOptions.length === 0) return;
    setSplits((current) =>
      current.map((split) =>
        categoryOptions.some((category) => category.id === split.categoryId)
          ? split
          : {
              ...split,
              categoryId: firstCategory
            }
      )
    );
  }, [categoryOptions, firstCategory]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!numericAmount || !accountId) return;

    onSubmit({
      type,
      date,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : undefined,
      transferDirection: type === "transfer" ? "outgoing" : undefined,
      payee,
      note,
      currency,
      amount: numericAmount,
      fxRateToUyu: currency === "USD" ? Number(fxRate) || 40 : 1,
      fxSource: currency === "USD" ? "bank" : "not_applicable",
      paymentMethod: type === "transfer" ? "transfer" : paymentMethod,
      splits: normalizeSplitsForSubmit(splits, numericAmount, firstCategory),
      source: "manual"
    });

    setAmount("0");
    setReveal(false);
    setPayee("");
    setNote("");
    setSplits([{ categoryId: firstCategory, tagIds: [], amount: 0 }]);
  }

  return (
    <form className="quickForm" onSubmit={submit}>
      <div className="amountBlock">
        <label htmlFor="amount">Monto</label>
        <div className="amountLine">
          <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} aria-label="Moneda">
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
          </select>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              if (event.target.value.trim() && event.target.value !== "0") setReveal(true);
            }}
          />
        </div>
        <span className="amountHint">{formatMoney(amountUyu)} para budgets</span>
      </div>

      {reveal && (
        <div className="formReveal">
          <div className="formGrid">
        <label>
          Tipo
          <select value={type} onChange={(event) => setType(event.target.value as TransactionType)}>
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
            <option value="transfer">Transferencia</option>
            <option value="adjustment">Ajuste</option>
            <option value="refund">Reembolso</option>
          </select>
        </label>
        <label>
          Cuenta
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        {type === "transfer" && (
          <label>
            Destino
            <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
              <option value="">Seleccionar</option>
              {state.accounts
                .filter((account) => account.active && account.id !== accountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Método
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Transaction["paymentMethod"])}>
            {paymentMethods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {currency === "USD" && (
          <label>
            Tasa banco
            <input type="number" min="0" step="0.001" value={fxRate} onChange={(event) => setFxRate(event.target.value)} />
          </label>
        )}
        <label>
          Comercio
          <input value={payee} onChange={(event) => setPayee(event.target.value)} />
        </label>
        <label className="wide">
          Nota
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>

      <SplitEditor
        categories={state.categories}
        transactionType={type}
        tags={state.tags}
        transactions={state.transactions}
        payee={payee}
        note={note}
        currency={currency}
        fxRate={fxRate}
        splits={splits}
        amount={numericAmount}
        setSplits={setSplits}
      />

      {splitMismatch && <InlineAlert>El split suma {formatMoney(totalSplits, currency)} y el movimiento es {formatMoney(numericAmount, currency)}.</InlineAlert>}

          <button className="primaryButton" type="submit">
            <Save size={18} />
            Guardar movimiento
          </button>
        </div>
      )}
    </form>
  );
}

function SplitEditor({
  categories,
  transactionType,
  tags,
  transactions,
  payee,
  note,
  currency,
  fxRate,
  splits,
  amount,
  setSplits
}: {
  categories: Category[];
  transactionType: TransactionType;
  tags: AppState["tags"];
  transactions: Transaction[];
  payee: string;
  note: string;
  currency: Currency;
  fxRate: string;
  splits: Array<Omit<TransactionSplit, "id" | "amountUyu">>;
  amount: number;
  setSplits: (splits: Array<Omit<TransactionSplit, "id" | "amountUyu">>) => void;
}) {
  const [categoryQuery, setCategoryQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const categoryOptions = getManualCategoryOptionsForType(categories, transactionType);
  const visibleCategories = categoryOptions
    .filter((category) => normalizeLookupKey(category.name).includes(normalizeLookupKey(categoryQuery)))
    .slice(0, categoryQuery ? 24 : 18);
  const orderedTags = useMemo(() => orderTagsByFrequency(tags, transactions), [tags, transactions]);
  const suggestions = useMemo(
    () =>
      suggestTags(tags, transactions, {
        payee,
        note,
        amount,
        currency,
        fxRateToUyu: currency === "USD" ? Number(fxRate) || 40 : 1
      }),
    [tags, transactions, payee, note, amount, currency, fxRate]
  );
  const filteredTags = orderedTags
    .filter((tag) => tag.name.toLowerCase().includes(tagQuery.trim().toLowerCase()))
    .slice(0, tagQuery ? 24 : 18);

  function updateSplit(index: number, changes: Partial<Omit<TransactionSplit, "id" | "amountUyu">>) {
    setSplits(splits.map((split, currentIndex) => (currentIndex === index ? { ...split, ...changes } : split)));
  }

  function toggleTag(index: number, tagId: string) {
    const current = splits[index]?.tagIds ?? [];
    updateSplit(index, {
      tagIds: current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    });
  }

  return (
    <div className="splitBox">
      <div className="sectionTitle">
        <Tags size={16} />
        <h2>Categorías y tags</h2>
        <button
          type="button"
          className="iconButton"
          title="Agregar split"
          onClick={() => setSplits([...splits, { categoryId: categoryOptions[0]?.id ?? "cat_uncategorized", tagIds: [], amount: 0 }])}
        >
          <Plus size={16} />
        </button>
      </div>
      {suggestions.length > 0 && (payee.trim() || note.trim() || amount > 0) && (
        <div className="tagSuggestionStrip">
          <Sparkles size={14} />
          <span className="tagSuggestionLabel">Sugerencias</span>
          {suggestions.map((tag) => {
            const active = splits[0]?.tagIds.includes(tag.id);
            return (
              <button
                className={active ? "tagChip active" : "tagChip"}
                type="button"
                key={`suggest-${tag.id}`}
                onClick={() => toggleTag(0, tag.id)}
                title={active ? "Quitar tag" : "Agregar tag sugerido"}
              >
                <span style={{ background: tag.color }} />
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="splitRows">
        {splits.map((split, index) => (
          <div className="splitRow" key={index}>
            <div className="categoryPickerBlock">
              <div className="categoryPickerTop">
                <input
                  value={categoryQuery}
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="Buscar categoría"
                  aria-label="Buscar categoría"
                />
                {splits.length > 1 && (
                  <input
                    aria-label="Monto split"
                    type="number"
                    min="0"
                    step="0.01"
                    value={split.amount || 0}
                    onChange={(event) => updateSplit(index, { amount: Number(event.target.value) })}
                  />
                )}
              </div>
              <CategoryIconGrid
                categories={visibleCategories}
                selectedCategoryId={split.categoryId}
                onSelect={(categoryId) => updateSplit(index, { categoryId })}
              />
            </div>
            {splits.length > 1 && (
              <button
                className="iconButton danger"
                type="button"
                title="Eliminar split"
                onClick={() => setSplits(splits.filter((_, currentIndex) => currentIndex !== index))}
              >
                <Trash2 size={15} />
              </button>
            )}
            {splits.length === 1 && <input type="hidden" value={amount} readOnly />}
            <div className="tagChipTray">
              <input
                className="tagSearch"
                value={tagQuery}
                onChange={(event) => setTagQuery(event.target.value)}
                placeholder="Filtrar tags"
                aria-label="Filtrar tags"
              />
              {filteredTags.map((tag) => {
                const active = split.tagIds.includes(tag.id);
                return (
                  <button
                    className={active ? "tagChip active" : "tagChip"}
                    type="button"
                    key={tag.id}
                    onClick={() => toggleTag(index, tag.id)}
                    title={active ? "Quitar tag" : "Agregar tag"}
                  >
                    <span style={{ background: tag.color }} />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryIconGrid({
  categories,
  selectedCategoryId,
  onSelect
}: {
  categories: Category[];
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
}) {
  return (
    <div className="categoryIconGrid" role="listbox" aria-label="Categorías">
      {categories.map((category) => {
        const active = category.id === selectedCategoryId;
        return (
          <button
            className={active ? "categoryTile active" : "categoryTile"}
            type="button"
            key={category.id}
            onClick={() => onSelect(category.id)}
            aria-pressed={active}
            title={category.name}
          >
            <span className="categoryIconBubble" style={{ color: category.color, backgroundColor: softColor(category.color) }}>
              <CategoryGlyph category={category} size={22} />
            </span>
            <span>{category.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function CategoryGlyph({ category, size = 18 }: { category: Category; size?: number }) {
  const iconKey = inferCategoryIconKey(category);
  const Icon = categoryIconMap[iconKey] ?? MoreHorizontal;
  return <Icon size={size} strokeWidth={2.25} />;
}

function InboxPanel({ state, actions }: { state: AppState; actions: ReturnType<typeof useFinanceStore>["actions"] }) {
  const [text, setText] = useState("");
  const [ocrStatus, setOcrStatus] = useState("");

  function addTextDraft() {
    if (!text.trim()) return;
    actions.addInboxDraft({
      sourceType: "text",
      rawText: text,
      parsed: parseInboxText(text, state.accounts, state.categories, state.tags)
    });
    setText("");
  }

  async function readImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setOcrStatus("Analizando captura");
    const dataUrl = await fileToDataUrl(file);

    try {
      const result = await parseRemoteInboxImage(file.name, dataUrl);
      actions.addInboxDraft({
        sourceType: "image",
        rawText: result.rawText,
        imageDataUrl: dataUrl,
        parsed: result.parsed
      });
      setOcrStatus(`Captura analizada por ${result.agentName}`);
      event.target.value = "";
      return;
    } catch {
      setOcrStatus("OpenAI no pudo leerla; usando OCR local");
    }

    try {
      const worker = await createWorker("spa+eng");
      const result = await worker.recognize(file);
      await worker.terminate();
      const rawText = result.data.text.trim() || file.name;
      actions.addInboxDraft({
        sourceType: "image",
        rawText,
        imageDataUrl: dataUrl,
        parsed: parseInboxText(rawText, state.accounts, state.categories, state.tags)
      });
      setOcrStatus("Imagen procesada");
    } catch {
      actions.addInboxDraft({
        sourceType: "image",
        rawText: file.name,
        imageDataUrl: dataUrl,
        parsed: parseInboxText(file.name, state.accounts, state.categories, state.tags)
      });
      setOcrStatus("Imagen guardada");
    }
    event.target.value = "";
  }

  return (
    <div className="stack">
      <div className="inboxEntry">
        <label>
          Texto
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} />
        </label>
        <div className="buttonRow">
          <button className="primaryButton" type="button" onClick={addTextDraft}>
            <Plus size={18} />
            Crear borrador
          </button>
          <label className="fileButton">
            <Camera size={18} />
            Foto
            <input type="file" accept="image/*" capture="environment" onChange={readImage} />
          </label>
          <label className="fileButton">
            <ImageIcon size={18} />
            Subir captura
            <input type="file" accept="image/png,image/jpeg,image/webp,image/*" onChange={readImage} />
          </label>
        </div>
        {ocrStatus && <span className="muted">{ocrStatus}</span>}
      </div>

      <div className="draftList">
        {state.inboxDrafts.filter((draft) => draft.status === "pending").length === 0 && <EmptyState text="Sin borradores pendientes" />}
        {state.inboxDrafts
          .filter((draft) => draft.status === "pending")
          .map((draft) => (
            <InboxDraftCard key={draft.id} draft={draft} state={state} actions={actions} />
          ))}
      </div>
    </div>
  );
}

function InboxDraftCard({
  draft,
  state,
  actions
}: {
  draft: InboxDraft;
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
}) {
  const [editable, setEditable] = useState<ParsedTransactionDraft>(draft.parsed);
  const reviewLabels = getDraftReviewLabels(editable);
  const blockingIssues = getDraftBlockingIssues(editable);
  const draftCategoryOptions = getManualCategoryOptionsForType(state.categories, editable.type);

  return (
    <article className={`draftCard ${draft.imageDataUrl ? "" : "noImage"}`}>
      {draft.imageDataUrl && <img className="draftImage" src={draft.imageDataUrl} alt="" />}
      <div className="draftFields">
        {reviewLabels.length > 0 && (
          <div className="reviewChecklist">
            <AlertTriangle size={16} />
            Revisar: {reviewLabels.join(", ")}
          </div>
        )}
        <input value={editable.payee} onChange={(event) => setEditable({ ...editable, payee: event.target.value })} />
        <div className="compactGrid">
          <input
            type="number"
            min="0"
            step="0.01"
            value={editable.amount}
            onChange={(event) => setEditable({ ...editable, amount: Number(event.target.value) })}
          />
          <select value={editable.currency} onChange={(event) => setEditable({ ...editable, currency: event.target.value as Currency })}>
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
          </select>
          <input type="date" value={editable.date} onChange={(event) => setEditable({ ...editable, date: event.target.value })} />
        </div>
        <div className="compactGrid">
          <select value={editable.accountId ?? ""} onChange={(event) => setEditable({ ...editable, accountId: event.target.value })}>
            <option value="">Cuenta</option>
            {state.accounts
              .filter((account) => account.active)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
          <select value={editable.categoryId ?? ""} onChange={(event) => setEditable({ ...editable, categoryId: event.target.value })}>
            <option value="">Categoría</option>
            {draftCategoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parentId ? "• " : ""}
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <ReceiptItemsEditor draft={editable} categories={state.categories} setDraft={setEditable} />
        <span className="muted">Confianza {formatPercent(editable.confidence * 100)} · {formatMoney(draftAmountUyu(editable))}</span>
      </div>
      <div className="cardActions">
        <button
          className="iconButton success"
          title={blockingIssues.length ? `Falta: ${blockingIssues.join(", ")}` : "Confirmar"}
          disabled={blockingIssues.length > 0}
          onClick={() => actions.convertInboxDraft(draft.id, editable)}
        >
          <Check size={16} />
        </button>
        <button className="iconButton danger" title="Descartar" onClick={() => actions.dismissInboxDraft(draft.id)}>
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function ReceiptItemsEditor({
  draft,
  categories,
  setDraft
}: {
  draft: ParsedTransactionDraft;
  categories: Category[];
  setDraft: (draft: ParsedTransactionDraft) => void;
}) {
  const items = draft.lineItems ?? [];
  const categoryOptions = getManualCategoryOptionsForType(categories, "expense");
  const fallbackCategoryId = draft.categoryId ?? categoryOptions[0]?.id ?? "cat_uncategorized";
  const productTotal = normalizeMoney(items.reduce((sum, item) => sum + getReceiptLineItemAmount(item), 0));
  const shippingTotal = normalizeMoney(items.reduce((sum, item) => sum + getReceiptLineItemShipping(item), 0));
  const discountTotal = normalizeMoney(items.reduce((sum, item) => sum + getReceiptLineItemDiscount(item), 0));
  const itemTotal = normalizeMoney(items.reduce((sum, item) => sum + getReceiptLineItemTotal(item), 0));
  const unitTotal = normalizeMoney(items.reduce((sum, item) => sum + Number(item.quantity ?? 1), 0));
  const discountLabel = formatReceiptDiscountLabel(items);
  const hasItauSavings = items.some(isItauSavings);
  const difference = normalizeMoney(draft.amount - itemTotal);

  function updateItem(index: number, changes: Partial<ReceiptLineItemDraft>) {
    setDraft({
      ...draft,
      lineItems: items.map((item, currentIndex) => (currentIndex === index ? { ...item, ...changes } : item))
    });
  }

  function addItem() {
    setDraft({
      ...draft,
      lineItems: [
        ...items,
        {
          description: "",
          quantity: 1,
          amount: 0,
          categoryId: fallbackCategoryId,
          tagIds: [],
          confidence: 0.4
        }
      ]
    });
  }

  function updateAmount(index: number, value: string) {
    const amount = numericInputValue(value) ?? 0;
    const item = items[index];
    const quantity = item?.quantity;
    const discountAmount = item ? getReceiptLineItemDiscount(item) : 0;
    updateItem(index, {
      amount,
      unitPrice: quantity ? normalizeMoney(amount / quantity) : undefined,
      originalAmount: discountAmount ? normalizeMoney(amount + discountAmount) : undefined
    });
  }

  function updateQuantity(index: number, value: string) {
    const quantity = numericInputValue(value);
    const item = items[index];
    updateItem(index, {
      quantity,
      unitPrice: quantity && item ? normalizeMoney(getReceiptLineItemAmount(item) / quantity) : undefined
    });
  }

  function updateDiscount(index: number, value: string) {
    const discountAmount = numericInputValue(value);
    const item = items[index];
    updateItem(index, {
      discountAmount,
      originalAmount: discountAmount && item ? normalizeMoney(getReceiptLineItemAmount(item) + discountAmount) : undefined,
      discountSource: discountAmount ? item?.discountSource ?? inferReceiptDiscountSource(draft) : undefined
    });
  }

  function removeItem(index: number) {
    setDraft({
      ...draft,
      lineItems: items.filter((_, currentIndex) => currentIndex !== index)
    });
  }

  return (
    <div className="receiptItemsBox">
      <div className="receiptItemsHeader">
        <strong>Detalle ticket</strong>
        <span>{items.length} productos · {formatQuantity(unitTotal)} un. · {formatMoney(itemTotal, draft.currency)}</span>
        <button className="iconButton" type="button" title="Agregar item" onClick={addItem}>
          <Plus size={15} />
        </button>
      </div>
      {items.length === 0 ? (
        <EmptyState text="Sin items detectados" />
      ) : (
        <div className="receiptItemRows">
          <div className="receiptItemColumns" aria-hidden="true">
            <span>Producto</span>
            <span>Un.</span>
            <span>Subtotal</span>
            <span>Envío</span>
            <span>Ahorro</span>
            <span>Total</span>
          </div>
          {items.map((item, index) => (
            <div className="receiptItemRow" key={`${item.description}-${index}`}>
              <div className="receiptItemDescription">
                <input
                  aria-label="Producto"
                  value={item.description}
                  onChange={(event) => updateItem(index, { description: event.target.value })}
                />
                {isItauSavings(item) && <ItauBadge compact />}
              </div>
              <input
                aria-label="Unidades"
                type="number"
                min="0"
                step="1"
                value={item.quantity ?? ""}
                onChange={(event) => updateQuantity(index, event.target.value)}
              />
              <input
                aria-label="Subtotal item"
                type="number"
                min="0"
                step="0.01"
                value={item.amount}
                onChange={(event) => updateAmount(index, event.target.value)}
              />
              <input
                aria-label="Envío prorrateado"
                type="number"
                min="0"
                step="0.01"
                value={item.shippingAmount ?? ""}
                onChange={(event) => updateItem(index, { shippingAmount: numericInputValue(event.target.value) })}
              />
              <input
                aria-label="Ahorro Itaú"
                type="number"
                min="0"
                step="0.01"
                value={item.discountAmount ?? ""}
                onChange={(event) => updateDiscount(index, event.target.value)}
              />
              <span className="receiptItemTotal">{formatMoney(getReceiptLineItemTotal(item), draft.currency)}</span>
              <select value={item.categoryId ?? fallbackCategoryId} onChange={(event) => updateItem(index, { categoryId: event.target.value })}>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.parentId ? "• " : ""}
                    {category.name}
                  </option>
                ))}
              </select>
              <button className="iconButton danger" type="button" title="Eliminar item" onClick={() => removeItem(index)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (shippingTotal > 0 || discountTotal > 0) && (
        <div className="receiptItemsSummary">
          <span>Subtotal {formatMoney(productTotal, draft.currency)}</span>
          {shippingTotal > 0 && <span>Envío {formatMoney(shippingTotal, draft.currency)}</span>}
          {discountTotal > 0 && (
            <span className="saving">
              {hasItauSavings && <ItauBadge compact />}
              {discountLabel} -{formatMoney(discountTotal, draft.currency)}
            </span>
          )}
        </div>
      )}
      {items.length > 0 && Math.abs(difference) > 0.01 && (
        <InlineAlert>
          Detalle {formatMoney(itemTotal, draft.currency)} · diferencia {formatMoney(difference, draft.currency)}
        </InlineAlert>
      )}
    </div>
  );
}

function numericInputValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function inferReceiptDiscountSource(draft: ParsedTransactionDraft): string {
  return /\b(?:itau|itaú)\b/i.test(`${draft.payee} ${draft.note}`) || /\bla\s+molienda\b/i.test(`${draft.payee} ${draft.note}`)
    ? "Itaú"
    : "Descuento";
}

function formatReceiptDiscountLabel(items: ReceiptLineItemDraft[]): string {
  const source = items.map((item) => item.discountSource).find((value): value is string => Boolean(value?.trim()));
  return source ? `Ahorro ${source}` : "Ahorro";
}

function ImportPanel({ state, actions }: { state: AppState; actions: ReturnType<typeof useFinanceStore>["actions"] }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const nextPreview =
      file.name.toLowerCase().endsWith(".json")
        ? parseJsonBackup(text, file.name)
        : parseSpendeeFile(text, file.name, state.accounts, state.categories, state.transactions);
    setPreview(nextPreview);
    setSelectedIds(new Set(nextPreview.rows.filter((row) => !row.duplicateOf && row.warnings.length === 0).map((row) => row.id)));
  }

  function commitImport() {
    if (!preview) return;
    const result = importRowsToTransactions(preview, selectedIds);
    actions.importTransactions(result.batch, result.transactions);
    setPreview(null);
    setSelectedIds(new Set());
  }

  function updatePreviewDraft(rowId: string, changes: Partial<ParsedTransactionDraft>) {
    if (!preview) return;
    setPreview({
      ...preview,
      rows: preview.rows.map((row) => {
        if (row.id !== rowId) return row;
        const draft = { ...row.draft, ...changes };
        return { ...row, draft, warnings: getImportWarnings(draft) };
      })
    });
  }

  return (
    <div className="stack">
      <label className="dropZone">
        <Upload size={24} />
        <span>Spendee CSV o backup JSON</span>
        <input type="file" accept=".csv,.json,text/csv,application/json" onChange={handleFile} />
      </label>

      {preview && (
        <div className="importPreview">
          <div className="sectionTitle">
            <FileUp size={16} />
            <h2>{preview.fileName}</h2>
            <button className="primaryButton small" type="button" onClick={commitImport}>
              <Check size={16} />
              Importar {selectedIds.size}
            </button>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Fecha</th>
                  <th>Comercio</th>
                  <th>Monto</th>
                  <th>Cuenta</th>
                  <th>Categoría</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 40).map((row) => (
                  <tr key={row.id} className={row.duplicateOf ? "dimmed" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        disabled={Boolean(row.duplicateOf)}
                        onChange={(event) => {
                          const next = new Set(selectedIds);
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          setSelectedIds(next);
                        }}
                      />
                    </td>
                    <td>{row.draft.date}</td>
                    <td>{row.draft.payee}</td>
                    <td>{formatMoney(row.draft.amount, row.draft.currency)}</td>
                    <td>
                      <select
                        value={row.draft.accountId ?? ""}
                        disabled={Boolean(row.duplicateOf)}
                        onChange={(event) => updatePreviewDraft(row.id, { accountId: event.target.value })}
                      >
                        <option value="">Sin mapear</option>
                        {state.accounts
                          .filter((account) => account.currency === row.draft.currency)
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={row.draft.categoryId ?? ""}
                        disabled={Boolean(row.duplicateOf)}
                        onChange={(event) => updatePreviewDraft(row.id, { categoryId: event.target.value })}
                      >
                        <option value="">Sin mapear</option>
                        {getCategoryOptions(state.categories).map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.parentId ? "• " : ""}
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{row.duplicateOf ? "Duplicado" : row.warnings.join(", ") || "Listo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RecurringPanel({ state, actions }: { state: AppState; actions: ReturnType<typeof useFinanceStore>["actions"] }) {
  return (
    <div className="stack">
      {state.recurringRules.map((rule) => (
        <article className="listCard" key={rule.id}>
          <div>
            <strong>{rule.name}</strong>
            <span>
              {rule.payee} · {formatMoney(rule.amount, rule.currency)} · {rule.nextDueDate}
            </span>
          </div>
          <button className="primaryButton small" onClick={() => actions.confirmRecurring(rule)}>
            <Check size={16} />
            Confirmar
          </button>
        </article>
      ))}
    </div>
  );
}

function MonthAnalysisView({
  state,
  actions,
  month,
  budgetUsages
}: {
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  month: string;
  budgetUsages: BudgetUsage[];
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState<"" | Currency>("");
  const summary = useMemo(() => getMonthSummary(state.transactions, month), [state.transactions, month]);

  const transactions = useMemo(() => {
    return getMonthTransactions(state.transactions, month).filter((transaction) => {
      const haystack = `${transaction.payee} ${transaction.note}`.toLowerCase();
      const splitCategories = transaction.splits.flatMap((split) => {
        const category = state.categories.find((item) => item.id === split.categoryId);
        return [category?.id, category?.parentId].filter(Boolean);
      });
      return (
        (!query || haystack.includes(query.toLowerCase())) &&
        (!categoryId || splitCategories.includes(categoryId)) &&
        (!accountId || transaction.accountId === accountId || transaction.toAccountId === accountId) &&
        (!currency || transaction.currency === currency)
      );
    });
  }, [state.transactions, state.categories, month, query, categoryId, accountId, currency]);

  const categorySpend = useMemo(() => getCategorySpendRows(transactions, state.categories), [transactions, state.categories]);

  return (
    <div className="monthView">
      <div className="monthSummaryStrip">
        <Metric label="Ingresos" value={formatMoney(summary.incomeUyu)} accent="green" />
        <Metric label="Gastos" value={formatMoney(summary.expenseUyu)} accent="coral" />
        <Metric label="Reembolsos" value={formatMoney(summary.refundUyu)} accent="blue" />
        <Metric label="Neto" value={formatMoney(summary.netUyu)} accent={summary.netUyu >= 0 ? "green" : "red"} />
      </div>

      <div className="monthContentGrid">
        <div className="panel budgetPanel">
          <div className="sectionTitle">
            <BarChart3 size={16} />
            <h2>Budgets</h2>
          </div>
          {budgetUsages.length > 0 ? (
            <div className="budgetList">
              {budgetUsages.map((usage) => (
                <BudgetRow key={usage.budget.id} usage={usage} actions={actions} />
              ))}
            </div>
          ) : (
            <EmptyState text="Sin budgets activos para este mes" />
          )}
          <BudgetCreator state={state} actions={actions} month={month} />
        </div>

        <div className="panel movementPanel">
          <div className="sectionTitle">
            <Search size={16} />
            <h2>Movimientos</h2>
          </div>
          <div className="filters">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" />
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Categorías</option>
              {getCategoryOptions(state.categories).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parentId ? "• " : ""}
                  {category.name}
                </option>
              ))}
            </select>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Cuentas</option>
              {state.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <select value={currency} onChange={(event) => setCurrency(event.target.value as "" | Currency)}>
              <option value="">Monedas</option>
              <option value="UYU">UYU</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <div className="compactSpendList">
            {categorySpend.slice(0, 5).map((row) => (
              <div className="spendBar" key={row.category.id}>
                <span style={{ background: row.category.color }} />
                <strong>{row.category.name}</strong>
                <div>
                  <i style={{ width: `${Math.min(100, row.percent)}%`, background: row.category.color }} />
                </div>
                <em>{formatMoney(row.amountUyu)}</em>
              </div>
            ))}
          </div>

          <MonthTransactionList transactions={transactions} state={state} actions={actions} />
        </div>
      </div>
    </div>
  );
}

function BudgetCreator({
  state,
  actions,
  month
}: {
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  month: string;
}) {
  const budgetedCategoryIds = new Set(state.budgets.filter((budget) => budget.active).map((budget) => budget.categoryId));
  const availableCategories = getCategoryOptions(state.categories).filter((category) => !budgetedCategoryIds.has(category.id));
  const budgetableCategories = availableCategories.filter(isBudgetableCategory);
  const [categoryId, setCategoryId] = useState(budgetableCategories[0]?.id ?? "cat_uncategorized");
  const [amountUyu, setAmountUyu] = useState("0");
  const [mode, setMode] = useState<Budget["mode"]>("reset");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!categoryId || Number(amountUyu) <= 0) return;
    actions.addBudget({
      categoryId,
      amountUyu: Number(amountUyu),
      mode,
      active: true,
      startsAtMonth: month
    });
    setAmountUyu("0");
  }

  return (
    <form className="budgetCreator" onSubmit={submit}>
      <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
        {budgetableCategories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.parentId ? "• " : ""}
            {category.name}
          </option>
        ))}
      </select>
      <input type="number" min="0" step="100" value={amountUyu} onChange={(event) => setAmountUyu(event.target.value)} />
      <select value={mode} onChange={(event) => setMode(event.target.value as Budget["mode"])}>
        <option value="reset">Reset</option>
        <option value="rollover">Rollover</option>
      </select>
      <button className="primaryButton small" type="submit">
        <Plus size={16} />
        Budget
      </button>
    </form>
  );
}

function AnalyticsView({ state, month }: { state: AppState; month: string }) {
  const transactions = useMemo(() => getMonthTransactions(state.transactions, month), [state.transactions, month]);
  const summary = useMemo(() => getMonthSummary(state.transactions, month), [state.transactions, month]);
  const categorySpend = useMemo(() => getCategorySpendRows(transactions, state.categories), [transactions, state.categories]);
  const topSpend = useMemo(() => groupSmallSpendRows(categorySpend, 8), [categorySpend]);
  const productSpend = useMemo(() => getProductSpendRows(transactions), [transactions]);
  const itauSavingsUyu = useMemo(() => getReceiptSavingsUyu(transactions, "Itaú"), [transactions]);

  return (
    <div className="analyticsView">
      <div className="monthSummaryStrip">
        <Metric label="Ingreso total" value={formatMoney(summary.incomeUyu)} accent="green" />
        <Metric label="Gasto total" value={formatMoney(summary.expenseUyu)} accent="coral" />
        <Metric label="Ahorro/neto" value={formatMoney(summary.netUyu)} accent={summary.netUyu >= 0 ? "green" : "red"} />
        <Metric label="Categorías" value={String(categorySpend.length)} accent="blue" />
        {itauSavingsUyu > 0 && <Metric label={<><ItauBadge compact /> Ahorro Itaú</>} value={formatMoney(itauSavingsUyu)} accent="green" />}
      </div>

      <div className="analyticsGrid">
        <div className="panel chartPanel">
          <div className="sectionTitle">
            <PieChart size={16} />
            <h2>Gastos por categoría</h2>
          </div>
          <ExpensePieChart rows={topSpend} />
        </div>

        <div className="panel chartPanel">
          <div className="sectionTitle">
            <ArrowDownUp size={16} />
            <h2>Flujo del mes</h2>
          </div>
          <SankeyFlow summary={summary} rows={groupSmallSpendRows(categorySpend, 6)} />
        </div>

        <div className="panel analyticsWide">
          <div className="sectionTitle">
            <BarChart3 size={16} />
            <h2>Ranking</h2>
          </div>
          <div className="analyticsRanking">
            {categorySpend.slice(0, 12).map((row, index) => (
              <div className="rankingRow" key={row.category.id}>
                <span>{index + 1}</span>
                <i style={{ background: row.category.color }} />
                <strong>{row.category.name}</strong>
                <div>
                  <b style={{ width: `${Math.min(100, row.percent)}%`, background: row.category.color }} />
                </div>
                <em>{formatMoney(row.amountUyu)}</em>
              </div>
            ))}
          </div>
        </div>

        {productSpend.length > 0 && (
          <div className="panel analyticsWide">
            <div className="sectionTitle">
              <ReceiptText size={16} />
              <h2>Productos</h2>
            </div>
            <div className="productRanking">
              {productSpend.slice(0, 12).map((row) => (
                <div className="productRow" key={row.key}>
                  <strong>{row.description}</strong>
                  <span>{row.merchant}</span>
                  <em>{formatQuantity(row.quantity)} un.</em>
                  <i>{row.discountUyu > 0 ? `-${formatMoney(row.discountUyu)}` : ""}</i>
                  <b>{formatMoney(row.amountUyu)}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExpensePieChart({ rows }: { rows: CategorySpendRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.amountUyu, 0);
  if (!total) return <EmptyState text="Sin gastos para graficar" />;

  const segments = buildPieSegments(rows, total);

  return (
    <div className="pieLayout">
      <svg viewBox="0 0 220 220" role="img" aria-label="Gastos por categoría">
        <circle cx="110" cy="110" r="74" fill="#f1ece5" />
        {segments.map((segment) => (
          <path key={segment.label} d={segment.path} fill={segment.color} />
        ))}
        <circle cx="110" cy="110" r="46" fill="#fffdfa" />
        <text x="110" y="104" textAnchor="middle" className="pieTotalLabel">
          Total
        </text>
        <text x="110" y="126" textAnchor="middle" className="pieTotalValue">
          {formatMoney(total)}
        </text>
      </svg>
      <div className="chartLegend">
        {rows.map((row) => (
          <div key={row.category.id}>
            <span style={{ background: row.category.color }} />
            <strong>{row.category.name}</strong>
            <em>{formatPercent((row.amountUyu / total) * 100)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function SankeyFlow({ summary, rows }: { summary: ReturnType<typeof getMonthSummary>; rows: CategorySpendRow[] }) {
  const expenseTotal = rows.reduce((sum, row) => sum + row.amountUyu, 0);
  const basis = Math.max(summary.incomeUyu, expenseTotal, 1);
  const remaining = normalizeMoney(summary.incomeUyu - summary.expenseUyu + summary.refundUyu);
  const netRow = {
    id: "net",
    label: remaining >= 0 ? "Ahorro / resto" : "Déficit",
    amount: Math.abs(remaining),
    color: remaining >= 0 ? "#2f855a" : "#c2410c"
  };
  const flowRows = [
    ...rows.map((row) => ({
      id: row.category.id,
      label: row.category.name,
      amount: row.amountUyu,
      color: row.category.color
    })),
    netRow
  ].filter((row) => row.amount > 0);
  const height = Math.max(260, flowRows.length * 48 + 74);
  let cursor = 38;

  return (
    <div className="sankeyBox">
      <svg viewBox={`0 0 640 ${height}`} role="img" aria-label="Flujo del mes">
        <rect x="18" y="36" width="122" height={height - 72} rx="8" fill="#2f855a" opacity="0.14" />
        <text x="34" y="68" className="sankeyLabel">
          Ingresos
        </text>
        <text x="34" y="94" className="sankeyValue">
          {formatMoney(summary.incomeUyu)}
        </text>
        {flowRows.map((row) => {
          const strokeWidth = Math.max(8, Math.min(52, (row.amount / basis) * 120));
          const y = cursor + strokeWidth / 2;
          cursor += Math.max(46, strokeWidth + 18);
          return (
            <g key={row.id}>
              <path
                d={`M 140 ${height / 2} C 262 ${height / 2}, 250 ${y}, 356 ${y}`}
                fill="none"
                stroke={row.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                opacity="0.82"
              />
              <rect x="366" y={y - 18} width="250" height="36" rx="8" fill="#fffdfa" stroke="#ded7ce" />
              <circle cx="384" cy={y} r="6" fill={row.color} />
              <text x="400" y={y - 3} className="sankeyItem">
                {truncateLabel(row.label, 22)}
              </text>
              <text x="604" y={y + 5} textAnchor="end" className="sankeyAmount">
                {formatMoney(row.amount)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MonthTransactionList({
  transactions,
  state,
  actions
}: {
  transactions: Transaction[];
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = transactions.find((transaction) => transaction.id === selectedId) ?? null;

  if (transactions.length === 0) return <EmptyState text="Sin movimientos para estos filtros" />;

  return (
    <div className="monthTransactionList">
      {transactions.map((transaction) => {
        const category = state.categories.find((item) => item.id === transaction.splits[0]?.categoryId);
        const account = state.accounts.find((item) => item.id === transaction.accountId);
        const lineItemsLabel = formatLineItemsPreview(transaction);
        const amountTone =
          transaction.type === "expense" || transaction.transferDirection === "outgoing"
            ? "negative"
            : transaction.type === "adjustment"
              ? "neutral"
              : "positive";

        return (
          <article
            className="monthTransactionRow clickable"
            key={transaction.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedId(transaction.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedId(transaction.id);
              }
            }}
          >
            <time dateTime={transaction.date}>{formatShortDate(transaction.date)}</time>
            <div className="monthTransactionMain">
              <strong title={transaction.payee}>{transaction.payee || formatTransactionType(transaction)}</strong>
              <span>
                <i style={{ background: category?.color ?? "#94a3b8" }} />
                {category?.name ?? "Sin categoría"} · {account?.name ?? "Sin cuenta"}
                {lineItemsLabel ? ` · ${lineItemsLabel}` : ""}
              </span>
            </div>
            <span className="monthTransactionType">{formatTransactionType(transaction)}</span>
            <b className={amountTone}>{formatMoney(transaction.amount, transaction.currency)}</b>
          </article>
        );
      })}
      {selected && (
        <TransactionDetailModal
          transaction={selected}
          state={state}
          onClose={() => setSelectedId(null)}
          onDelete={() => {
            actions.deleteTransaction(selected.id);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}

function BudgetRow({ usage, actions }: { usage: BudgetUsage; actions: ReturnType<typeof useFinanceStore>["actions"] }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(usage.budget.amountUyu));

  return (
    <article className={`budgetRow ${usage.state}`}>
      <div className="budgetHeader">
        <span className="categoryDot" style={{ background: usage.category.color }} />
        <strong>{usage.category.name}</strong>
        <button className="pillButton" onClick={() => actions.updateBudget(usage.budget.id, { mode: usage.mode === "reset" ? "rollover" : "reset" })}>
          {usage.mode}
        </button>
      </div>
      <div className="budgetBar">
        <span style={{ width: `${Math.min(100, usage.percent)}%` }} />
      </div>
      <div className="budgetMeta">
        <span>{formatMoney(usage.spentUyu)} / {formatMoney(usage.allowanceUyu)}</span>
        <strong>{usage.remainingUyu >= 0 ? `${formatMoney(usage.remainingUyu)} queda` : `${formatMoney(Math.abs(usage.remainingUyu))} excedido`}</strong>
      </div>
      {editing ? (
        <div className="inlineEdit">
          <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <button
            className="iconButton success"
            title="Guardar budget"
            onClick={() => {
              actions.updateBudget(usage.budget.id, { amountUyu: Number(amount) || 0 });
              setEditing(false);
            }}
          >
            <Check size={16} />
          </button>
        </div>
      ) : (
        <button className="textButton" onClick={() => setEditing(true)}>
          Editar
        </button>
      )}
    </article>
  );
}

function AccountsView({
  state,
  actions,
  balances
}: {
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  balances: AccountBalance[];
}) {
  const activeBalances = balances.filter(({ account }) => account.active);
  const hiddenBalances = balances.filter(({ account }) => !account.active);
  const [selectedAccountId, setSelectedAccountId] = useState(activeBalances[0]?.account.id ?? balances[0]?.account.id ?? "");
  const selectedBalance = balances.find(({ account }) => account.id === selectedAccountId) ?? activeBalances[0] ?? balances[0];
  const selectedTransactions = useMemo(
    () => getTransactionsForAccount(state.transactions, selectedBalance?.account.id ?? ""),
    [state.transactions, selectedBalance?.account.id]
  );

  useEffect(() => {
    if (!balances.length || balances.some(({ account }) => account.id === selectedAccountId)) return;
    setSelectedAccountId(activeBalances[0]?.account.id ?? balances[0]?.account.id ?? "");
  }, [activeBalances, balances, selectedAccountId]);

  return (
    <div className="accountsView">
      <div className="accountsToolbar">
        <Metric label="Cuentas visibles" value={String(activeBalances.length)} accent="blue" />
        <Metric label="Ocultas" value={String(hiddenBalances.length)} accent="coral" />
        <Metric label="Disponible visible" value={formatMoney(activeBalances.reduce((total, item) => total + item.balanceUyu, 0))} accent="green" />
      </div>

      <div className="accountsGrid">
        {activeBalances.map((balance) => (
          <AccountCard
            key={balance.account.id}
            balance={balance}
            actions={actions}
            selected={balance.account.id === selectedBalance?.account.id}
            onSelect={() => setSelectedAccountId(balance.account.id)}
          />
        ))}
      </div>

      {selectedBalance && <AccountTransactionsPanel state={state} actions={actions} balance={selectedBalance} transactions={selectedTransactions} />}

      {hiddenBalances.length > 0 && (
        <div className="panel hiddenAccountsPanel">
          <div className="sectionTitle">
            <EyeOff size={16} />
            <h2>Ocultas</h2>
          </div>
          <div className="hiddenAccountsList">
            {hiddenBalances.map((balance) => (
              <div className={balance.account.id === selectedBalance?.account.id ? "hiddenAccountRow selected" : "hiddenAccountRow"} key={balance.account.id}>
                <span style={{ background: balance.account.color }} />
                <strong>{balance.account.name}</strong>
                <em>{formatMoney(balance.balance, balance.account.currency)}</em>
                <button
                  className="iconButton"
                  title="Ver movimientos"
                  onClick={() => setSelectedAccountId(balance.account.id)}
                >
                  <ReceiptText size={16} />
                </button>
                <button
                  className="iconButton"
                  title="Desocultar cuenta"
                  onClick={() => actions.updateAccountActive(balance.account.id, true)}
                >
                  <Eye size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountCard({
  balance,
  actions,
  selected,
  onSelect
}: {
  balance: AccountBalance;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={selected ? "accountCard selected" : "accountCard"}>
      <div className="accountHeader">
        <span style={{ background: balance.account.color }}>
          <Landmark size={18} />
        </span>
        <div>
          <strong>{balance.account.name}</strong>
          <em>{balance.account.institution}</em>
        </div>
        <div className="accountCardActions">
          <button className="iconButton" title="Ver movimientos" onClick={onSelect}>
            <ReceiptText size={16} />
          </button>
          <button className="iconButton" title="Ocultar cuenta" onClick={() => actions.updateAccountActive(balance.account.id, false)}>
            <EyeOff size={16} />
          </button>
        </div>
      </div>
      <div className="accountBalance">{formatMoney(balance.balance, balance.account.currency)}</div>
      <div className="accountMeta">
        <span>{formatMoney(balance.balanceUyu)} UYU equiv.</span>
        <span>{balance.lastMovement?.payee ?? "Sin movimientos"}</span>
      </div>
      <label>
        Saldo inicial
        <input
          type="number"
          step="0.01"
          value={balance.account.initialBalance}
          onChange={(event) => actions.updateAccountInitialBalance(balance.account.id, Number(event.target.value) || 0)}
        />
      </label>
    </article>
  );
}

function AccountTransactionsPanel({
  state,
  actions,
  balance,
  transactions
}: {
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  balance: AccountBalance;
  transactions: Transaction[];
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | TransactionType>("");
  const filteredTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return transactions.filter((transaction) => {
      const category = state.categories.find((item) => item.id === transaction.splits[0]?.categoryId);
      const haystack = `${transaction.payee} ${transaction.note} ${category?.name ?? ""}`.toLowerCase();
      return (!normalizedQuery || haystack.includes(normalizedQuery)) && (!type || transaction.type === type);
    });
  }, [transactions, state.categories, query, type]);
  const summary = useMemo(() => getAccountTransactionSummary(filteredTransactions, balance.account), [filteredTransactions, balance.account]);

  return (
    <div className="panel accountTransactionsPanel">
      <div className="sectionTitle">
        <ArrowDownUp size={16} />
        <h2>Movimientos de {balance.account.name}</h2>
        <span className="panelCounter">{filteredTransactions.length} de {transactions.length}</span>
      </div>

      <div className="accountTransactionMetrics">
        <Metric label="Entradas" value={formatMoney(summary.incoming, balance.account.currency)} accent="green" />
        <Metric label="Salidas" value={formatMoney(summary.outgoing, balance.account.currency)} accent="coral" />
        <Metric label="Neto" value={formatMoney(summary.net, balance.account.currency)} accent={summary.net >= 0 ? "green" : "red"} />
        <Metric label="Saldo actual" value={formatMoney(balance.balance, balance.account.currency)} accent="blue" />
      </div>

      <div className="filters accountTransactionFilters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en esta wallet" />
        <select value={type} onChange={(event) => setType(event.target.value as "" | TransactionType)}>
          <option value="">Todos los tipos</option>
          <option value="expense">Gastos</option>
          <option value="income">Ingresos</option>
          <option value="transfer">Transferencias</option>
          <option value="adjustment">Ajustes</option>
          <option value="refund">Reembolsos</option>
        </select>
      </div>

      <AccountTransactionList transactions={filteredTransactions} state={state} actions={actions} account={balance.account} />
    </div>
  );
}

function AccountTransactionList({
  transactions,
  state,
  actions,
  account
}: {
  transactions: Transaction[];
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
  account: AppState["accounts"][number];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = transactions.find((transaction) => transaction.id === selectedId) ?? null;

  if (transactions.length === 0) return <EmptyState text="Sin movimientos para esta wallet" />;

  return (
    <div className="accountTransactionList">
      {transactions.map((transaction) => {
        const category = state.categories.find((item) => item.id === transaction.splits[0]?.categoryId);
        const impact = getAccountTransactionImpact(transaction, account);
        const amountTone = impact < 0 ? "negative" : impact > 0 ? "positive" : "neutral";
        const lineItemsLabel = formatLineItemsPreview(transaction);

        return (
          <article
            className="accountTransactionRow clickable"
            key={transaction.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedId(transaction.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedId(transaction.id);
              }
            }}
          >
            <time dateTime={transaction.date}>{formatShortDate(transaction.date)}</time>
            <div className="accountTransactionMain">
              <strong title={transaction.payee}>{transaction.payee || formatTransactionType(transaction)}</strong>
              <span>
                <i style={{ background: category?.color ?? "#94a3b8" }} />
                {category?.name ?? "Sin categoría"} · {formatAccountTransactionRoute(transaction, state)}
                {lineItemsLabel ? ` · ${lineItemsLabel}` : ""}
              </span>
            </div>
            <span className="accountTransactionType">{formatTransactionTypeForAccount(transaction, account.id)}</span>
            <b className={amountTone}>{formatSignedMoney(impact, account.currency)}</b>
          </article>
        );
      })}
      {selected && (
        <TransactionDetailModal
          transaction={selected}
          state={state}
          onClose={() => setSelectedId(null)}
          onDelete={() => {
            actions.deleteTransaction(selected.id);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}

function TransactionDetailModal({
  transaction,
  state,
  onClose,
  onDelete
}: {
  transaction: Transaction;
  state: AppState;
  onClose: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleDelete() {
    if (!window.confirm(`Borrar "${transaction.payee}" por ${formatMoney(transaction.amount, transaction.currency)}?`)) return;
    onDelete();
  }

  const category = state.categories.find((item) => item.id === transaction.splits[0]?.categoryId);
  const account = state.accounts.find((item) => item.id === transaction.accountId);
  const toAccount = state.accounts.find((item) => item.id === transaction.toAccountId);
  const paymentLabel = paymentMethods.find((method) => method.value === transaction.paymentMethod)?.label ?? "—";
  const amountTone =
    transaction.type === "expense" || transaction.transferDirection === "outgoing"
      ? "negative"
      : transaction.type === "adjustment"
        ? "neutral"
        : "positive";
  const tagIds = Array.from(new Set(transaction.splits.flatMap((split) => split.tagIds)));
  const tags = tagIds.map((id) => state.tags.find((tag) => tag.id === id)).filter((tag): tag is AppState["tags"][number] => Boolean(tag));

  const details: Array<{ label: string; value: string }> = [
    { label: "Fecha", value: formatLongDate(transaction.date) },
    { label: "Tipo", value: formatTransactionType(transaction) },
    { label: "Cuenta", value: account?.name ?? "Sin cuenta" },
    { label: "Método", value: paymentLabel },
    { label: "Moneda", value: transaction.currency }
  ];
  if (transaction.type === "transfer") {
    details.push({
      label: "Ruta",
      value: formatAccountTransactionRoute(transaction, state)
    });
  } else if (toAccount) {
    details.push({ label: "Destino", value: toAccount.name });
  }
  if (transaction.currency === "USD") {
    details.push({ label: "Tasa banco", value: String(transaction.fxRateToUyu) });
    details.push({ label: "Equivalente", value: formatMoney(transaction.amountUyu) });
  }
  if (transaction.note) details.push({ label: "Nota", value: transaction.note });
  if (transaction.source) details.push({ label: "Fuente", value: formatSourceLabel(transaction.source) });

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-label={`Detalle de ${transaction.payee || formatTransactionType(transaction)}`} onClick={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div className="modalHeaderMain">
            <span className="modalCategoryDot" style={{ background: category?.color ?? "#94a3b8" }} />
            <div>
              <h2>{transaction.payee || formatTransactionType(transaction)}</h2>
              <span>{category?.name ?? "Sin categoría"}</span>
            </div>
          </div>
          <button className="iconButton" type="button" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="modalAmountRow">
          <b className={amountTone}>{formatMoney(transaction.amount, transaction.currency)}</b>
          <span className="monthTransactionType">{formatTransactionType(transaction)}</span>
        </div>

        <dl className="modalDetails">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>

        {tags.length > 0 && (
          <div className="modalTags">
            <Tags size={15} />
            {tags.map((tag) => (
              <span className="tagChip" key={tag.id}>
                <span style={{ background: tag.color }} />
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {transaction.splits.length > 1 && (
          <div className="modalSection">
            <h3>Splits</h3>
            <div className="modalSplitList">
              {transaction.splits.map((split) => {
                const splitCategory = state.categories.find((item) => item.id === split.categoryId);
                return (
                  <div className="modalSplitRow" key={split.id}>
                    <span style={{ background: splitCategory?.color ?? "#94a3b8" }} />
                    <strong>{splitCategory?.name ?? "Sin categoría"}</strong>
                    <b>{formatMoney(split.amount, transaction.currency)}</b>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(transaction.lineItems?.length ?? 0) > 0 && (
          <div className="modalSection">
            <h3>Detalle ticket</h3>
            <div className="modalLineItems">
              {transaction.lineItems!.map((item) => (
                <div className="modalLineItem" key={item.id}>
                  <strong>{item.description || "Producto"}</strong>
                  <span>
                    {formatQuantity(item.quantity ?? 1)} un.
                    {item.discountAmount ? ` · ahorro ${formatMoney(item.discountAmount, transaction.currency)}` : ""}
                  </span>
                  <b>{formatMoney(item.amountUyu || item.amount, transaction.currency)}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modalActions">
          <button className="textButton danger" type="button" onClick={handleDelete}>
            <Trash2 size={16} />
            Borrar movimiento
          </button>
        </div>
      </div>
    </div>
  );
}

function TransactionTable({ transactions, state }: { transactions: Transaction[]; state: AppState }) {
  return (
    <div className="tableWrap">
      <table className="transactionTable">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Comercio</th>
            <th>Categoría</th>
            <th>Cuenta</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const category = state.categories.find((item) => item.id === transaction.splits[0]?.categoryId);
            const account = state.accounts.find((item) => item.id === transaction.accountId);
            return (
              <tr key={transaction.id}>
                <td>{transaction.date}</td>
                <td>{formatTransactionType(transaction)}</td>
                <td>{transaction.payee}</td>
                <td>{category?.name ?? "Sin categoría"}</td>
                <td>{account?.name ?? "Sin cuenta"}</td>
                <td>{formatMoney(transaction.amount, transaction.currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentTransactions({
  transactions,
  state,
  actions
}: {
  transactions: Transaction[];
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
}) {
  return (
    <div className="panel">
      <div className="sectionTitle">
        <ReceiptText size={16} />
        <h2>Últimos</h2>
      </div>
      <div className="recentList">
        {transactions.map((transaction) => (
          <RecentTransactionItem key={transaction.id} transaction={transaction} state={state} actions={actions} />
        ))}
      </div>
    </div>
  );
}

function RecentTransactionItem({
  transaction,
  state,
  actions
}: {
  transaction: Transaction;
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
}) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<TransactionType>(transaction.type);
  const [date, setDate] = useState(transaction.date);
  const [payee, setPayee] = useState(transaction.payee);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [currency, setCurrency] = useState<Currency>(transaction.currency);
  const [accountId, setAccountId] = useState(transaction.accountId);
  const [toAccountId, setToAccountId] = useState(transaction.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(transaction.splits[0]?.categoryId ?? "cat_sin_categorizar");
  const [note, setNote] = useState(transaction.note);

  const category = state.categories.find((item) => item.id === transaction.splits[0]?.categoryId);
  const lineItemsLabel = formatLineItemsPreview(transaction);
  const accountOptions = state.accounts.filter((account) => account.active || account.id === transaction.accountId || account.id === transaction.toAccountId);
  const categoryOptions = type === "transfer" ? getCategoryOptions(state.categories) : getManualCategoryOptions(state.categories);

  function cancelEdit() {
    setType(transaction.type);
    setDate(transaction.date);
    setPayee(transaction.payee);
    setAmount(String(transaction.amount));
    setCurrency(transaction.currency);
    setAccountId(transaction.accountId);
    setToAccountId(transaction.toAccountId ?? "");
    setCategoryId(transaction.splits[0]?.categoryId ?? "cat_sin_categorizar");
    setNote(transaction.note);
    setEditing(false);
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    const numericAmount = Number(amount) || 0;
    if (!numericAmount || !accountId || !categoryId) return;

    actions.updateTransaction(transaction.id, {
      type,
      date,
      accountId,
      toAccountId: type === "transfer" ? toAccountId || undefined : undefined,
      transferDirection: type === "transfer" ? transaction.transferDirection ?? "outgoing" : undefined,
      payee,
      note,
      currency,
      amount: numericAmount,
      fxRateToUyu: currency === "USD" ? transaction.fxRateToUyu || 40 : 1,
      fxSource: currency === "USD" ? transaction.fxSource : "not_applicable",
      paymentMethod: type === "transfer" ? "transfer" : transaction.paymentMethod,
      splits: buildRecentEditSplits(transaction, numericAmount, categoryId),
      lineItems: transaction.lineItems?.map(
        ({ description, quantity, unitPrice, originalAmount, discountAmount, discountSource, shippingAmount, amount, categoryId, tagIds, confidence }) => ({
        description,
        quantity,
        unitPrice,
        originalAmount,
        discountAmount,
        discountSource,
        shippingAmount,
        amount,
        categoryId,
        tagIds,
        confidence
      }))
    });
    setEditing(false);
  }

  function deleteItem() {
    if (!window.confirm(`Borrar "${transaction.payee}" por ${formatMoney(transaction.amount, transaction.currency)}?`)) return;
    actions.deleteTransaction(transaction.id);
  }

  if (editing) {
    return (
      <form className="recentEditCard" onSubmit={submitEdit}>
        <div className="compactGrid">
          <select value={type} onChange={(event) => setType(event.target.value as TransactionType)} aria-label="Tipo">
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
            <option value="transfer">Transferencia</option>
            <option value="adjustment">Ajuste</option>
            <option value="refund">Reembolso</option>
          </select>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Fecha" />
          <select
            value={currency}
            onChange={(event) => {
              const nextCurrency = event.target.value as Currency;
              setCurrency(nextCurrency);
              const nextAccountId = getDefaultAccountId(state.accounts, nextCurrency) || accountOptions.find((account) => account.currency === nextCurrency)?.id || "";
              setAccountId(nextAccountId);
            }}
            aria-label="Moneda"
          >
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <input value={payee} onChange={(event) => setPayee(event.target.value)} aria-label="Comercio" />
        <div className="compactGrid">
          <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Monto" />
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Cuenta">
            {accountOptions
              .filter((account) => account.currency === currency)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="Categoría">
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.parentId ? "• " : ""}
                {option.name}
              </option>
            ))}
          </select>
        </div>
        {type === "transfer" && (
          <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} aria-label="Destino">
            <option value="">Sin destino enlazado</option>
            {accountOptions
              .filter((account) => account.id !== accountId)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        )}
        <input value={note} onChange={(event) => setNote(event.target.value)} aria-label="Nota" />
        {transaction.splits.length > 1 && categoryId === transaction.splits[0]?.categoryId && (
          <span className="muted">Conserva {transaction.splits.length} splits proporcionalmente.</span>
        )}
        <div className="recentEditActions">
          <button className="primaryButton small" type="submit">
            <Save size={15} />
            Guardar
          </button>
          <button className="textButton" type="button" onClick={cancelEdit}>
            <X size={15} />
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="recentItem">
      <span style={{ background: category?.color ?? "#94a3b8" }} />
      <div>
        <strong>{transaction.payee}</strong>
        <em>{lineItemsLabel ? `${category?.name ?? transaction.type} · ${lineItemsLabel}` : (category?.name ?? transaction.type)}</em>
      </div>
      <b>{formatMoney(transaction.amount, transaction.currency)}</b>
      <div className="recentActions">
        <button className="iconButton" type="button" title="Editar movimiento" onClick={() => setEditing(true)}>
          <Pencil size={15} />
        </button>
        <button className="iconButton danger" type="button" title="Borrar movimiento" onClick={deleteItem}>
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

function Placeholder({ icon, title }: { icon: ReactElement; title: string }) {
  return (
    <section className="placeholder">
      <div className="placeholderIcon">{icon}</div>
      <h1>{title}</h1>
      <p>Preparado para la próxima etapa.</p>
    </section>
  );
}

function AgentWorkspace({
  state,
  actions
}: {
  state: AppState;
  actions: ReturnType<typeof useFinanceStore>["actions"];
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentHealth, setAgentHealth] = useState<AgentHealth | undefined>();
  const [agentRuntimeError, setAgentRuntimeError] = useState("");
  const [activeConversationId, setActiveConversationId] = useState(() => state.agentConversations[0]?.id ?? "");
  const conversations = state.agentConversations;
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0];
  const messages = activeConversation?.messages?.length ? activeConversation.messages : [transientAgentWelcome];
  const summary = useMemo(() => getMonthSummary(state.transactions, monthKey(todayIso())), [state.transactions]);

  useEffect(() => {
    let cancelled = false;
    getAgentHealth()
      .then((health) => {
        if (!cancelled) setAgentHealth(health);
      })
      .catch(() => {
        if (!cancelled) setAgentHealth(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeConversation) return;
    if (conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
      return;
    }
    if (activeConversationId) setActiveConversationId("");
  }, [activeConversation, activeConversationId, conversations]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const conversation = activeConversation ?? createAgentConversation();
    if (!activeConversation) {
      actions.upsertAgentConversation(conversation);
      setActiveConversationId(conversation.id);
    }

    const userMessage = createAgentConversationMessage("user", trimmed);
    actions.appendAgentMessage(conversation.id, userMessage);
    setQuestion("");
    setLoading(true);

    try {
      const answer = agentHealth?.configured
        ? await askRemoteFinanceAgent(trimmed, conversation.id, conversation.messages)
        : buildOfflineAgentAnswer(trimmed, state, "Falta configurar OPENAI_API_KEY en el servidor.");
      setAgentRuntimeError("");
      actions.appendAgentMessage(conversation.id, createAgentConversationMessage("assistant", answer.answer, answer));
    } catch (error) {
      const reason = formatAgentFailure(error);
      setAgentRuntimeError(reason);
      const answer = buildOfflineAgentAnswer(trimmed, state, reason);
      actions.appendAgentMessage(conversation.id, createAgentConversationMessage("assistant", answer.answer, answer, true));
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(question);
  }

  const prompts = [
    "¿Cuánto gasté en mi último viaje a Europa?",
    "Graficá mis gastos por categoría este mes",
    "¿Cuál fue mi salario este mes?",
    "Dame mis salarios durante todo este año"
  ];
  const engineLabel = getAgentEngineLabel(agentHealth, agentRuntimeError);
  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section className="workspace agentWorkspace">
      <header className="topBar">
        <div>
          <span className="eyebrow">Agente</span>
          <h1>Preguntas directas sobre tu plata.</h1>
        </div>
        <div className="topMetrics">
          <Metric label="Movimientos" value={String(state.transactions.length)} accent="blue" />
          <Metric label="Gasto mes" value={formatMoney(summary.expenseUyu)} accent="coral" />
          <Metric label="Motor" value={engineLabel.short} accent={agentHealth?.configured && !agentRuntimeError ? "green" : "red"} />
        </div>
      </header>

      <div className="agentLayout">
        <aside className="panel agentSidePanel agentHistoryPanel">
          <div className="sectionTitle">
            <Bot size={16} />
            <h2>Conversaciones</h2>
            <button className="iconButton" type="button" title="Descargar logs de la conversación" onClick={() => downloadAgentLogs(conversations, agentHealth)}>
              <Download size={16} />
            </button>
            <button className="iconButton" type="button" title="Nuevo chat" onClick={() => startNewAgentConversation(actions, setActiveConversationId)}>
              <Plus size={16} />
            </button>
          </div>
          <div className={`agentStatusCard ${agentHealth?.configured && !agentRuntimeError ? "online" : "offline"}`}>
            <strong>{engineLabel.long}</strong>
            <span>{agentRuntimeError || (agentHealth?.configured ? agentHealth.model : "Usa fallback local hasta configurar la key")}</span>
          </div>
          <div className="agentConversationList">
            {sortedConversations.map((conversation) => (
              <div className={conversation.id === activeConversation?.id ? "agentConversationRow active" : "agentConversationRow"} key={conversation.id}>
                <button type="button" onClick={() => setActiveConversationId(conversation.id)}>
                  <strong>{conversation.title}</strong>
                  <span>{formatConversationPreview(conversation)}</span>
                  <time>{formatConversationDate(conversation.updatedAt)}</time>
                </button>
                {sortedConversations.length > 1 && (
                  <button
                    className="iconButton danger"
                    type="button"
                    title="Borrar conversación"
                    onClick={() => {
                      actions.deleteAgentConversation(conversation.id);
                      if (conversation.id === activeConversation?.id) setActiveConversationId(sortedConversations.find((item) => item.id !== conversation.id)?.id ?? "");
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>

        <div className="panel agentChatPanel">
          <div className="agentQuickActions" aria-label="Preguntas rápidas">
            {prompts.map((prompt) => (
              <button className="textButton" type="button" key={prompt} onClick={() => ask(prompt)}>
                {prompt}
              </button>
            ))}
          </div>

          <div className="chatLog" aria-live="polite">
            {messages.map((message) => (
              <div className={`chatMessage ${message.role}${message.error ? " error" : ""}`} key={message.id}>
                {message.answer ? <AgentAnswerCard answer={message.answer} onAsk={ask} /> : <p>{message.content}</p>}
              </div>
            ))}
            {loading && (
              <div className="chatMessage assistant">
                <p>Pensando y consultando tus datos...</p>
              </div>
            )}
          </div>

          <form className="agentComposer" onSubmit={submit}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={2}
              placeholder="Escribí una pregunta"
              aria-label="Pregunta para el agente"
            />
            <button className="primaryButton agentSendButton" type="submit" aria-label="Enviar pregunta" disabled={loading}>
              <Send size={19} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function AgentAnswerCard({ answer, onAsk }: { answer: AgentAnswer; onAsk: (question: string) => void }) {
  const agentName = answer.agentName ?? (answer.mode === "offline" ? "Analista local" : "Orquestador financiero");

  return (
    <div className="agentAnswer">
      <div className="agentAnswerHeader">
        <Sparkles size={16} />
        <div>
          <strong>{answer.title}</strong>
          <span>Respondió: {agentName}</span>
        </div>
        <span>Confianza {answer.confidence}</span>
      </div>
      <p>{answer.answer}</p>

      {answer.facts.length > 0 && (
        <div className="agentFacts">
          {answer.facts.map((fact) => (
            <div className={`agentFact ${fact.tone ?? "neutral"}`} key={`${fact.label}-${fact.value}`}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </div>
      )}

      {answer.chart && <AgentChartView chart={answer.chart} />}

      {answer.rows.length > 0 && (
        <div className="agentEvidenceRows">
          {answer.rows.map((row) => (
            <div className="agentEvidenceRow" key={`${row.date}-${row.title}-${row.amount}`}>
              <time>{row.date}</time>
              <div>
                <strong>{row.title}</strong>
                <span>{row.meta}</span>
              </div>
              <b className={row.tone ?? "neutral"}>{row.amount}</b>
            </div>
          ))}
        </div>
      )}

      {answer.suggestions.length > 0 && (
        <div className="agentSuggestions">
          {answer.suggestions.slice(0, 3).map((suggestion) => (
            <button className="textButton" type="button" key={suggestion} onClick={() => onAsk(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentChartView({ chart }: { chart: AgentChart }) {
  const points = chart.points.filter((point) => Number.isFinite(point.value)).slice(0, 12);
  if (points.length === 0) return null;
  const Icon = chart.type === "pie" ? PieChart : BarChart3;

  return (
    <div className="agentChart">
      <div className="agentChartHeader">
        <Icon size={16} />
        <div>
          <strong>{chart.title}</strong>
          {chart.subtitle && <span>{chart.subtitle}</span>}
        </div>
        {chart.totalFormatted && <b>{chart.totalFormatted}</b>}
      </div>
      {chart.type === "pie" ? <AgentPieChart chart={chart} points={points} /> : chart.type === "line" ? <AgentLineChart points={points} /> : <AgentBarChart points={points} />}
    </div>
  );
}

function AgentBarChart({ points }: { points: AgentChartPoint[] }) {
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 1);

  return (
    <div className="agentBarChart">
      {points.map((point, index) => (
        <div className="agentBarRow" key={`${point.label}-${index}`}>
          <span title={point.label}>{truncateLabel(point.label, 26)}</span>
          <div aria-hidden="true">
            <i style={{ width: `${Math.max(3, (Math.abs(point.value) / max) * 100)}%`, background: point.color ?? "#2b6cb0" }} />
          </div>
          <strong>{point.valueFormatted}</strong>
        </div>
      ))}
    </div>
  );
}

function AgentLineChart({ points }: { points: AgentChartPoint[] }) {
  const width = 640;
  const height = 240;
  const padding = 34;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: padding + index * step,
    y: height - padding - ((point.value - min) / span) * (height - padding * 2),
    point
  }));
  const path = coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ");
  const labelStride = points.length > 8 ? 2 : 1;

  return (
    <div className="agentLineChart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico de línea del agente">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#ded7ce" strokeWidth="2" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#ded7ce" strokeWidth="2" />
        <path d={path} fill="none" stroke="#2b6cb0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((coord, index) => (
          <g key={`${coord.point.label}-${index}`}>
            <title>{`${coord.point.label}: ${coord.point.valueFormatted}`}</title>
            <circle cx={coord.x} cy={coord.y} r="5" fill={coord.point.color ?? "#2b6cb0"} stroke="#fffdfa" strokeWidth="3" />
            {(index % labelStride === 0 || index === points.length - 1) && (
              <text x={coord.x} y={height - 10} textAnchor="middle" className="agentAxisLabel">
                {truncateLabel(coord.point.label, 12)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function AgentPieChart({ chart, points }: { chart: AgentChart; points: AgentChartPoint[] }) {
  const total = points.reduce((sum, point) => sum + Math.abs(point.value), 0);
  if (!total) return <EmptyState text="Sin datos para graficar" />;
  const segments = buildAgentPieSegments(points, total);

  return (
    <div className="agentPieLayout">
      <svg viewBox="0 0 220 220" role="img" aria-label="Gráfico de torta del agente">
        <circle cx="110" cy="110" r="74" fill="#f1ece5" />
        {segments.map((segment) => (
          <path key={segment.label} d={segment.path} fill={segment.color} />
        ))}
        <circle cx="110" cy="110" r="46" fill="#fffdfa" />
        <text x="110" y="105" textAnchor="middle" className="pieTotalLabel">
          {chart.valueLabel ?? "Total"}
        </text>
        {chart.totalFormatted && (
          <text x="110" y="126" textAnchor="middle" className="agentPieValue">
            {truncateLabel(chart.totalFormatted, 16)}
          </text>
        )}
      </svg>
      <div className="agentChartLegend">
        {points.map((point, index) => (
          <div key={`${point.label}-${index}`}>
            <span style={{ background: point.color ?? "#2b6cb0" }} />
            <strong>{point.label}</strong>
            <em>{point.valueFormatted}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildOfflineAgentAnswer(question: string, state: AppState, reason: string): AgentAnswer {
  const answer = askFinanceAgent(question, state, todayIso());
  return {
    ...answer,
    title: `Modo offline: ${answer.title}`,
    answer: `${reason} Te dejo una respuesta offline: ${answer.answer}`,
    agentName: "Analista local",
    mode: "offline",
    toolCalls: [{ name: "offline_fallback", summary: "respuesta local limitada" }]
  };
}

function startNewAgentConversation(
  actions: ReturnType<typeof useFinanceStore>["actions"],
  setActiveConversationId: (conversationId: string) => void
) {
  const conversation = createAgentConversation();
  actions.upsertAgentConversation(conversation);
  setActiveConversationId(conversation.id);
}

function createAgentConversation(): AgentConversation {
  const now = new Date().toISOString();
  return {
    id: createAgentMessageId("conversation"),
    title: "Nueva conversación",
    createdAt: now,
    updatedAt: now,
    messages: [createAgentConversationMessage("assistant", "Listo. Puedo consultar tus movimientos con herramientas financieras y responder con evidencia.")]
  };
}

function createAgentConversationMessage(
  role: AgentConversationMessage["role"],
  content: string,
  answer?: AgentAnswer,
  error = false
): AgentConversationMessage {
  return {
    id: createAgentMessageId(role),
    role,
    content,
    answer,
    error,
    createdAt: new Date().toISOString()
  };
}

function formatConversationPreview(conversation: AgentConversation): string {
  const lastUserMessage = [...conversation.messages].reverse().find((message) => message.role === "user");
  const fallback = conversation.messages[conversation.messages.length - 1];
  return truncateLabel(lastUserMessage?.content || fallback?.content || "Sin mensajes", 64);
}

function formatConversationDate(value: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getAgentEngineLabel(agentHealth: AgentHealth | undefined, runtimeError = "") {
  if (runtimeError) return { short: "Error", long: "OpenAI no disponible" };
  if (!agentHealth) return { short: "Chequeando", long: "Chequeando agente" };
  if (agentHealth.configured) return { short: "OpenAI", long: "Agente real conectado" };
  return { short: "Offline", long: "Falta API key" };
}

function formatAgentFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "No pude consultar OpenAI.";
  if (/no credits|credits remaining|billing/i.test(message)) {
    return "OpenAI respondió que no hay créditos disponibles en esa cuenta.";
  }
  if (/api key|401|unauthorized/i.test(message)) {
    return "OpenAI rechazó la API key configurada.";
  }
  return "No pude consultar OpenAI en este momento.";
}

function createAgentMessageId(role: string): string {
  return `agent_${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function Segmented({
  options,
  value,
  onChange
}: {
  options: Array<{ value: string; label: string; icon: ReactElement }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? "active" : ""} type="button" onClick={() => onChange(option.value)}>
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InlineAlert({ children }: { children: ReactNode }) {
  return (
    <div className="inlineAlert">
      <AlertTriangle size={16} />
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="emptyState">{text}</div>;
}

function normalizeSplitsForSubmit(
  splits: Array<Omit<TransactionSplit, "id" | "amountUyu">>,
  amount: number,
  fallbackCategoryId: string
): Array<Omit<TransactionSplit, "id" | "amountUyu">> {
  if (splits.length === 1) {
    return [
      {
        categoryId: splits[0]?.categoryId || fallbackCategoryId,
        tagIds: splits[0]?.tagIds ?? [],
        amount
      }
    ];
  }

  return splits.map((split) => ({
    categoryId: split.categoryId || fallbackCategoryId,
    tagIds: split.tagIds ?? [],
    amount: Number(split.amount) || 0
  }));
}

interface CategorySpendRow {
  category: Category;
  amountUyu: number;
  percent: number;
}

interface ProductSpendRow {
  key: string;
  description: string;
  merchant: string;
  count: number;
  quantity: number;
  amountUyu: number;
  discountUyu: number;
  shippingUyu: number;
}

function getCategorySpendRows(transactions: Transaction[], categories: Category[]): CategorySpendRow[] {
  const totals = new Map<string, number>();
  transactions.forEach((transaction) => {
    if (transaction.type !== "expense") return;
    transaction.splits.forEach((split) => {
      totals.set(split.categoryId, normalizeMoney((totals.get(split.categoryId) ?? 0) + split.amountUyu));
    });
  });

  const max = Math.max(1, ...Array.from(totals.values()));
  return Array.from(totals.entries())
    .map(([categoryId, amountUyu]) => ({
      category: categories.find((category) => category.id === categoryId) ?? categories.find((category) => category.id === "cat_uncategorized")!,
      amountUyu,
      percent: (amountUyu / max) * 100
    }))
    .sort((a, b) => b.amountUyu - a.amountUyu);
}

function getProductSpendRows(transactions: Transaction[]): ProductSpendRow[] {
  const rows = new Map<string, ProductSpendRow>();
  transactions.forEach((transaction) => {
    (transaction.lineItems ?? []).forEach((item) => {
      const key = normalizeLookupKey(`${item.description}|${transaction.payee}`);
      const current = rows.get(key) ?? {
        key,
        description: item.description,
        merchant: transaction.payee,
        count: 0,
        quantity: 0,
        amountUyu: 0,
        discountUyu: 0,
        shippingUyu: 0
      };
      const itemAmountUyu =
        item.amountUyu || toUyu(getReceiptLineItemTotal(item), transaction.currency, transaction.fxRateToUyu);
      current.count += 1;
      current.quantity = normalizeMoney(current.quantity + Number(item.quantity ?? 1));
      current.amountUyu = normalizeMoney(current.amountUyu + itemAmountUyu);
      current.discountUyu = normalizeMoney(
        current.discountUyu + toUyu(getReceiptLineItemDiscount(item), transaction.currency, transaction.fxRateToUyu)
      );
      current.shippingUyu = normalizeMoney(
        current.shippingUyu + toUyu(getReceiptLineItemShipping(item), transaction.currency, transaction.fxRateToUyu)
      );
      rows.set(key, current);
    });
  });

  return Array.from(rows.values()).sort((a, b) => b.amountUyu - a.amountUyu);
}

function getReceiptSavingsUyu(transactions: Transaction[], source?: string): number {
  const normalizedSource = source ? normalizeLookupKey(source) : "";
  return normalizeMoney(
    transactions.reduce((total, transaction) => {
      const itemSavings = (transaction.lineItems ?? []).reduce((lineTotal, item) => {
        const itemSource = normalizeLookupKey(item.discountSource ?? "");
        if (normalizedSource && !itemSource.includes(normalizedSource)) return lineTotal;
        return lineTotal + toUyu(getReceiptLineItemDiscount(item), transaction.currency, transaction.fxRateToUyu);
      }, 0);
      return total + itemSavings;
    }, 0)
  );
}

function groupSmallSpendRows(rows: CategorySpendRow[], maxRows: number): CategorySpendRow[] {
  if (rows.length <= maxRows) return rows;
  const visible = rows.slice(0, maxRows - 1);
  const rest = rows.slice(maxRows - 1);
  const restAmount = normalizeMoney(rest.reduce((sum, row) => sum + row.amountUyu, 0));
  const max = Math.max(1, ...visible.map((row) => row.amountUyu), restAmount);

  return [
    ...visible.map((row) => ({ ...row, percent: (row.amountUyu / max) * 100 })),
    {
      category: {
        id: "cat_otros_grafico",
        name: "Otros",
        color: "#64748b",
        icon: "circle"
      },
      amountUyu: restAmount,
      percent: (restAmount / max) * 100
    }
  ];
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

function formatLongDate(date: string): string {
  const [year, month, day] = date.split("-");
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
  const monthIndex = Number(month) - 1;
  return `${Number(day)} de ${monthNames[monthIndex] ?? month} de ${year}`;
}

function formatSourceLabel(source: NonNullable<Transaction["source"]>): string {
  if (source === "manual") return "Manual";
  if (source === "inbox") return "Inbox";
  if (source === "import") return "Importación";
  return "Recurrente";
}

function formatLineItemsPreview(transaction: Transaction): string {
  const items = transaction.lineItems ?? [];
  if (items.length === 0) return "";
  const preview = items
    .slice(0, 2)
    .map((item) => `${item.description}${item.quantity ? ` x${formatQuantity(item.quantity)}` : ""}`)
    .join(", ");
  return items.length > 2 ? `${preview} +${items.length - 2}` : preview;
}

function buildRecentEditSplits(
  transaction: Transaction,
  amount: number,
  selectedCategoryId: string
): Array<Omit<TransactionSplit, "id" | "amountUyu">> {
  const originalCategoryId = transaction.splits[0]?.categoryId;
  if (transaction.splits.length > 1 && selectedCategoryId === originalCategoryId) {
    const originalTotal = transaction.splits.reduce((sum, split) => sum + Number(split.amount || 0), 0) || transaction.amount || 1;
    return transaction.splits.map((split) => ({
      categoryId: split.categoryId,
      tagIds: split.tagIds,
      amount: normalizeMoney((Number(split.amount || 0) / originalTotal) * amount)
    }));
  }

  return [
    {
      categoryId: selectedCategoryId,
      tagIds: transaction.splits[0]?.tagIds ?? [],
      amount
    }
  ];
}

function getTransactionsForAccount(transactions: Transaction[], accountId: string): Transaction[] {
  if (!accountId) return [];
  return transactions
    .filter((transaction) => transaction.status === "confirmed" && (transaction.accountId === accountId || transaction.toAccountId === accountId))
    .sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date);
      if (dateOrder !== 0) return dateOrder;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

function getAccountTransactionSummary(transactions: Transaction[], account: Account) {
  return transactions.reduce(
    (summary, transaction) => {
      const impact = getAccountTransactionImpact(transaction, account);
      if (impact >= 0) summary.incoming = normalizeMoney(summary.incoming + impact);
      if (impact < 0) summary.outgoing = normalizeMoney(summary.outgoing + Math.abs(impact));
      summary.net = normalizeMoney(summary.net + impact);
      return summary;
    },
    { incoming: 0, outgoing: 0, net: 0 }
  );
}

function getAccountTransactionImpact(transaction: Transaction, account: Account): number {
  const amount = convertAmount(transaction.amount, transaction.currency, account.currency, transaction.fxRateToUyu);
  if (transaction.type === "expense") return -amount;
  if (transaction.type === "income" || transaction.type === "refund" || transaction.type === "adjustment") return amount;
  if (transaction.type === "transfer") {
    if (transaction.toAccountId === account.id) return amount;
    if (!transaction.toAccountId && transaction.accountId === account.id) return transaction.transferDirection === "incoming" ? amount : -amount;
    if (transaction.accountId === account.id) return -amount;
  }
  return 0;
}

function formatSignedMoney(amount: number, currency: Currency): string {
  if (amount === 0) return formatMoney(0, currency);
  return `${amount > 0 ? "+" : "-"}${formatMoney(Math.abs(amount), currency)}`;
}

function formatTransactionTypeForAccount(transaction: Transaction, accountId: string): string {
  if (transaction.type !== "transfer") return formatTransactionType(transaction);
  if (!transaction.toAccountId && transaction.accountId === accountId) {
    return transaction.transferDirection === "incoming" ? "Transferencia entra" : "Transferencia sale";
  }
  return transaction.toAccountId === accountId ? "Transferencia entra" : "Transferencia sale";
}

function formatAccountTransactionRoute(transaction: Transaction, state: AppState): string {
  if (transaction.type !== "transfer") {
    return state.accounts.find((account) => account.id === transaction.accountId)?.name ?? "Sin cuenta";
  }

  const source = state.accounts.find((account) => account.id === transaction.accountId)?.name ?? "Sin origen";
  if (!transaction.toAccountId) {
    return transaction.transferDirection === "incoming" ? `Entrada externa -> ${source}` : `${source} -> Salida externa`;
  }

  const destination = state.accounts.find((account) => account.id === transaction.toAccountId)?.name ?? "Sin destino";
  return `${source} -> ${destination}`;
}

function getDraftReviewLabels(draft: ParsedTransactionDraft): string[] {
  const missing = new Set(draft.missingFields ?? []);
  if (!isDraftMissingPayee(draft.payee)) missing.delete("payee");
  if (draft.amount > 0) missing.delete("amount");
  if (draft.accountId) missing.delete("account");
  if (draft.categoryId && !isDraftUncategorizedId(draft.categoryId)) missing.delete("category");

  return Array.from(missing).map((field) => {
    if (field === "payee") return "local";
    if (field === "date") return "fecha";
    if (field === "amount") return "monto";
    if (field === "account") return "cuenta";
    return "categoría";
  });
}

function getDraftBlockingIssues(draft: ParsedTransactionDraft): string[] {
  const issues: string[] = [];
  if (isDraftMissingPayee(draft.payee)) issues.push("local");
  if (draft.amount <= 0) issues.push("monto");
  if (!draft.accountId) issues.push("cuenta");
  if (!draft.categoryId || isDraftUncategorizedId(draft.categoryId)) issues.push("categoría");
  return issues;
}

function isDraftMissingPayee(payee: string): boolean {
  return !payee.trim() || payee === "Comercio sin identificar";
}

function isDraftUncategorizedId(categoryId: string): boolean {
  return categoryId.includes("uncategorized") || categoryId.includes("sin_categorizar");
}

function normalizeLookupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 3)}...` : label;
}

function buildPieSegments(rows: CategorySpendRow[], total: number) {
  let startAngle = -90;
  return rows.map((row) => {
    const angle = (row.amountUyu / total) * 360;
    const segment = describeArc(110, 110, 84, startAngle, startAngle + angle);
    startAngle += angle;
    return {
      label: row.category.name,
      color: row.category.color,
      path: segment
    };
  });
}

function buildAgentPieSegments(points: AgentChartPoint[], total: number) {
  let startAngle = -90;
  return points.map((point, index) => {
    const angle = (Math.abs(point.value) / total) * 360;
    const segment = describeArc(110, 110, 84, startAngle, startAngle + angle);
    startAngle += angle;
    return {
      label: point.label,
      color: point.color ?? ["#2b6cb0", "#2f855a", "#e76f51", "#7c3aed"][index % 4],
      path: segment
    };
  });
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  if (endAngle - startAngle >= 359.99) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`;
  }
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseJsonBackup(text: string, fileName: string): ImportPreview {
  const parsed = JSON.parse(text) as { state?: AppState; transactions?: Transaction[] };
  const transactions = parsed.state?.transactions ?? parsed.transactions ?? [];
  return {
    fileName,
    source: "generic",
    rows: transactions.map((transaction) => ({
      id: transaction.id,
      raw: { payee: transaction.payee },
      draft: {
        type: transaction.type,
        date: transaction.date,
        accountId: transaction.accountId,
        transferDirection: transaction.transferDirection,
        payee: transaction.payee,
        note: transaction.note,
        currency: transaction.currency,
        amount: transaction.amount,
        fxRateToUyu: transaction.fxRateToUyu,
        fxSource: transaction.fxSource,
        categoryId: transaction.splits[0]?.categoryId,
        tagIds: transaction.splits.flatMap((split) => split.tagIds),
        confidence: 1
      },
      warnings: []
    }))
  };
}

function getImportWarnings(draft: ParsedTransactionDraft): string[] {
  const warnings: string[] = [];
  if (!draft.accountId) warnings.push("Cuenta sin mapear");
  if (!draft.categoryId) warnings.push("Categoría sin mapear");
  if (!draft.amount) warnings.push("Monto inválido");
  if (draft.currency === "USD" && !draft.fxRateToUyu) warnings.push("Falta tasa bancaria USD→UYU");
  return warnings;
}

function formatTransactionType(transaction: Transaction): string {
  if (transaction.type === "expense") return "Gasto";
  if (transaction.type === "income") return "Ingreso";
  if (transaction.type === "refund") return "Reembolso";
  if (transaction.type === "adjustment") return "Ajuste";
  return transaction.transferDirection === "incoming" ? "Transferencia entra" : "Transferencia sale";
}

function getManualCategoryOptions(categories: Category[]): Category[] {
  const options = getCategoryOptions(categories).filter((category) => category.id !== "cat_transferencias");
  return options.length ? options : getCategoryOptions(categories);
}

function getManualCategoryOptionsForType(categories: Category[], type: TransactionType): Category[] {
  const activeCategories = getCategoryOptions(categories);
  const manualCategories = getManualCategoryOptions(categories);
  if (type === "transfer") {
    const transferCategories = activeCategories.filter(isTransferCategory);
    return sortCategoryOptions(transferCategories.length ? transferCategories : manualCategories, type);
  }

  if (type === "income") {
    const incomeCategories = manualCategories.filter(isIncomeCategory);
    return sortCategoryOptions(incomeCategories.length ? incomeCategories : manualCategories, type);
  }

  if (type === "expense" || type === "refund") {
    const expenseCategories = manualCategories.filter((category) => !isIncomeOnlyCategory(category));
    return sortCategoryOptions(expenseCategories.length ? expenseCategories : manualCategories, type);
  }

  return sortCategoryOptions(manualCategories, type);
}

function isBudgetableCategory(category: Category): boolean {
  return category.id !== "cat_transferencias";
}

function isTransferCategory(category: Category): boolean {
  return normalizeLookupKey(`${category.id} ${category.name}`).includes("transfer");
}

function isIncomeCategory(category: Category): boolean {
  const name = normalizeLookupKey(category.name);
  if (isIncomeOnlyCategory(category)) return true;
  return /\b(business|gifts?|loan|other)\b/.test(name);
}

function isIncomeOnlyCategory(category: Category): boolean {
  const name = normalizeLookupKey(category.name);
  return /\b(salary|salario|sueldo|extra income|ingresos?|dividends?|freelancer|devolucion|fonasa|dgi|exa dividend|lrm|sas|parental leave|insurance payo)\b/.test(
    name
  );
}

function inferCategoryIconKey(category: Category): string {
  if (category.icon && category.icon !== "circle") return category.icon;
  const name = normalizeLookupKey(category.name);
  if (name.includes("salary") || name.includes("salario") || name.includes("sueldo")) return "hand-coins";
  if (name.includes("income") || name.includes("ingreso")) return "wallet";
  if (name.includes("dividend")) return "badge-dollar";
  if (name.includes("freelancer") || name.includes("business") || name.includes("sas") || name.includes("lrm")) return "briefcase";
  if (name.includes("groceries") || name.includes("super") || name.includes("mercado")) return "shopping-bag";
  if (name.includes("food") || name.includes("comida") || name.includes("restaurant")) return "utensils";
  if (name.includes("cafe") || name.includes("café")) return "coffee";
  if (name.includes("travel") || name.includes("viaje") || name.includes("ruta")) return "plane";
  if (name.includes("transport") || name.includes("transporte") || name.includes("auto")) return "car";
  if (name.includes("health") || name.includes("salud")) return "heart-pulse";
  if (name.includes("education") || name.includes("educacion")) return "graduation-cap";
  if (name.includes("entertainment") || name.includes("gaming") || name.includes("ocio")) return "clapperboard";
  if (name.includes("gift") || name.includes("regalo")) return "gift";
  if (name.includes("clothing") || name.includes("ropa")) return "shirt";
  if (name.includes("tecnologia") || name.includes("technology")) return "smartphone";
  if (name.includes("loan") || name.includes("prestamo")) return "landmark";
  if (name.includes("seguro") || name.includes("insurance")) return "shield-check";
  if (name.includes("hogar") || name.includes("home") || name.includes("casa")) return "home";
  if (name.includes("servicio") || name.includes("ute") || name.includes("antel")) return "receipt";
  if (name.includes("transfer")) return "arrow-down-up";
  return "more-horizontal";
}

function sortCategoryOptions(categories: Category[], type: TransactionType): Category[] {
  const priority =
    type === "income"
      ? [
          "salary",
          "extra income",
          "freelancer",
          "business",
          "dividends",
          "exa dividend",
          "devolucion dgi",
          "devolucion fonasa",
          "lrm",
          "sas",
          "other"
        ]
      : [
          "other",
          "groceries",
          "food drink",
          "travel",
          "transport",
          "education",
          "entertainment",
          "healthcare",
          "deporte",
          "citas",
          "tecnologia",
          "clothing",
          "gifts",
          "gastos hogar",
          "limpieza",
          "higiene",
          "business",
          "loan"
        ];

  return [...categories].sort((a, b) => {
    const aIndex = categoryPriorityIndex(a, priority);
    const bIndex = categoryPriorityIndex(b, priority);
    return aIndex - bIndex || a.name.localeCompare(b.name, "es");
  });
}

function categoryPriorityIndex(category: Category, priority: string[]): number {
  const name = normalizeLookupKey(category.name);
  const index = priority.findIndex((item) => name.includes(item));
  return index === -1 ? priority.length + 1 : index;
}

function softColor(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "#f1ece5";
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.12)`;
}

function downloadBackup(state: AppState) {
  const blob = new Blob([exportState(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gastos-invest-backup-${todayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadAgentLogs(conversations: AgentConversation[], health: AgentHealth | undefined) {
  const payload = {
    exportedAt: new Date().toISOString(),
    kind: "gastos-invest-agent-logs",
    engine: health
      ? {
          configured: health.configured,
          mode: health.mode,
          model: health.model,
          reasoningEffort: health.reasoningEffort
        }
      : null,
    conversations
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gastos-invest-agent-logs-${todayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
