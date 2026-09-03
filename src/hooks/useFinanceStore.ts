import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  AgentConversation,
  Budget,
  Currency,
  InboxDraft,
  ParsedTransactionDraft,
  ReceiptLineItemDraft,
  RecurringRule,
  Transaction,
  TransactionSplit,
  TransactionType
} from "../types";
import { createInitialState } from "../data/seed";
import { addFrequency } from "../lib/date";
import { getDefaultAccountId, normalizeMoney, toUyu } from "../lib/calculations";
import { getReceiptLineItemTotal, normalizeReceiptLineItems } from "../lib/inboxParser";
import { createId } from "../lib/id";
import {
  getRemoteRevision,
  localFinanceRepository,
  pullRemoteState,
  pushRemoteState,
  subscribeToSyncConfigChanges,
  type SyncStatus
} from "../lib/storage";

export interface TransactionInput {
  type: TransactionType;
  date: string;
  accountId: string;
  toAccountId?: string;
  transferDirection?: Transaction["transferDirection"];
  payee: string;
  note: string;
  currency: Currency;
  amount: number;
  fxRateToUyu?: number;
  fxSource?: Transaction["fxSource"];
  paymentMethod: Transaction["paymentMethod"];
  splits: Array<Omit<TransactionSplit, "id" | "amountUyu">>;
  lineItems?: ReceiptLineItemDraft[];
  source?: Transaction["source"];
  recurringRuleId?: string;
}

