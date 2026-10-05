import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft, type AccountingTransaction } from "../accounting/index.js";
import { ValidationError } from "../diagnostics/index.js";
import { domainId } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../lineage/index.js";
import { emptyTaxIncome, taxBalanceIds } from "./tax/participant.js";
import { applyAccountingTransactionAtomically, cloneAuthoritativeState } from "../state/index.js";
import { instant } from "../time/index.js";
import { effectiveCompoundingPeriodReturn } from "../primitives/evaluation.js";
import { decimal, Currency, Money, Quantity, Rate, rateConvention, RoundingPolicy, SHARE, Unit } from "../values/index.js";
import type { HouseholdKernelParticipant } from "./householdExecution.js";
import type { HouseholdOperationFacts } from "./r3/domainOperations.js";
import type { OperationState } from "./r3/operations.js";
import { immutableConfiguration } from "./r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "./r3/participantCodec.js";
import { taxDiagnostic, type RecognizedTaxEconomics, type TaxCapabilityDiagnostic } from "./tax/contracts.js";

export interface DomainLot { readonly id: string; readonly acquired: string; readonly quantity: string; readonly basis: string }
export interface DomainHolding {
  readonly id: string; readonly accountId: string;
  readonly kind: "equity" | "fund" | "crypto" | "long_equity_call" | "treasury_bill" | "treasury_note" | "treasury_bond" | "cd";
  readonly lots: readonly DomainLot[]; readonly afterTaxBasis?: string;
  readonly underlyingId?: string; readonly strike?: string; readonly multiplier?: string; readonly expiration?: string;
}
export type DomainOperationKind = "purchase" | "sale" | "ordinary_dividend" | "qualified_dividend" | "interest" | "cash_interest" | "treasury_interest" | "reinvest_dividend" | "maturity" | "call_expiration" | "call_exercise" | "conversion" | "direct_rollover" | "mixed_rollover" | "indirect_distribution" | "indirect_deposit" | "insurance_premium" | "death_benefit";
export interface DomainOperation {
  readonly id: string; readonly at: string; readonly order: number; readonly kind: DomainOperationKind;
  readonly holdingId?: string; readonly destinationHoldingId?: string; readonly rothHoldingId?: string;
  readonly cashAccountId?: string; readonly amount: string; readonly quantity?: string; readonly lotIds?: readonly string[];
  readonly linkedOperationId?: string; readonly sourceAccountId?: string; readonly replacementAmount?: string;
  readonly annualEffectiveRate?: string;
  readonly taxFacts: RecognizedTaxEconomics["facts"];
}
export interface DomainMechanicsInput { readonly currency: string; readonly holdings: readonly DomainHolding[]; readonly operations: readonly DomainOperation[] }
interface DomainRuntime {
  readonly lots: Readonly<Record<string, readonly DomainLot[]>>;
  readonly basis: Readonly<Record<string, string>>;
  readonly receipts: Readonly<Record<string, { readonly at: string; readonly gross: string; readonly received: string; readonly accountId: string }>>;
}
const fail = (code: string, message: string): never => { throw new ValidationError({ severity: "error", code, message, entityType: "domain_mechanics" }); };
const precision = new RoundingPolicy(18, "half_even");
const q = (value: string) => Quantity.parse(value, SHARE);
const runtimeFor = (opening: OperationState, input: DomainMechanicsInput): DomainRuntime => (opening.runtime?.domainMechanics as DomainRuntime | undefined) ?? {
  lots: Object.fromEntries(input.holdings.map(item => [item.id, item.lots])),
  basis: Object.fromEntries(input.holdings.map(item => [item.id, item.afterTaxBasis ?? "0"])), receipts: {},
};
/** A holding period must exceed one calendar year; exactly one year is short-term. */
export const longTermHolding = (acquired: string, disposed: string): boolean =>
  disposed.slice(0, 10) > String(Number(acquired.slice(0, 4)) + 1) + acquired.slice(4);

