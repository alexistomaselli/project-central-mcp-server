import type { SupabaseClient } from "@supabase/supabase-js";

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolArgs = Record<string, unknown> | undefined;

const todayIso = () => new Date().toISOString().slice(0, 10);

const toNumber = (value: unknown) => Number(value || 0);

const addMonths = (date: string, months: number) => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString().slice(0, 10);
};

const splitInstallments = (amount: number, count: number) => {
  const totalInCents = Math.round(amount * 100);
  const base = Math.floor(totalInCents / count);
  const remainder = totalInCents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
};

const ensureUserId = (args: ToolArgs) => {
  const userId = args?.user_id;
  if (!userId || typeof userId !== "string") {
    throw new Error("user_id is required");
  }
  return userId;
};

const ensureStatementForDate = async (supabase: SupabaseClient, creditCardId: string, referenceDate: string) => {
  const { data, error } = await supabase.rpc("ensure_finance_card_statement", {
    p_card_id: creditCardId,
    p_reference_date: referenceDate,
  });

  if (error) throw error;
  return data as string;
};

const refreshStatementTotals = async (supabase: SupabaseClient, statementIds: Array<string | null | undefined>) => {
  const ids = Array.from(new Set(statementIds.filter(Boolean))) as string[];
  for (const statementId of ids) {
    const { error } = await supabase.rpc("refresh_finance_card_statement_totals", {
      p_statement_id: statementId,
    });
    if (error) throw error;
  }
};

const fetchAccountForUser = async (supabase: SupabaseClient, userId: string, accountId: string) => {
  const { data, error } = await supabase
    .from("finance_accounts")
    .select("id, user_id, name, currency")
    .eq("id", accountId)
    .eq("user_id", userId)
    .limit(1);

  if (error) throw error;
  const account = data?.[0];
  if (!account) throw new Error("Finance account not found");
  return account;
};

const fetchCardForUser = async (supabase: SupabaseClient, userId: string, cardId: string) => {
  const { data, error } = await supabase
    .from("finance_credit_cards")
    .select("id, user_id, name, account_id, last4")
    .eq("id", cardId)
    .eq("user_id", userId)
    .limit(1);

  if (error) throw error;
  const card = data?.[0];
  if (!card) throw new Error("Finance credit card not found");
  return card;
};

const resolveCardPaymentStatement = async (supabase: SupabaseClient, userId: string, creditCardId: string, preferredStatementId?: string) => {
  if (preferredStatementId) return preferredStatementId;

  const { data, error } = await supabase
    .from("finance_card_statements")
    .select("*")
    .eq("user_id", userId)
    .eq("credit_card_id", creditCardId)
    .in("status", ["open", "closed", "overdue"])
    .order("due_date", { ascending: true });

  if (error) throw error;

  const statement = (data || []).find((row) =>
    toNumber(row.total_ars) > toNumber(row.paid_ars) ||
    toNumber(row.total_usd) > toNumber(row.paid_usd),
  );

  if (!statement) {
    throw new Error("No pending statement found for this card payment");
  }

  return statement.id as string;
};

export const financeTools: ToolDefinition[] = [
  {
    name: "finance_list_accounts",
    description: "List finance accounts and balances for a user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "Authenticated user UUID" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "finance_add_account",
    description: "Create a finance account for a user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        name: { type: "string" },
        institution: { type: "string" },
        account_kind: { type: "string", enum: ["bank", "wallet", "cash"] },
        currency: { type: "string", enum: ["ARS", "USD"] },
        opening_balance: { type: "number" },
        account_number_last4: { type: "string" },
        notes: { type: "string" },
      },
      required: ["user_id", "name", "account_kind", "currency"],
    },
  },
  {
    name: "finance_list_cards",
    description: "List finance credit cards for a user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "finance_add_card",
    description: "Create a finance credit card for a user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        account_id: { type: "string" },
        name: { type: "string" },
        brand: { type: "string" },
        last4: { type: "string" },
        closing_day: { type: "number" },
        due_day: { type: "number" },
        reminder_days_before: { type: "number" },
      },
      required: ["user_id", "account_id", "name", "closing_day", "due_day"],
    },
  },
  {
    name: "finance_list_movements",
    description: "List finance movements with optional filters",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        type: { type: "string" },
        currency: { type: "string" },
        account_id: { type: "string" },
        credit_card_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "finance_add_movement",
    description: "Create a finance movement including card charges and card payments",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        type: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        merchant: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["ARS", "USD"] },
        movement_date: { type: "string" },
        account_id: { type: "string" },
        credit_card_id: { type: "string" },
        statement_id: { type: "string" },
        category_id: { type: "string" },
        installment_count: { type: "number" },
      },
      required: ["user_id", "type", "title", "amount", "currency", "movement_date"],
    },
  },
  {
    name: "finance_add_transfer",
    description: "Create a transfer between two personal accounts",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        source_account_id: { type: "string" },
        destination_account_id: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["ARS", "USD"] },
        movement_date: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        category_id: { type: "string" },
      },
      required: ["user_id", "source_account_id", "destination_account_id", "amount", "currency", "movement_date", "title"],
    },
  },
  {
    name: "finance_list_card_consumption",
    description: "List current card consumption per card",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "finance_list_due_statements",
    description: "List upcoming credit card due statements",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "finance_add_subscription",
    description: "Create a recurring finance subscription",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["ARS", "USD"] },
        billing_frequency: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
        funding_source_type: { type: "string", enum: ["account", "credit_card"] },
        funding_source_id: { type: "string" },
        category_id: { type: "string" },
        next_charge_date: { type: "string" },
        end_date: { type: "string" },
      },
      required: ["user_id", "name", "amount", "currency", "billing_frequency", "funding_source_type", "funding_source_id", "next_charge_date"],
    },
  },
  {
    name: "finance_list_subscriptions",
    description: "List recurring finance subscriptions for a user",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
      },
      required: ["user_id"],
    },
  },
];