export function useFinanceStore() {
  const [state, setState] = useState<AppState>(() => localFinanceRepository.load());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "checking", label: "Conectando sync" });
  const [syncConfigVersion, setSyncConfigVersion] = useState(0);
  const initialSyncDone = useRef(false);
  const stateRef = useRef(state);
  const remoteRevision = useRef(localFinanceRepository.getSyncRevision());
  const skipNextPush = useRef(false);

  useEffect(() => {
    stateRef.current = state;
    localFinanceRepository.save(state);

    if (!initialSyncDone.current) return;
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      setSyncStatus({ state: "saving", label: "Guardando sync", revision: remoteRevision.current });
      pushRemoteState(state, remoteRevision.current)
        .then((envelope) => {
          if (!envelope) {
            setSyncStatus({ state: "offline", label: "Sync local" });
            return;
          }
          remoteRevision.current = envelope.revision;
          localFinanceRepository.setSyncRevision(envelope.revision);
          setSyncStatus({
            state: "synced",
            label: "Sync listo",
            revision: envelope.revision,
            updatedAt: envelope.updatedAt
          });
        })
        .catch(() => setSyncStatus({ state: "offline", label: "Sync local" }));
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [state]);

  useEffect(() => {
    return subscribeToSyncConfigChanges(() => {
      remoteRevision.current = undefined;
      initialSyncDone.current = false;
      setSyncStatus({ state: "checking", label: "Conectando sync" });
      setSyncConfigVersion((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    pullRemoteState()
      .then(async (envelope) => {
        if (cancelled) return;

        if (!envelope) {
          const pushed = await pushRemoteState(stateRef.current, remoteRevision.current);
          if (cancelled) return;
          initialSyncDone.current = true;
          if (pushed) {
            remoteRevision.current = pushed.revision;
            localFinanceRepository.setSyncRevision(pushed.revision);
            setSyncStatus({
              state: "synced",
              label: "Sync listo",
              revision: pushed.revision,
              updatedAt: pushed.updatedAt
            });
            return;
          }

          setSyncStatus({ state: "local", label: "Solo local" });
          return;
        }

        initialSyncDone.current = true;

        const localRevision = remoteRevision.current;
        if (!localRevision && localFinanceRepository.hasLocalState() && envelope.revision === 1) {
          const pushed = await pushRemoteState(stateRef.current, envelope.revision);
          if (cancelled) return;
          if (pushed) {
            remoteRevision.current = pushed.revision;
            localFinanceRepository.setSyncRevision(pushed.revision);
            setSyncStatus({
              state: "synced",
              label: "Sync listo",
              revision: pushed.revision,
              updatedAt: pushed.updatedAt
            });
            return;
          }
        }

        remoteRevision.current = envelope.revision;
        localFinanceRepository.setSyncRevision(envelope.revision);
        skipNextPush.current = true;
        setState(envelope.state);
        setSyncStatus({
          state: "synced",
          label: "Sync listo",
          revision: envelope.revision,
          updatedAt: envelope.updatedAt
        });
      })
      .catch(() => {
        initialSyncDone.current = true;
        if (!cancelled) setSyncStatus({ state: "offline", label: "Sync local" });
      });

    return () => {
      cancelled = true;
    };
  }, [syncConfigVersion]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!initialSyncDone.current) return;
      getRemoteRevision()
        .then((revision) => {
          if (revision === undefined) {
            setSyncStatus({ state: "offline", label: "Sync local" });
            return;
          }
          if ((remoteRevision.current ?? 0) >= revision) return;
          return pullRemoteState().then((envelope) => {
            if (!envelope) {
              setSyncStatus({ state: "offline", label: "Sync local" });
              return;
            }
            remoteRevision.current = envelope.revision;
            localFinanceRepository.setSyncRevision(envelope.revision);
            skipNextPush.current = true;
            setState(envelope.state);
            setSyncStatus({
              state: "synced",
              label: "Sync listo",
              revision: envelope.revision,
              updatedAt: envelope.updatedAt
            });
          });
        })
        .catch(() => setSyncStatus({ state: "offline", label: "Sync local" }));
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  const actions = useMemo(
    () => ({
      addTransaction(input: TransactionInput) {
        const transaction = buildTransaction(input);
        setState((current) => ({
          ...current,
          transactions: [transaction, ...current.transactions]
        }));
        return transaction;
      },
      updateTransaction(transactionId: string, input: TransactionInput) {
        setState((current) => ({
          ...current,
          transactions: current.transactions.map((transaction) => {
            if (transaction.id !== transactionId) return transaction;
            const next = buildTransaction(input);
            return {
              ...next,
              id: transaction.id,
              status: transaction.status,
              source: transaction.source,
              importBatchId: transaction.importBatchId,
              recurringRuleId: transaction.recurringRuleId,
              createdAt: transaction.createdAt
            };
          })
        }));
      },
      deleteTransaction(transactionId: string) {
        setState((current) => ({
          ...current,
          transactions: current.transactions.filter((transaction) => transaction.id !== transactionId)
        }));
      },
      updateBudget(id: string, changes: Partial<Budget>) {
        setState((current) => ({
          ...current,
          budgets: current.budgets.map((budget) => (budget.id === id ? { ...budget, ...changes } : budget))
        }));
      },
      addBudget(input: Omit<Budget, "id">) {
        setState((current) => ({
          ...current,
          budgets: [{ ...input, id: createId("budget") }, ...current.budgets]
        }));
      },
      addInboxDraft(draft: Omit<InboxDraft, "id" | "createdAt" | "status">) {
        setState((current) => ({
          ...current,
          inboxDrafts: [
            {
              ...draft,
              id: createId("inbox"),
              status: "pending",
              createdAt: new Date().toISOString()
            },
            ...current.inboxDrafts
          ]
        }));
      },
      convertInboxDraft(draftId: string, draft: ParsedTransactionDraft) {
        const transaction = buildTransaction({
          type: draft.type,
          date: draft.date,
          accountId: draft.accountId ?? getDefaultAccountId(state.accounts, draft.currency),
          transferDirection: draft.transferDirection,
          payee: draft.payee,
          note: draft.note,
          currency: draft.currency,
          amount: draft.amount,
          fxRateToUyu: draft.fxRateToUyu,
          fxSource: draft.fxSource,
          paymentMethod: "credit",
          splits: buildSplitsFromDraft(draft),
          lineItems: draft.lineItems,
          source: "inbox"
        });
        setState((current) => ({
          ...current,
          transactions: [transaction, ...current.transactions],
          inboxDrafts: current.inboxDrafts.map((item) => (item.id === draftId ? { ...item, status: "converted" } : item))
        }));
      },
      dismissInboxDraft(draftId: string) {
        setState((current) => ({
          ...current,
          inboxDrafts: current.inboxDrafts.map((item) => (item.id === draftId ? { ...item, status: "dismissed" } : item))
        }));
      },
      importTransactions(batch: AppState["importBatches"][number], transactions: Transaction[]) {
        setState((current) => ({
          ...current,
          importBatches: [batch, ...current.importBatches],
          transactions: [...transactions, ...current.transactions]
        }));
      },
      updateAccountInitialBalance(accountId: string, initialBalance: number) {
        setState((current) => ({
          ...current,
          accounts: current.accounts.map((account) =>
            account.id === accountId ? { ...account, initialBalance: normalizeMoney(initialBalance) } : account
          )
        }));
      },
      updateAccountActive(accountId: string, active: boolean) {
        setState((current) => ({
          ...current,
          accounts: current.accounts.map((account) => (account.id === accountId ? { ...account, active } : account))
        }));
      },
      upsertAgentConversation(conversation: AgentConversation) {
        setState((current) => {
          const exists = current.agentConversations.some((item) => item.id === conversation.id);
          return {
            ...current,
            agentConversations: exists
              ? current.agentConversations.map((item) => (item.id === conversation.id ? conversation : item))
              : [conversation, ...current.agentConversations]
          };
        });
      },
      appendAgentMessage(conversationId: string, message: AgentConversation["messages"][number]) {
        setState((current) => ({
          ...current,
          agentConversations: current.agentConversations.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  title: buildConversationTitle(conversation, message),
                  updatedAt: message.createdAt,
                  messages: [...conversation.messages, message]
                }
              : conversation
          )
        }));
      },
      deleteAgentConversation(conversationId: string) {
        setState((current) => ({
          ...current,
          agentConversations: current.agentConversations.filter((conversation) => conversation.id !== conversationId)
        }));
      },
      confirmRecurring(rule: RecurringRule) {
        const transaction = buildTransaction({
          type: rule.type,
          date: rule.nextDueDate,
          accountId: rule.accountId,
          payee: rule.payee,
          note: rule.name,
          currency: rule.currency,
          amount: rule.amount,
          fxRateToUyu: rule.currency === "USD" ? 40 : 1,
          fxSource: rule.currency === "USD" ? "estimated" : "not_applicable",
          paymentMethod: "other",
          splits: [{ categoryId: rule.categoryId, tagIds: rule.tagIds, amount: rule.amount }],
          source: "recurring",
          recurringRuleId: rule.id
        });
        setState((current) => ({
          ...current,
          transactions: [transaction, ...current.transactions],
          recurringRules: current.recurringRules.map((item) =>
            item.id === rule.id ? { ...item, nextDueDate: addFrequency(item.nextDueDate, item.frequency) } : item
          )
        }));
      },
      resetDemoData() {
        setState(createInitialState());
      },
      replaceState(nextState: AppState) {
        setState(nextState);
      }
    }),
    [state.accounts]
  );

  return { state, actions, syncStatus };
}

function buildConversationTitle(conversation: AgentConversation, message: AgentConversation["messages"][number]): string {
  if (conversation.title !== "Nueva conversación" || message.role !== "user") return conversation.title;
  return truncateTitle(message.content);
}

function truncateTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title) return "Nueva conversación";
  return title.length > 52 ? `${title.slice(0, 49)}...` : title;
}