/** All effects and basis changes are returned as one isolated candidate. */
export const executeDomainOperation = (opening: OperationState, input: DomainMechanicsInput, operation: DomainOperation): OperationState & { readonly facts: HouseholdOperationFacts } => {
  const currency = Currency.of(input.currency), zero = Money.zero(currency), rounding = new RoundingPolicy(currency.minorUnitScale, "half_even");
  const at = instant(operation.at), amount = Money.parse(operation.amount, currency);
  if (amount.isNegative() || !amount.amount.fitsScale(currency.minorUnitScale)) fail("DOMAIN_AMOUNT_INVALID", "Use nonnegative money at cash settlement precision.");
  const state = cloneAuthoritativeState(opening.state), prior = runtimeFor(opening, input);
  const lots = { ...prior.lots }, basis = { ...prior.basis }, receipts = { ...prior.receipts };
  const transactions: AccountingTransaction[] = [], taxEconomics: RecognizedTaxEconomics[] = [], taxDiagnostics: TaxCapabilityDiagnostic[] = [];
  const traces = [calculationTraceRef(calculationTraceId("compiler:canonical:Event:" + operation.id))];
  const holding = input.holdings.find(item => item.id === operation.holdingId);
  const position = holding === undefined ? undefined : state.positions[holding.id];
  const cash = (id: string | undefined, bank = false) => {
    const account = id === undefined ? undefined : state.accounts[id];
    if (!account || bank && account.kind !== "checking" && account.kind !== "savings") return fail("DOMAIN_FUNDING_ACCOUNT_UNSUPPORTED", "Select an explicit checking or savings account for personally funded operations.");
    if (!account.cash.currency.equals(currency)) return fail("DOMAIN_CURRENCY_UNSUPPORTED", "Cross-currency settlement is unavailable.");
    return account;
  };
  const post = (suffix: string, legs: readonly AccountingLegDraft[]) => {
    const transaction = createAccountingTransaction({ id: accountingTransactionId("domain:" + operation.id + ":" + suffix), type: operation.kind, date: at, legs: legs.map(createAccountingLeg), traceRefs: traces });
    applyAccountingTransactionAtomically(state, transaction); transactions.push(transaction);
  };
  const cashLeg = (id: string, value: Money, posting: "debit" | "credit", financing = false): AccountingLegDraft =>
    ({ type: "cash", posting, amount: value, accountId: domainId("account", id), cashFlowClass: financing ? "financing" : "investing" });
  const assetLeg = (id: string, value: Money, quantity: Quantity, posting: "debit" | "credit"): AccountingLegDraft =>
    ({ type: "asset", posting, amount: value, entityId: domainId("position", id), quantity });
  const tax = (field: keyof ReturnType<typeof emptyTaxIncome>, value: Money, exempt = false) => {
    const priorFact = taxEconomics.pop();
    taxEconomics.push({ sourceId: operation.id, at, income: { ...(priorFact?.income ?? emptyTaxIncome()), [field]: value }, allocation: "1", facts: operation.taxFacts, traceRefs: traces, ...(exempt ? { exemptStateLocalInterest: value } : {}) });
  };
  const requirePosition = () => position ?? fail("DOMAIN_POSITION_MISSING", "The selected holding is unavailable in committed state.");
  const addLot = (id: string, units: Quantity, cost: Money) => {
    lots[id] = [...(lots[id] ?? []), { id: operation.id + ":lot", acquired: at.slice(0, 10), quantity: units.amount.toString(), basis: cost.amount.toString() }];
  };
  const fund = (id: string | undefined, value: Money) => {
    const account = cash(id, true);
    if (account.cash.compare(value) < 0) fail("DOMAIN_INSUFFICIENT_CASH", "The selected checking/savings account cannot fund this operation.");
    return account;
  };
  const settleIncome = (value: Money, field: "taxableInterest" | "ordinaryDividends" | "qualifiedDividends", treasury = false) => {
    const destination = cash(operation.cashAccountId ?? holding?.accountId);
    if (holding && destination.id !== holding.accountId) fail("DOMAIN_WRAPPER_SETTLEMENT_REQUIRED", "Investment income settles in its owning wrapper. Author a separate transfer to move it to household cash.");
    post("income", [cashLeg(destination.id, value, "debit"), { type: "income", posting: "credit", amount: value }]);
    tax(field, value, treasury); return destination;
  };
  const takeLots = (requested: Quantity) => {
    const target = requirePosition();
    if (!requested.amount.isPositive() || requested.compare(target.quantity) > 0) fail("DOMAIN_QUANTITY_UNAVAILABLE", "Only owned units in this holding can be disposed.");
    const available = [...(lots[target.id] ?? [])];
    if (operation.lotIds && (new Set(operation.lotIds).size !== operation.lotIds.length || operation.lotIds.some(id => !available.some(lot => lot.id === id)))) fail("DOMAIN_LOT_SELECTION_INVALID", "Select unique lots belonging to this holding and wallet/account.");
    const selected = operation.lotIds ? operation.lotIds.map(id => available.find(lot => lot.id === id)!) : available.sort((a, b) => a.acquired.localeCompare(b.acquired) || a.id.localeCompare(b.id));
    let remaining = requested, cost = zero, shortCost = zero, longCost = zero, longQuantity = q("0");
    const replacements = new Map<string, DomainLot>();
    for (const lot of selected) {
      if (remaining.amount.isZero()) break;
      if (lot.acquired > at.slice(0, 10)) fail("DOMAIN_LOT_DATE_INVALID", "A sale cannot precede acquisition.");
      const availableQuantity = q(lot.quantity), used = remaining.compare(availableQuantity) < 0 ? remaining : availableQuantity;
      const wholeCost = Money.parse(lot.basis, currency), usedCost = used.equals(availableQuantity) ? wholeCost : wholeCost.times(used.amount.dividedBy(availableQuantity.amount, precision)).round(rounding);
      cost = cost.plus(usedCost); remaining = remaining.minus(used);
      if (longTermHolding(lot.acquired, at)) { longCost = longCost.plus(usedCost); longQuantity = longQuantity.plus(used); }
      else shortCost = shortCost.plus(usedCost);
      replacements.set(lot.id, { ...lot, quantity: availableQuantity.minus(used).amount.toString(), basis: wholeCost.minus(usedCost).amount.toString() });
    }
    if (!remaining.amount.isZero()) fail("DOMAIN_BASIS_UNAVAILABLE", "Explicit acquisition dates and economic cost basis are required for every disposed unit.");
    lots[target.id] = (lots[target.id] ?? []).map(lot => replacements.get(lot.id) ?? lot).filter(lot => decimal(lot.quantity).isPositive());
    return { cost, shortCost, longCost, longQuantity };
  };
  const dispose = (requested: Quantity, proceeds: Money) => {
    const target = requirePosition(), selected = takeLots(requested);
    const carrying = requested.equals(target.quantity) ? target.carryingValue : target.carryingValue.times(requested.amount.dividedBy(target.quantity.amount, precision)).round(rounding);
    const delta = proceeds.minus(carrying), destination = cash(operation.cashAccountId ?? holding?.accountId);
    if (destination.id !== target.accountId) fail("DOMAIN_WRAPPER_SETTLEMENT_REQUIRED", "Sale proceeds remain in the holding's wrapper cash.");
    post("disposition", [cashLeg(destination.id, proceeds, "debit"), assetLeg(target.id, carrying, requested, "credit"),
      { type: delta.isNegative() ? "loss" : "gain", posting: delta.isNegative() ? "debit" : "credit", amount: delta.isNegative() ? delta.negated() : delta }]);
    const longProceeds = proceeds.times(selected.longQuantity.amount.dividedBy(requested.amount, precision)).round(rounding);
    tax("longTermGains", longProceeds.minus(selected.longCost)); tax("shortTermGains", proceeds.minus(longProceeds).minus(selected.shortCost));
  };
  const retireDestination = (id: string | undefined, value: Money): AccountingLegDraft => {
    const target = id === undefined ? undefined : state.positions[id];
    if (!target || !target.price.isPositive()) return fail("DOMAIN_RETIREMENT_DESTINATION_REQUIRED", "Choose an eligible retirement destination with an explicit price.");
    return assetLeg(target.id, value, q(value.amount.dividedBy(target.price.amount, precision).toString()), "debit");
  };
  switch (operation.kind) {
    case "purchase": {
      const target = requirePosition(), source = fund(operation.cashAccountId, amount), units = q(operation.quantity ?? fail("DOMAIN_QUANTITY_REQUIRED", "Enter purchased units."));
      if (!units.amount.isPositive() || !target.price.times(units.amount).equals(amount)) fail("DOMAIN_PURCHASE_PRICE_MISMATCH", "Purchased units times price must equal cash cost.");
      post("purchase", [assetLeg(target.id, amount, units, "debit"), cashLeg(source.id, amount, "credit")]); addLot(target.id, units, amount); break;
    }
    case "sale": dispose(q(operation.quantity ?? fail("DOMAIN_QUANTITY_REQUIRED", "Enter units to sell.")), amount); break;
    case "call_expiration": {
      if (!holding || holding.kind !== "long_equity_call" || at.slice(0, 10) !== holding.expiration) fail("DOMAIN_OPTION_EXPIRATION_INVALID", "Call lapse must occur on its expiration date.");
      dispose(requirePosition().quantity, zero); break;
    }
    case "call_exercise": {
      if (!holding || holding.kind !== "long_equity_call" || !holding.strike || !holding.multiplier || !holding.underlyingId || at.slice(0, 10) > holding.expiration!) fail("DOMAIN_OPTION_EXERCISE_UNSUPPORTED", "Exercise requires an unexpired long listed equity call with explicit terms.");
      const target = requirePosition(), contracts = q(operation.quantity ?? target.quantity.amount.toString());
      const stockQuantity = q(contracts.amount.times(decimal(holding.multiplier!)).toString()), strikeCash = Money.parse(holding.strike!, currency).times(stockQuantity.amount).round(rounding);
      if (!strikeCash.equals(amount)) fail("DOMAIN_EXERCISE_CASH_MISMATCH", "Exercise cash must equal strike times contracts times multiplier.");
      const source = fund(operation.cashAccountId, strikeCash), selected = takeLots(contracts), stock = state.positions[holding.underlyingId!];
      if (!stock || stock.accountId !== target.accountId) fail("DOMAIN_OPTION_UNDERLYING_INVALID", "Acquired stock must be in the same taxable wrapper.");
      const removedValue = contracts.equals(target.quantity) ? target.carryingValue : target.carryingValue.times(contracts.amount.dividedBy(target.quantity.amount, precision)).round(rounding);
      // Reverse any call mark-to-market; exercise itself recognizes no realized call gain.
      const reversal = removedValue.minus(selected.cost);
      post("exercise", [assetLeg(stock!.id, selected.cost.plus(strikeCash), stockQuantity, "debit"), assetLeg(target.id, removedValue, contracts, "credit"), cashLeg(source.id, strikeCash, "credit"),
        { type: "gain", posting: reversal.isNegative() ? "credit" : "debit", amount: reversal.isNegative() ? reversal.negated() : reversal }]);
      addLot(stock!.id, stockQuantity, selected.cost.plus(strikeCash)); break;
    }
    case "ordinary_dividend": settleIncome(amount, "ordinaryDividends"); break;
    case "qualified_dividend": settleIncome(amount, "qualifiedDividends"); break;
    case "interest": settleIncome(amount, "taxableInterest"); break;
    case "cash_interest": {
      const account = cash(operation.cashAccountId, true);
      const periodic = effectiveCompoundingPeriodReturn(Rate.fromDecimal(operation.annualEffectiveRate ?? fail("DOMAIN_RATE_REQUIRED", "Enter an explicit effective annual rate."), rateConvention.effectiveAnnual()),
        { kind: "effective_annual", yearFraction: { numerator: 1, denominator: 12 }, calculationRounding: precision });
      settleIncome(account.cash.times(periodic).round(rounding), "taxableInterest"); break;
    }
    case "treasury_interest": settleIncome(amount, "taxableInterest", true); break;
    case "reinvest_dividend": {
      const target = requirePosition(), destination = settleIncome(amount, "ordinaryDividends"), units = q(operation.quantity ?? fail("DOMAIN_QUANTITY_REQUIRED", "Enter reinvested units."));
      if (!units.amount.isPositive() || !target.price.times(units.amount).equals(amount)) fail("DOMAIN_REINVESTMENT_PRICE_MISMATCH", "Reinvested units times price must equal recognized income.");
      post("reinvestment", [assetLeg(target.id, amount, units, "debit"), cashLeg(destination.id, amount, "credit")]); addLot(target.id, units, amount); break;
    }
    case "maturity": {
      const target = requirePosition(), destination = cash(operation.cashAccountId), principal = target.carryingValue;
      if (!holding || !["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(holding.kind) || amount.compare(principal) < 0) fail("DOMAIN_MATURITY_UNSUPPORTED", "Only admitted held-to-maturity contracts can repay principal.");
      const interest = amount.minus(principal);
      post("maturity", [cashLeg(destination.id, amount, "debit"), assetLeg(target.id, principal, target.quantity, "credit"), { type: "income", posting: "credit", amount: interest }]);
      if (interest.isPositive()) tax("taxableInterest", interest, holding!.kind !== "cd"); lots[target.id] = []; break;
    }
    case "insurance_premium": {
      const source = fund(operation.cashAccountId, amount);
      post("premium", [{ type: "expense", posting: "debit", amount }, { type: "cash", posting: "credit", amount, accountId: source.id, cashFlowClass: "operating" }]); break;
    }
    case "death_benefit": {
      const destination = cash(operation.cashAccountId, true);
      post("benefit", [{ type: "cash", posting: "debit", amount, accountId: destination.id, cashFlowClass: "operating" }, { type: "income", posting: "credit", amount }]); break;
    }
    case "conversion": case "direct_rollover": case "mixed_rollover": case "indirect_distribution": {
      const target = requirePosition();
      if (!amount.isPositive() || amount.compare(target.carryingValue) > 0) fail("DOMAIN_RETIREMENT_OWNED_VALUE_REQUIRED", "Only eligible owned and vested retirement value can move.");
      const units = amount.equals(target.carryingValue) ? target.quantity : q(target.quantity.amount.times(amount.amount.dividedBy(target.carryingValue.amount, precision)).toString());
      const openingBasis = Money.parse(basis[target.id] ?? fail("DOMAIN_RETIREMENT_BASIS_REQUIRED", "Previously taxed basis must be explicitly established."), currency);
      if (openingBasis.compare(target.carryingValue) > 0) fail("DOMAIN_RETIREMENT_BASIS_INVALID", "Previously taxed basis cannot exceed eligible source value in this floor.");
      const recovered = amount.equals(target.carryingValue) ? openingBasis : openingBasis.times(amount.amount.dividedBy(target.carryingValue.amount, precision)).round(rounding);
      const taxable = amount.minus(recovered);
      basis[target.id] = openingBasis.minus(recovered).amount.toString();
      if (operation.kind === "indirect_distribution") {
        if (!recovered.isZero()) fail("DOMAIN_INDIRECT_AFTER_TAX_UNSUPPORTED", "The participant-received floor accepts entirely pre-tax employer-plan value.");
        const destination = cash(operation.cashAccountId, true), withheld = amount.times(decimal("0.20")).round(rounding), received = amount.minus(withheld);
        const creditId = taxBalanceIds("US:FEDERAL", at.slice(0, 4)).creditPositionId, unit = Unit.of("usd_tax_credit");
        state.positions[creditId] ??= { id: creditId, accountId: destination.id, quantity: Quantity.zero(unit), price: Money.parse("1", currency), carryingValue: zero };
        post("distribution", [cashLeg(destination.id, received, "debit", true), { type: "asset", posting: "debit", amount: withheld, entityId: creditId, quantity: Quantity.parse(withheld.amount.toString(), unit) }, assetLeg(target.id, amount, units, "credit")]);
        receipts[operation.id] = { at, gross: amount.amount.toString(), received: received.amount.toString(), accountId: destination.id };
        tax("traditionalDistributions", amount);
        taxDiagnostics.push(taxDiagnostic("indirect_rollover_pending", "Taxation is incomplete until an eligible deposit is completed within 60 days; an unreplaced amount may incur additional tax.", undefined, operation.id));
      } else {
        const destinations = operation.kind === "mixed_rollover"
          ? [retireDestination(operation.destinationHoldingId, taxable), retireDestination(operation.rothHoldingId, recovered)]
          : [retireDestination(operation.destinationHoldingId, amount)];
        post("retirement_transfer", [assetLeg(target.id, amount, units, "credit"), ...destinations]);
        if (operation.kind === "mixed_rollover") basis[operation.rothHoldingId!] = Money.parse(basis[operation.rothHoldingId!] ?? "0", currency).plus(recovered).amount.toString();
        else basis[operation.destinationHoldingId!] = Money.parse(basis[operation.destinationHoldingId!] ?? "0", currency).plus(operation.kind === "conversion" ? amount : recovered).amount.toString();
        if (operation.kind === "conversion") tax("traditionalDistributions", taxable);
      }
      break;
    }
    case "indirect_deposit": {
      const receipt = receipts[operation.linkedOperationId ?? ""] ?? fail("DOMAIN_ROLLOVER_RECEIPT_REQUIRED", "Link the deposit to one eligible participant-received distribution.");
      const days = (Date.parse(at) - Date.parse(receipt.at)) / 86400000;
      if (days < 0 || days > 60) {
        taxDiagnostics.push(taxDiagnostic("rollover_deadline", "The 60-day deadline was missed. The distribution remains taxable and additional-tax coverage is unavailable.", undefined, operation.id)); break;
      }
      if (at.slice(0, 4) !== receipt.at.slice(0, 4)) fail("DOMAIN_CROSS_YEAR_INDIRECT_UNSUPPORTED", "A cross-tax-year deposit requires prior-year tax revision semantics.");
      const gross = Money.parse(receipt.gross, currency), received = Money.parse(receipt.received, currency), replacement = Money.parse(operation.replacementAmount ?? "0", currency);
      if (!amount.isPositive() || amount.compare(gross) > 0 || replacement.isNegative() || amount.minus(replacement).isNegative() || amount.minus(replacement).compare(received) > 0) fail("DOMAIN_ROLLOVER_DEPOSIT_INVALID", "Deposit received proceeds plus explicit replacement cash, up to the gross distribution.");
      const participant = fund(receipt.accountId, amount.minus(replacement)), source = replacement.isPositive() ? fund(operation.sourceAccountId, replacement) : undefined;
      if (source?.id === participant.id && participant.cash.compare(amount) < 0) fail("DOMAIN_INSUFFICIENT_CASH", "Combined proceeds and replacement cash exceed available cash.");
      post("deposit", [retireDestination(operation.destinationHoldingId, amount), cashLeg(participant.id, amount.minus(replacement), "credit", true), ...(source ? [cashLeg(source.id, replacement, "credit", true)] : [])]);
      tax("traditionalDistributions", amount.negated());
      if (amount.compare(gross) < 0) taxDiagnostics.push(taxDiagnostic("early_distribution_additional_tax", "The unreplaced distribution requires additional-tax eligibility and rule coverage.", undefined, operation.id));
      delete receipts[operation.linkedOperationId!]; break;
    }
  }
  return { state, primitiveState: opening.primitiveState, runtime: { ...opening.runtime, domainMechanics: { lots, basis, receipts } },
    facts: { transactions, traceRefs: traces, taxEconomics, taxDiagnostics,
      ...(operation.kind === "indirect_deposit" && transactions.length ? { resolvedTaxDiagnosticSourceIds: [operation.linkedOperationId!] } : {}) } };
};

export const createDomainMechanicsParticipant = (configuration: DomainMechanicsInput): HouseholdKernelParticipant => {
  const input = immutableConfiguration(configuration);
  if (new Set(input.operations.map(item => item.id)).size !== input.operations.length) fail("DOMAIN_ID_DUPLICATE", "Each operation requires one stable identity.");
  return Object.freeze({ id: "domain_mechanics", version: "d1b-v1", portableCodec: "domain-mechanics/v1", economicInputs: input,
    prepare: (_context, period, _opening, work = []) => ({ id: "domain_mechanics", operations: input.operations.filter(item => period.start <= item.at && item.at < period.end).map(operation => ({
      descriptor: { id: "domain:" + operation.id, domain: "domain_mechanics", operationClass: "domain:" + operation.kind, sequencingInstant: instant(operation.at),
        dependsOn: [...input.operations.filter(other => other.at === operation.at && other.order < operation.order).map(other => "domain:" + other.id), ...work.filter(item => item.sequencingInstant === operation.at && item.operationClass === "cash_income_settlement").map(item => item.id)],
        resourceAccesses: [...new Set([operation.cashAccountId, operation.sourceAccountId, input.holdings.find(item => item.id === operation.holdingId)?.accountId].filter((id): id is string => id !== undefined))]
          .map(id => ({ kind: "account_cash" as const, accountId: domainId("account", id), mode: "consume" as const })), traceRefs: [] },
      execute: opening => executeDomainOperation(opening, input, operation),
    })) }),
  } satisfies HouseholdKernelParticipant);
};
registerHouseholdParticipantCodec({ codec: "domain-mechanics/v1", restore: input => createDomainMechanicsParticipant(input as DomainMechanicsInput) });