export async function handleFinanceTool(name: string, args: ToolArgs, supabase: SupabaseClient): Promise<ToolResult | null> {
  if (!name.startsWith("finance_")) return null;

  try {
    const userId = ensureUserId(args);

    switch (name) {
      case "finance_list_accounts": {
        const { data, error } = await supabase
          .from("finance_account_balances")
          .select("*")
          .eq("user_id", userId)
          .order("name", { ascending: true });

        if (error) throw error;

        const text = (data || []).map((account) =>
          `- ${account.name} [${account.currency}] saldo actual: ${toNumber(account.current_balance).toFixed(2)} (${account.account_kind})`,
        ).join("\n");

        return {
          content: [{ type: "text", text: text || "No finance accounts found." }],
        };
      }

      case "finance_add_account": {
        const { data, error } = await supabase
          .from("finance_accounts")
          .insert({
            user_id: userId,
            name: args?.name as string,
            institution: (args?.institution as string) || null,
            account_kind: (args?.account_kind as string) || "bank",
            currency: args?.currency as string,
            opening_balance: toNumber(args?.opening_balance),
            account_number_last4: (args?.account_number_last4 as string) || null,
            notes: (args?.notes as string) || null,
          })
          .select("id, name, currency")
          .limit(1);

        if (error) throw error;
        const account = data?.[0];

        return {
          content: [{ type: "text", text: `Finance account "${account?.name}" created successfully (${account?.currency}).` }],
        };
      }

      case "finance_list_cards": {
        const { data, error } = await supabase
          .from("finance_credit_cards")
          .select("*")
          .eq("user_id", userId)
          .order("name", { ascending: true });

        if (error) throw error;

        const text = (data || []).map((card) =>
          `- ${card.name}${card.last4 ? ` •••• ${card.last4}` : ""} | cierre: ${card.closing_day} | vence: ${card.due_day}`,
        ).join("\n");

        return {
          content: [{ type: "text", text: text || "No finance credit cards found." }],
        };
      }

      case "finance_add_card": {
        await fetchAccountForUser(supabase, userId, args?.account_id as string);

        const { data, error } = await supabase
          .from("finance_credit_cards")
          .insert({
            user_id: userId,
            account_id: args?.account_id as string,
            name: args?.name as string,
            brand: (args?.brand as string) || null,
            last4: (args?.last4 as string) || null,
            closing_day: Math.max(1, Math.min(31, Number(args?.closing_day))),
            due_day: Math.max(1, Math.min(31, Number(args?.due_day))),
            reminder_days_before: Number(args?.reminder_days_before || 3),
          })
          .select("id, name")
          .limit(1);

        if (error) throw error;
        const card = data?.[0];

        return {
          content: [{ type: "text", text: `Finance credit card "${card?.name}" created successfully.` }],
        };
      }

      case "finance_list_movements": {
        let query = supabase
          .from("finance_movements")
          .select("*")
          .eq("user_id", userId)
          .order("movement_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (args?.type) query = query.eq("type", args.type as string);
        if (args?.currency) query = query.eq("currency", args.currency as string);
        if (args?.account_id) query = query.eq("account_id", args.account_id as string);
        if (args?.credit_card_id) query = query.eq("credit_card_id", args.credit_card_id as string);

        const limit = Number(args?.limit || 20);
        const { data, error } = await query.limit(limit);

        if (error) throw error;

        const text = (data || []).map((movement) =>
          `- ${movement.movement_date} | ${movement.type} | ${movement.title} | ${toNumber(movement.amount).toFixed(2)} ${movement.currency}`,
        ).join("\n");

        return {
          content: [{ type: "text", text: text || "No finance movements found." }],
        };
      }

      case "finance_add_movement": {
        const amount = toNumber(args?.amount);
        if (amount <= 0) throw new Error("amount must be greater than zero");

        const type = args?.type as string;
        const currency = args?.currency as string;
        const movementDate = (args?.movement_date as string) || todayIso();
        const accountId = (args?.account_id as string) || "";
        const creditCardId = (args?.credit_card_id as string) || "";
        const statementIdArg = (args?.statement_id as string) || "";
        const installmentCount = Math.max(1, Math.floor(Number(args?.installment_count || 1)));

        if (accountId) {
          const account = await fetchAccountForUser(supabase, userId, accountId);
          if (account.currency !== currency) {
            throw new Error(`Account currency mismatch. Expected ${account.currency}.`);
          }
        }

        if (type === "card_charge") {
          await fetchCardForUser(supabase, userId, creditCardId);

          if (installmentCount > 1) {
            const { data: planRows, error: planError } = await supabase
              .from("finance_installment_plans")
              .insert({
                user_id: userId,
                credit_card_id: creditCardId,
                category_id: (args?.category_id as string) || null,
                title: args?.title as string,
                description: (args?.description as string) || null,
                merchant: (args?.merchant as string) || null,
                total_amount: amount,
                currency,
                installment_count: installmentCount,
                first_charge_date: movementDate,
              })
              .select("id")
              .limit(1);

            if (planError) throw planError;
            const planId = planRows?.[0]?.id || null;
            const installments = splitInstallments(amount, installmentCount);
            const createdStatementIds: string[] = [];

            for (let index = 0; index < installments.length; index += 1) {
              const installmentDate = addMonths(movementDate, index);
              const statementId = await ensureStatementForDate(supabase, creditCardId, installmentDate);
              createdStatementIds.push(statementId);

              const { error } = await supabase.from("finance_movements").insert({
                user_id: userId,
                credit_card_id: creditCardId,
                statement_id: statementId,
                installment_plan_id: planId,
                category_id: (args?.category_id as string) || null,
                type: "card_charge",
                direction: "debit",
                title: args?.title as string,
                description: (args?.description as string) || null,
                merchant: (args?.merchant as string) || null,
                amount: installments[index],
                currency,
                movement_date: installmentDate,
                status: installmentDate <= todayIso() ? "posted" : "scheduled",
                installment_number: index + 1,
                installment_total: installmentCount,
                is_generated: index > 0,
              });

              if (error) throw error;
            }

            await refreshStatementTotals(supabase, createdStatementIds);

            return {
              content: [{ type: "text", text: `Card purchase created in ${installmentCount} installments.` }],
            };
          }
        }

        let statementId: string | null = statementIdArg || null;
        if (type === "card_charge") {
          statementId = await ensureStatementForDate(supabase, creditCardId, movementDate);
        }
        if (type === "card_payment") {
          await fetchCardForUser(supabase, userId, creditCardId);
          statementId = await resolveCardPaymentStatement(supabase, userId, creditCardId, statementIdArg || undefined);
        }

        const direction = type === "income" || type === "transfer_in" || type === "refund" ? "credit" : "debit";

        const { data, error } = await supabase
          .from("finance_movements")
          .insert({
            user_id: userId,
            account_id: accountId || null,
            credit_card_id: creditCardId || null,
            statement_id: statementId,
            category_id: (args?.category_id as string) || null,
            type,
            direction,
            title: args?.title as string,
            description: (args?.description as string) || null,
            merchant: (args?.merchant as string) || null,
            amount,
            currency,
            movement_date: movementDate,
            status: "posted",
          })
          .select("id")
          .limit(1);

        if (error) throw error;

        await refreshStatementTotals(supabase, [statementId]);

        return {
          content: [{ type: "text", text: `Finance movement created successfully (ID: ${data?.[0]?.id || "n/a"}).` }],
        };
      }

      case "finance_add_transfer": {
        const sourceAccount = await fetchAccountForUser(supabase, userId, args?.source_account_id as string);
        const destinationAccount = await fetchAccountForUser(supabase, userId, args?.destination_account_id as string);
        const currency = args?.currency as string;

        if (sourceAccount.id === destinationAccount.id) {
          throw new Error("Source and destination accounts must be different");
        }
        if (sourceAccount.currency !== destinationAccount.currency || sourceAccount.currency !== currency) {
          throw new Error("Transfers across different currencies are not supported in v1");
        }

        const transferGroupId = crypto.randomUUID();
        const amount = toNumber(args?.amount);
        const movementDate = (args?.movement_date as string) || todayIso();

        const { data, error } = await supabase
          .from("finance_movements")
          .insert([
            {
              user_id: userId,
              account_id: sourceAccount.id,
              category_id: (args?.category_id as string) || null,
              transfer_group_id: transferGroupId,
              type: "transfer_out",
              direction: "debit",
              title: args?.title as string,
              description: (args?.description as string) || null,
              amount,
              currency,
              movement_date: movementDate,
              status: "posted",
            },
            {
              user_id: userId,
              account_id: destinationAccount.id,
              category_id: (args?.category_id as string) || null,
              transfer_group_id: transferGroupId,
              type: "transfer_in",
              direction: "credit",
              title: args?.title as string,
              description: (args?.description as string) || null,
              amount,
              currency,
              movement_date: movementDate,
              status: "posted",
            },
          ])
          .select("id");

        if (error) throw error;

        const ids = data?.map((row) => row.id) || [];
        if (ids.length === 2) {
          await supabase.from("finance_movements").update({ linked_movement_id: ids[1] }).eq("id", ids[0]);
          await supabase.from("finance_movements").update({ linked_movement_id: ids[0] }).eq("id", ids[1]);
        }

        return {
          content: [{ type: "text", text: "Finance transfer created successfully." }],
        };
      }

      case "finance_list_card_consumption": {
        const { data, error } = await supabase
          .from("finance_card_current_consumption")
          .select("*")
          .eq("user_id", userId)
          .order("due_date", { ascending: true });

        if (error) throw error;

        const text = (data || []).map((statement) =>
          `- ${statement.card_name}${statement.last4 ? ` •••• ${statement.last4}` : ""} | ARS: ${toNumber(statement.outstanding_ars).toFixed(2)} | USD: ${toNumber(statement.outstanding_usd).toFixed(2)} | vence ${statement.due_date}`,
        ).join("\n");

        return {
          content: [{ type: "text", text: text || "No current card consumption found." }],
        };
      }

      case "finance_list_due_statements": {
        const { data, error } = await supabase
          .from("finance_upcoming_card_due_dates")
          .select("*")
          .eq("user_id", userId)
          .limit(10);

        if (error) throw error;

        const text = (data || []).map((statement) =>
          `- ${statement.card_name}${statement.last4 ? ` •••• ${statement.last4}` : ""} | cierre ${statement.closing_date} | vence ${statement.due_date} | ARS ${toNumber(statement.outstanding_ars).toFixed(2)} | USD ${toNumber(statement.outstanding_usd).toFixed(2)}`,
        ).join("\n");

        return {
          content: [{ type: "text", text: text || "No upcoming finance statements found." }],
        };
      }

      case "finance_add_subscription": {
        if ((args?.funding_source_type as string) === "account") {
          const account = await fetchAccountForUser(supabase, userId, args?.funding_source_id as string);
          if (account.currency !== (args?.currency as string)) {
            throw new Error(`Subscription currency mismatch. Expected ${account.currency}.`);
          }
        } else {
          await fetchCardForUser(supabase, userId, args?.funding_source_id as string);
        }

        const { data, error } = await supabase
          .from("finance_recurring_subscriptions")
          .insert({
            user_id: userId,
            name: args?.name as string,
            description: (args?.description as string) || null,
            amount: toNumber(args?.amount),
            currency: args?.currency as string,
            billing_frequency: args?.billing_frequency as string,
            funding_source_type: args?.funding_source_type as string,
            funding_source_id: args?.funding_source_id as string,
            category_id: (args?.category_id as string) || null,
            next_charge_date: args?.next_charge_date as string,
            end_date: (args?.end_date as string) || null,
            is_active: true,
          })
          .select("id, name")
          .limit(1);

        if (error) throw error;
        const subscription = data?.[0];

        return {
          content: [{ type: "text", text: `Finance subscription "${subscription?.name}" created successfully.` }],
        };
      }

      case "finance_list_subscriptions": {
        const { data, error } = await supabase
          .from("finance_recurring_subscriptions")
          .select("*")
          .eq("user_id", userId)
          .order("next_charge_date", { ascending: true });

        if (error) throw error;

        const text = (data || []).map((subscription) =>
          `- ${subscription.name} | ${toNumber(subscription.amount).toFixed(2)} ${subscription.currency} | ${subscription.billing_frequency} | próximo cargo ${subscription.next_charge_date}`,
        ).join("\n");

        return {
          content: [{ type: "text", text: text || "No finance subscriptions found." }],
        };
      }

      default:
        return null;
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `❌ Error: ${error.message}` }],
      isError: true,
    };
  }
}