function buildTransaction(input: TransactionInput): Transaction {
  const fxRateToUyu = input.currency === "UYU" ? 1 : input.fxRateToUyu && input.fxRateToUyu > 0 ? input.fxRateToUyu : 40;
  const amount = normalizeMoney(Math.abs(input.amount));
  const amountUyu = toUyu(amount, input.currency, fxRateToUyu);
  const splitsInput = input.splits.length
    ? input.splits
    : [{ categoryId: "cat_uncategorized", tagIds: [], amount }];

  const splitsTotal = splitsInput.reduce((total, split) => total + Number(split.amount || 0), 0) || amount;
  const splits = splitsInput.map((split) => {
    const normalizedAmount = normalizeMoney(Number(split.amount || 0));
    const share = splitsTotal === 0 ? 0 : normalizedAmount / splitsTotal;
    return {
      id: createId("split"),
      categoryId: split.categoryId,
      tagIds: split.tagIds,
      amount: normalizedAmount,
      amountUyu: normalizeMoney(amountUyu * share)
    };
  });

  const transaction: Transaction = {
    id: createId("txn"),
    type: input.type,
    date: input.date,
    accountId: input.accountId,
    toAccountId: input.toAccountId,
    transferDirection: input.transferDirection,
    payee: input.payee.trim() || "Sin comercio",
    note: input.note.trim(),
    currency: input.currency,
    amount,
    amountUyu,
    fxRateToUyu,
    fxSource: input.currency === "UYU" ? "not_applicable" : input.fxSource ?? "estimated",
    paymentMethod: input.paymentMethod,
    status: "confirmed",
    splits,
    source: input.source ?? "manual",
    recurringRuleId: input.recurringRuleId,
    createdAt: new Date().toISOString()
  };

  const lineItems = buildLineItems(input.lineItems, input.currency, fxRateToUyu);
  return lineItems.length ? { ...transaction, lineItems } : transaction;
}

