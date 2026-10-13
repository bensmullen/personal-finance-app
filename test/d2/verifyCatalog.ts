import { catalogSchema, centsSchema, type D2Case } from "../fixtures/d2/schema.js";

/** Test-only reconciliation of stated economic legs. This does not execute a
 * D2 product, calculate tax law, select funding, or resolve capability gaps. */
export function reconcileStatedEffects(item: D2Case) {
  const effects = item.expected.effects;
  if (!effects) return undefined;
  const accounts = new Map(item.input.accounts.map(account => [account.id, account]));
  if (accounts.size !== item.input.accounts.length) throw new Error("duplicate account");
  const closing = new Map(item.input.accounts.map(account => [account.id, BigInt(account.openingCents)]));
  const transactionIds = new Set<string>();
  for (const transaction of effects.transactions) {
    if (transactionIds.has(transaction.id)) throw new Error("duplicate transaction");
    transactionIds.add(transaction.id);
    if (transaction.date < item.period.start || transaction.date >= item.period.endExclusive) throw new Error("transaction outside half-open period");
    let balance = 0n;
    for (const leg of transaction.legs) {
      const account = accounts.get(leg.account);
      if (!account) throw new Error("unknown posting account");
      const amount = BigInt(leg.cents);
      balance += leg.side === "debit" ? amount : -amount;
      const debitNormal = ["cash", "position", "tax_credit", "expense"].includes(account.kind);
      const delta = (leg.side === "debit") === debitNormal ? amount : -amount;
      closing.set(account.id, closing.get(account.id)! + delta);
    }
    if (balance !== 0n) throw new Error("unbalanced transaction");
  }
  const totals = { cash: 0n, netWorth: 0n, income: 0n, expense: 0n, equity: 0n };
  for (const account of accounts.values()) {
    const ending = closing.get(account.id)!;
    const delta = ending - BigInt(account.openingCents);
    if (["cash", "position", "tax_credit", "liability"].includes(account.kind) && ending < 0n) throw new Error("negative financial balance");
    if (account.kind === "cash") totals.cash += delta;
    if (["cash", "position", "tax_credit"].includes(account.kind)) totals.netWorth += delta;
    if (account.kind === "liability") totals.netWorth -= delta;
    if (account.kind === "income") totals.income += delta;
    if (account.kind === "expense") totals.expense += delta;
    if (account.kind === "equity") totals.equity += delta;
  }
  if (totals.netWorth !== totals.income - totals.expense + totals.equity) throw new Error("net worth recognition mismatch");
  return {
    closingCents: Object.fromEntries([...closing.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, value]) => [id, value.toString()])),
    cashDeltaCents: totals.cash.toString(),
    netWorthDeltaCents: totals.netWorth.toString(),
    recognition: { incomeCents: totals.income.toString(), expenseCents: totals.expense.toString() },
  };
}

export function verifyCatalog(value: unknown) {
  const catalog = catalogSchema.parse(value);
  const ids = new Set<string>();
  for (const item of catalog.cases) {
    if (ids.has(item.id)) throw new Error("duplicate case");
    ids.add(item.id);
    if (item.period.start >= item.period.endExclusive) throw new Error("empty or reversed period");
    const identities = new Set(item.input.identities);
    if (identities.size !== item.input.identities.length) throw new Error("duplicate identity");
    for (const account of item.input.accounts) {
      if (!identities.has(account.owner)) throw new Error("unknown account owner");
      if (["cash", "position", "tax_credit", "liability"].includes(account.kind) && BigInt(account.openingCents) < 0n) throw new Error("negative financial balance");
    }
    if (!item.expected.effects && item.input.accounts.length > 0) throw new Error("unresolved state must not imply a closing balance");
    const reconciled = reconcileStatedEffects(item);
    if (reconciled) {
      const effects = item.expected.effects!;
      for (const [key, fact] of Object.entries(effects.facts)) if (key.endsWith("Cents")) centsSchema.parse(fact);
      if (JSON.stringify(reconciled.closingCents) !== JSON.stringify(Object.fromEntries(Object.entries(effects.closingCents).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))) throw new Error("closing balance mismatch");
      if (reconciled.cashDeltaCents !== effects.cashDeltaCents || reconciled.netWorthDeltaCents !== effects.netWorthDeltaCents || reconciled.recognition.incomeCents !== effects.recognition.incomeCents || reconciled.recognition.expenseCents !== effects.recognition.expenseCents) throw new Error("expected effect mismatch");
    }
  }
  return catalog;
}