function buildSplitsFromDraft(draft: ParsedTransactionDraft): TransactionInput["splits"] {
  const items = (draft.lineItems ?? []).filter((item) => item.description.trim() && Number(item.amount) > 0);
  if (items.length === 0) {
    return [
      {
        categoryId: draft.categoryId ?? "cat_uncategorized",
        tagIds: draft.tagIds,
        amount: draft.amount
      }
    ];
  }

  const groups = new Map<string, { categoryId: string; tagIds: string[]; amount: number }>();
  items.forEach((item) => {
    const categoryId = item.categoryId ?? draft.categoryId ?? "cat_uncategorized";
    const tagIds = [...new Set([...(draft.tagIds ?? []), ...(item.tagIds ?? [])])].sort();
    const key = `${categoryId}|${tagIds.join(",")}`;
    const current = groups.get(key) ?? { categoryId, tagIds, amount: 0 };
    current.amount = normalizeMoney(current.amount + getReceiptLineItemTotal(item));
    groups.set(key, current);
  });

  const itemTotal = normalizeMoney(Array.from(groups.values()).reduce((sum, item) => sum + item.amount, 0));
  const difference = normalizeMoney(draft.amount - itemTotal);
  if (difference > 0.01) {
    const categoryId = draft.categoryId ?? "cat_uncategorized";
    const key = `${categoryId}|${(draft.tagIds ?? []).join(",")}`;
    const current = groups.get(key) ?? { categoryId, tagIds: draft.tagIds, amount: 0 };
    current.amount = normalizeMoney(current.amount + difference);
    groups.set(key, current);
  }

  return Array.from(groups.values());
}

function buildLineItems(lineItems: ReceiptLineItemDraft[] | undefined, currency: Currency, fxRateToUyu: number) {
  return normalizeReceiptLineItems(lineItems ?? [])
    .filter((item) => item.description.trim() && Number(item.amount) > 0)
    .map((item) => {
      const amount = normalizeMoney(Math.abs(Number(item.amount) || 0));
      const totalAmount = getReceiptLineItemTotal(item);
      return {
        id: createId("item"),
        description: item.description.trim(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        originalAmount: item.originalAmount,
        discountAmount: item.discountAmount,
        discountSource: item.discountSource,
        shippingAmount: item.shippingAmount,
        amount,
        amountUyu: toUyu(totalAmount, currency, fxRateToUyu),
        categoryId: item.categoryId,
        tagIds: item.tagIds ?? [],
        confidence: item.confidence
      };
    });
}
