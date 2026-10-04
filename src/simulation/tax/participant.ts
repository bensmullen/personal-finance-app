import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft, type AccountingTransaction } from "../../accounting/index.js";
import { ValidationError } from "../../diagnostics/index.js";
import { domainId } from "../../identity/index.js";
import { isAcceptedFundingResolution, resolveFunding, type ConstraintOutcome, type LiquidityShortfall } from "../../funding/index.js";
import { calculationTraceId, calculationTraceRef, mergeTraceRefs } from "../../lineage/index.js";
import { createFactProvenance } from "../../model/provenance.js";
import { resolveTaxCoreRule, taxCatalogFingerprint } from "../../rules/tax/catalog.js";
import { applyTaxCoreRule } from "../../rules/tax/calculator.js";
import { recognizeTaxLegalBases } from "../../rules/tax/recognition.js";
import type { TaxIncomeFacts, TaxJurisdictionFacts } from "../../rules/tax/contracts.js";
import { applySettlement, claimId, createObligation, createRecognitionFact, createSettlement, createSettlementProposal, recognitionId, settlementId, settlementProposalId } from "../../semantics/index.js";
import { applyAccountingTransactionAtomically, authoritativeClaimHistory, registerAuthoritativeIdentity } from "../../state/index.js";
import { subtractMilliseconds, type Instant } from "../../time/index.js";
import { decimal, money, Money, Quantity, Unit, USD } from "../../values/index.js";
import type { HouseholdKernelParticipant } from "../householdExecution.js";
import { canonicalSerialize } from "../run.js";
import { immutableConfiguration } from "../r3/compiledHousehold.js";
import { SummaryOperationSink } from "../r3/summarySink.js";
import { activeTaxFact, resolveTaxEligibility } from "./facts.js";
import { TaxEconomicLedger } from "./economics.js";
import { TaxDiagnosticLedger } from "./diagnostics.js";
import { taxDiagnostic, taxOutputCapabilities, type CompiledTaxIncome, type HouseholdTaxInput, type RecognizedTaxEconomics, type TaxCapabilityDiagnostic } from "./contracts.js";

const creditUnit = Unit.of("usd_tax_credit");
const zero = () => Money.zero(USD);
export const emptyTaxIncome = (): TaxIncomeFacts => Object.freeze({ wages: zero(), taxableInterest: zero(), ordinaryDividends: zero(), qualifiedDividends: zero(), shortTermGains: zero(), longTermGains: zero(), traditionalContributions: zero(), eligibleTraditionalDeduction: zero(), traditionalDistributions: zero(), traditionalDistributionBasisRecovered: zero(), rothContributions: zero(), rothDistributions: zero(), taxableRothDistributions: zero() });
const sumIncome = (inputs: readonly TaxIncomeFacts[]): TaxIncomeFacts => Object.freeze(Object.fromEntries(Object.keys(emptyTaxIncome()).map(key => [key, inputs.reduce((sum, input) => sum.plus(input[key as keyof TaxIncomeFacts]), zero())])) as unknown as TaxIncomeFacts);
interface TaxYearRuntime {
  readonly paymentTraceRefs?: Readonly<Record<string, RecognizedTaxEconomics["traceRefs"]>>;
  readonly economics: TaxEconomicLedger;
  readonly liabilities: Readonly<Record<string, Money>>;
  readonly diagnostics: TaxDiagnosticLedger;
}
interface TaxRuntime { readonly years: Readonly<Record<string, TaxYearRuntime>> }
const taxRuntime = (runtime: Readonly<Record<string, unknown>>): TaxRuntime => runtime.tax as TaxRuntime | undefined ?? { years: {} };
const yearRuntime = (runtime: TaxRuntime, year: string): TaxYearRuntime => runtime.years[year] ?? { economics: TaxEconomicLedger.empty(), liabilities: {}, diagnostics: TaxDiagnosticLedger.empty() };
const withYear = (runtime: Readonly<Record<string, unknown>>, year: string, value: Omit<TaxYearRuntime, "diagnostics"> & { readonly diagnostics: TaxDiagnosticLedger | readonly TaxCapabilityDiagnostic[] }): Readonly<Record<string, unknown>> => Object.freeze({ ...runtime, tax: Object.freeze({ years: Object.freeze({ ...taxRuntime(runtime).years, [year]: immutableConfiguration({ ...value, diagnostics: value.diagnostics instanceof TaxDiagnosticLedger ? value.diagnostics : TaxDiagnosticLedger.empty().with(value.diagnostics) }) }) }) });

/** Characterization follows authored Income; no sales, withdrawals, or RMDs are invented. */
const incomeFacts = (source: CompiledTaxIncome, amount: Money): TaxIncomeFacts | undefined => {
  if (source.grossOrNet === "net") return undefined;
  const facts = { ...emptyTaxIncome() };
  if (source.taxCharacter === "tax_free") return facts;
  if (["salary", "bonus", "commission", "overtime", "severance"].includes(source.incomeType) && source.taxCharacter === "ordinary") facts.wages = amount;
  else if (source.incomeType === "interest" && source.taxCharacter === "ordinary") facts.taxableInterest = amount;
  else if (source.incomeType === "dividend" && source.taxCharacter === "ordinary") facts.ordinaryDividends = amount;
  else if (source.incomeType === "dividend" && source.taxCharacter === "qualified_dividend") facts.qualifiedDividends = amount;
  else if (source.incomeType === "capital_gain" && source.taxCharacter === "short_term_capital_gain") facts.shortTermGains = amount;
  else if (source.incomeType === "capital_gain" && source.taxCharacter === "long_term_capital_gain") facts.longTermGains = amount;
  else return undefined;
  return Object.freeze(facts);
};
const jurisdictionKey = (value: string): string => /^US-[A-Z]{2}$/.test(value) ? value.replace("-", ":") : value;
/** Stable per-regime balance identities, independent of rule version/catalog ordering. */
const balanceIds = (jurisdiction: string, year: string) => {
  let hash = 14695981039346656037n;
  for (const character of `${jurisdiction}:${year}`) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
  const suffix = (hash & 0xffffffffffffn).toString(16).padStart(12, "0");
  return { liabilityId: domainId("liability", `f15c0000-0000-4000-8a01-${suffix}`), creditPositionId: domainId("position", `f15c0000-0000-4000-8a02-${suffix}`) };
};
export const taxCreditPositionIds = (input: HouseholdTaxInput) => {
  const jurisdictions = [...new Set([...input.catalog.map(rule => rule.jurisdiction), ...input.payments.map(payment => payment.jurisdiction), ...(input.settlements ?? []).map(item => item.jurisdiction)])].sort();
  const years = [...new Set([...input.catalog.flatMap(rule => [rule.effectiveFrom.slice(0, 4), subtractMilliseconds(rule.effectiveUntil, 1).slice(0, 4)]), ...input.payments.map(payment => payment.at.slice(0, 4)), ...(input.settlements ?? []).map(item => item.taxYear)])].sort();
  return Object.freeze(jurisdictions.flatMap(jurisdiction => years.map(year => balanceIds(jurisdiction, year).creditPositionId)));
};

export const createHouseholdTaxParticipant = (configuration: HouseholdTaxInput): HouseholdKernelParticipant => {
  const input = immutableConfiguration(configuration);
  const sources = new Map(input.incomes.map(income => [income.id, income]));
  const fingerprint = taxCatalogFingerprint(input.catalog);
  const bindings = new Map<string, ReturnType<typeof resolveTaxCoreRule> | ValidationError>();
  const binding = (jurisdiction: string, at: Instant, facts: TaxJurisdictionFacts) => {
    const key = canonicalSerialize({ jurisdiction, at, facts, status: input.filingStatus });
    const cached = bindings.get(key);
    if (cached instanceof ValidationError) throw cached;
    if (cached !== undefined) return cached;
    try {
      const selected = resolveTaxCoreRule(input.catalog, jurisdiction, input.filingStatus!, at, facts);
      bindings.set(key, selected); return selected;
    } catch (error) {
      if (error instanceof ValidationError) bindings.set(key, error);
      throw error;
    }
  };
  return Object.freeze({
    id: "tax", version: "t1a-household-v1", portableCodec: "household-tax/v1", economicInputs: Object.freeze({ ...input, catalogFingerprint: fingerprint }),
    observe: (descriptor, facts, runtime) => {
      if (descriptor.operationClass !== "cash_income_settlement") return runtime;
      const id = descriptor.id.split(":")[1]!;
      const source = sources.get(id);
      const amount = facts.cash?.recurringIncomeRecognized ?? facts.summary?.cash?.recurringIncomeRecognized;
      if (amount === undefined || !amount.isPositive()) return runtime;
      const at = descriptor.sequencingInstant, date = at.slice(0, 10), year = at.slice(0, 4);
      const prior = yearRuntime(taxRuntime(runtime), year);
      const diagnostics: TaxCapabilityDiagnostic[] = [];
      const income = source === undefined ? undefined : incomeFacts(source, amount);
      if (source === undefined || income === undefined) return withYear(runtime, year, { ...prior, diagnostics: prior.diagnostics.with([taxDiagnostic("income_character", `Unsupported recognized Income ${id}; business, rental, equity compensation and uncharacterized distributions require separate semantics.`, undefined, id)]) });
      if (Object.values(income).every(value => value.isZero())) return runtime;
      const residence = source.residence.find(period => activeTaxFact(period, date));
      if (residence === undefined) diagnostics.push(taxDiagnostic("residence_jurisdiction_periods", "Effective residence tax facts are missing; coarse jurisdiction is not substituted.", undefined, id));
      const work = source.work.filter(period => activeTaxFact(period, date));
      const monthStart = `${date.slice(0, 7)}-01`;
      if (source.work.some(period => [period.effective_date, period.expiration_date].some(boundary => boundary !== undefined && boundary > monthStart && boundary.slice(0, 7) === date.slice(0, 7)))) diagnostics.push(taxDiagnostic("earned_service_interval", "Intra-month service-location changes require an authoritative wage-to-service interval allocation; pay date alone cannot establish that base.", undefined, id));
      if (income.wages.isPositive() && !work.length) diagnostics.push(taxDiagnostic("work_service_jurisdiction_allocations", "Employment service location is unknown; employer or residence is not substituted.", undefined, id));
      const eligibility = resolveTaxEligibility([...input.eligibility, ...source.eligibility], date);
      const traces = mergeTraceRefs(facts.cash?.traceRefs, facts.summary?.evidence.sources,
        [calculationTraceRef(calculationTraceId(`compiler:canonical:Income:${id}:tax`))]) ?? [];
      // Federal/state residence economics are recorded once; work allocations remain separate facts.
      const base: RecognizedTaxEconomics = { sourceId: id, at, income, allocation: "1", facts: {
        residenceJurisdictions: residence === undefined ? [] : [jurisdictionKey(residence.state_jurisdiction), ...(residence.local_jurisdiction === undefined ? [] : [residence.local_jurisdiction])], workJurisdictions: [],
        ...(residence?.municipality === undefined ? {} : { residenceMunicipality: residence.municipality }), ...(residence?.psd_code === undefined ? {} : { residencePsdCode: residence.psd_code }), eligibility,
      }, traceRefs: traces };
      const allocated = work.map(period => ({ ...base, allocation: period.allocation, facts: { ...base.facts, workJurisdictions: [jurisdictionKey(period.state_jurisdiction), ...(period.local_jurisdiction === undefined ? [] : [period.local_jurisdiction])],
        ...(period.municipality === undefined ? {} : { workMunicipality: period.municipality }), ...(period.psd_code === undefined ? {} : { workPsdCode: period.psd_code }) } }));
      const slices = new Map<string, RecognizedTaxEconomics>();
      for (const entry of allocated.length ? allocated : [base]) {
        const key = canonicalSerialize(entry.facts), existing = slices.get(key);
        slices.set(key, existing === undefined ? entry : { ...entry, allocation: decimal(existing.allocation).plus(decimal(entry.allocation)).toString() });
      }
      return withYear(runtime, year, { ...prior, economics: prior.economics.with([...slices.values()]), diagnostics: prior.diagnostics.with(diagnostics) });
    },
    prepare: (context, period, _opening, work = [], tier = "detail") => {
      const instructions = input.payments.filter(item => period.start <= item.at && item.at < period.end);
      const operations = [ { at: subtractMilliseconds(period.end, 1), id: `tax:close:${period.start}`, instruction: undefined, settlement: undefined },
        ...instructions.map(instruction => ({ at: instruction.at, id: `tax:payment:${instruction.id}:${instruction.at}`, instruction, settlement: undefined })),
        ...(input.settlements ?? []).filter(item => period.start <= item.at && item.at < period.end).map(settlement => ({ at: settlement.at, id: `tax:final:${settlement.id}:${settlement.at}`, instruction: undefined, settlement })) ];
      return { id: "tax", operations: operations.map(operation => {
      const { at, id, instruction, settlement: finalSettlement } = operation;
      const sameInstantBefore = operations.filter(other => other.id !== id && other.at === at && (
        finalSettlement !== undefined && other.instruction === undefined && other.settlement === undefined ||
        instruction === undefined && finalSettlement === undefined && other.instruction !== undefined ||
        instruction !== undefined && other.instruction !== undefined && (other.instruction.priority ?? 0) < (instruction.priority ?? 0) ||
        finalSettlement !== undefined && other.settlement !== undefined && (other.settlement.priority ?? 0) < (finalSettlement.priority ?? 0)
      )).map(other => other.id);
      return { descriptor: { id, domain: "tax", operationClass: instruction === undefined ? "tax:close" : "tax:payment", sequencingInstant: at,
        dependsOn: [...work.filter(item => item.sequencingInstant <= at && item.operationClass === "cash_income_settlement").map(item => item.id), ...sameInstantBefore],
        resourceAccesses: instruction === undefined && finalSettlement === undefined ? [] : [
          ...(input.fundingPolicy?.orderedSources ?? []).map(source => ({ kind: "account_cash" as const, accountId: source.accountId, mode: "consume" as const })),
          ...(finalSettlement === undefined || input.refundAccountId === undefined ? [] : [{ kind: "account_cash" as const, accountId: input.refundAccountId, mode: "produce" as const }]),
        ], traceRefs: [] },
        execute: opening => {
          const state = opening.state;
          const runtime = opening.runtime ?? {};
          const year = finalSettlement?.taxYear ?? at.slice(0, 4), prior = yearRuntime(taxRuntime(runtime), year);
          const material = prior.economics.some(economic => Object.values(economic.income).some(amount => !amount.isZero())) || prior.diagnostics.size > 0 || instruction !== undefined || finalSettlement !== undefined;
          if (!material) return { ...opening, facts: { outputCapabilities: taxOutputCapabilities([]) } };
          const diagnostics: TaxCapabilityDiagnostic[] = [...input.diagnostics, ...prior.diagnostics];
          if (context.baseCurrency.code !== "USD") diagnostics.push(taxDiagnostic("currency", "The T1A law catalog requires USD bases and payments."));
          if (input.simulationStart !== undefined && input.simulationStart.slice(0, 4) === year && !input.simulationStart.startsWith(`${year}-01-01T00:00:00.000Z`)) diagnostics.push(taxDiagnostic("opening_tax_year", "A partial-year opening lacks prior recognized economics and payment credits."));
          const transactions: AccountingTransaction[] = [];
          const outcomes: ConstraintOutcome[] = [], shortfalls: LiquidityShortfall[] = [];
          const sink = new SummaryOperationSink(context.baseCurrency);
          const post = (suffix: string, type: string, legs: readonly AccountingLegDraft[], traceRefs: RecognizedTaxEconomics["traceRefs"]) => {
            const tx = createAccountingTransaction({ id: accountingTransactionId(`tx:${id}:${suffix}`), type, date: at, legs: legs.map(leg => createAccountingLeg(leg.type === "asset" ? { ...leg, quantity: Quantity.parse(leg.amount.amount.toString(), creditUnit) } : leg)), traceRefs });
            applyAccountingTransactionAtomically(state, tx); transactions.push(tx); sink.transaction(tx);
          };
          const totals = new Map<string, Money>();
          const appliedTraces = new Map<string, RecognizedTaxEconomics["traceRefs"]>();
          const ruleTraces: RecognizedTaxEconomics["traceRefs"][number][] = [];
          const groups = new Map<string, { jurisdiction: string; at: Instant; facts: TaxJurisdictionFacts; entries: RecognizedTaxEconomics[]; local: boolean }>();
          for (const economic of prior.economics) {
            const residence = economic.facts.residenceJurisdictions;
            for (const reference of input.taxRuleReferences ?? []) if (activeTaxFact(reference, economic.at.slice(0, 10)) && ["federal_income", "state_income", "local_income", "payroll", "capital_gains"].includes(reference.taxType) &&
              (reference.jurisdiction === "US" || residence.includes(jurisdictionKey(reference.jurisdiction)) || economic.facts.workJurisdictions.includes(jurisdictionKey(reference.jurisdiction))) &&
              (reference.embeddedDefinition || !input.catalog.some(rule => rule.id === reference.id))) diagnostics.push(taxDiagnostic("canonical_rule_reference", "An authored TaxRule cannot be silently substituted with an unrelated shared definition; its reference/embedded semantics need an authoritative catalog binding.", reference.jurisdiction, reference.id));
            const syntheticFederal = input.catalog.some(rule => rule.jurisdiction === "US:FEDERAL" && rule.provenance.type === "synthetic_test_only");
            const targets = new Set([...(residence.some(value => /^US:[A-Z]{2}$/.test(value)) || syntheticFederal ? ["US:FEDERAL"] : []), ...residence.filter(value => /^US:[A-Z]{2}$/.test(value))]);
            if (!targets.has("US:FEDERAL")) diagnostics.push(taxDiagnostic("federal_filer_scope", "Common US federal household applicability is unknown or unsupported; foreign/nonresident status is not inferred."));
            for (const workState of economic.facts.workJurisdictions.filter(value => /^US:[A-Z]{2}$/.test(value))) if (!residence.includes(workState)) diagnostics.push(taxDiagnostic("nonresident_state_source", "Cross-state employment requires nonresident sourcing/credit semantics absent from the full-year-resident catalog.", workState));
            const wages = economic.income.wages.isPositive();
            if (residence.includes("US:NY:NYC")) targets.add("US:NY:NYC");
            if (wages && (residence.includes("US:PA:PHILADELPHIA") || economic.facts.workJurisdictions.includes("US:PA:PHILADELPHIA"))) targets.add("US:PA:PHILADELPHIA:WAGE");
            if (wages && economic.facts.workJurisdictions.includes("US:CO:DENVER")) targets.add("US:CO:DENVER:OPT");
            if (wages && (residence.includes("US:PA") || economic.facts.workJurisdictions.includes("US:PA"))) {
              if ((economic.facts.eligibility?.pa_local_eit_applicable !== false && (!economic.facts.residenceMunicipality || !economic.facts.residencePsdCode || !economic.facts.workMunicipality || !economic.facts.workPsdCode)) ||
                (economic.facts.eligibility?.pa_local_lst_applicable !== false && (!economic.facts.workMunicipality || !economic.facts.workPsdCode))) diagnostics.push(taxDiagnostic("municipality_psd", "Applicable PA EIT/LST requires exact residence/work municipality and PSD facts.", "US:PA:LOCAL"));
              if (economic.facts.eligibility?.pa_local_eit_applicable !== false) targets.add("US:PA:LOCAL:EIT");
              if (economic.facts.eligibility?.pa_local_lst_applicable !== false) targets.add("US:PA:LOCAL:LST");
            }
            // Unknown local identity never implies non-NYC/non-Philadelphia/non-Denver.
            if (wages && economic.facts.workJurisdictions.some(value => ["US:PA", "US:CO"].includes(value)) && economic.facts.workJurisdictions.length === 1) diagnostics.push(taxDiagnostic("local_work_jurisdiction", "Local service-tax applicability is unknown.", economic.facts.workJurisdictions[0]));
            if (residence.some(value => ["US:PA", "US:NY"].includes(value)) && residence.length === 1) diagnostics.push(taxDiagnostic("local_residence_jurisdiction", "Local residence-tax applicability is unknown.", residence[0]));
            for (const jurisdiction of targets) {
              if (!input.filingStatus) continue;
              try {
                const resolved = binding(jurisdiction, economic.at, economic.facts);
                const rule = resolved.rule;
                const local = jurisdiction.split(":").length > 2 && jurisdiction !== "US:NY:NYC";
                // Annual income deductions are applied once; employment-local rules keep their actual legal slices.
                const key = canonicalSerialize({ jurisdiction, ruleId: rule.id, ...(local ? { facts: economic.facts, month: rule.periodicEmployeeTax ? economic.at.slice(0, 7) : undefined, employee: rule.periodicEmployeeTax ? sources.get(economic.sourceId)?.ownerId : undefined } : {}) });
                const group = groups.get(key) ?? { jurisdiction, at: economic.at, facts: economic.facts, entries: [], local };
                group.entries.push(economic); groups.set(key, group);
              } catch (error) {
                if (!(error instanceof ValidationError)) throw error;
                diagnostics.push(taxDiagnostic("rule_selection", error.message, jurisdiction));
              }
            }
          }
          const seenAnnual = new Set<string>();
          for (const group of [...groups.values()].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)))) {
            try {
              const resolved = binding(group.jurisdiction, group.at, group.facts);
              if (!group.local && seenAnnual.has(group.jurisdiction)) { diagnostics.push(taxDiagnostic("annual_rule_transition", "Multiple annual law versions require explicit year-transition semantics.", group.jurisdiction)); continue; }
              seenAnnual.add(group.jurisdiction);
              const incomes = group.entries.map(entry => Object.freeze(Object.fromEntries(Object.entries(entry.income).map(([key, value]) => [key, value.times(decimal(entry.allocation))]))) as unknown as TaxIncomeFacts);
              const income = sumIncome(incomes);
              for (let index = 0; index < group.entries.length; index++) recognizeTaxLegalBases(resolved.rule, incomes[index]!, group.entries[index]!.facts);
              const legalBases = recognizeTaxLegalBases(resolved.rule, income, group.facts);
              const wages = new Map<string, Money>();
              group.entries.forEach((entry, index) => { const employee = sources.get(entry.sourceId)?.ownerId ?? entry.sourceId; wages.set(employee, (wages.get(employee) ?? zero()).plus(incomes[index]!.wages)); });
              const gross = income.wages.plus(income.taxableInterest).plus(income.ordinaryDividends).plus(income.qualifiedDividends).plus(income.shortTermGains).plus(income.longTermGains);
              const nii = income.taxableInterest.plus(income.ordinaryDividends).plus(income.qualifiedDividends).plus(income.shortTermGains).plus(income.longTermGains);
              const application = applyTaxCoreRule(resolved, { income, ...legalBases, withholding: zero(), estimatedPayments: zero(), priorPaymentCredit: zero(),
                ...(resolved.rule.payroll === undefined ? {} : { employeeWages: [...wages].map(([employeeKey, amount]) => ({ employeeKey, wages: amount })) }),
                ...(resolved.rule.niit === undefined ? {} : { modifiedAdjustedGrossIncome: gross, netInvestmentIncome: nii.isNegative() ? zero() : nii }),
                ...(resolved.rule.periodicEmployeeTax === undefined ? {} : { periodicWages: { unit: resolved.rule.periodicEmployeeTax.unit, wages: income.wages } }) });
              totals.set(group.jurisdiction, (totals.get(group.jurisdiction) ?? zero()).plus(application.result.totalLiability));
              appliedTraces.set(group.jurisdiction, mergeTraceRefs(appliedTraces.get(group.jurisdiction), application.traceRefs, group.entries.flatMap(entry => entry.traceRefs)) ?? []);
              ruleTraces.push(...application.traceRefs, ...group.entries.flatMap(entry => entry.traceRefs));
            } catch (error) {
              if (!(error instanceof ValidationError)) throw error;
              diagnostics.push(taxDiagnostic("legal_base_or_component", error.message, group.jurisdiction));
            }
          }
          const account = input.refundAccountId ?? input.fundingPolicy?.orderedSources[0]?.accountId;
          if (!account || !input.fundingPolicy) diagnostics.push(taxDiagnostic("payment_funding", "Explicit tax funding and refund account are required."));
          for (const [jurisdiction, total] of totals) if (total.compare(prior.liabilities[jurisdiction] ?? zero()) < 0) diagnostics.push(taxDiagnostic("liability_reversal", "A decreasing recognized tax liability requires expense-reversal statement semantics unavailable at this integration boundary.", jurisdiction));
          const uniqueDiagnostics = [...new Map(diagnostics.map(value => [canonicalSerialize(value), value])).values()];
          for (const jurisdiction of totals.keys()) if (!(input.settlements ?? []).some(item => item.taxYear === year && item.jurisdiction === jurisdiction)) uniqueDiagnostics.push(taxDiagnostic("settlement_timing", "An explicit tax-year final settlement/refund date is required; no filing/payment date is inferred.", jurisdiction));
          // Partial supported liabilities are never presented as the full tax amount.
          // Missing law/input semantics leave economic state intact, while complete sources remain observable.
          if (!account || !input.fundingPolicy || context.baseCurrency.code !== "USD") return { ...opening, runtime: withYear(runtime, year, { ...prior, diagnostics: uniqueDiagnostics }), facts: { diagnostics: uniqueDiagnostics, outputCapabilities: taxOutputCapabilities(uniqueDiagnostics) } };
          if (!state.accounts[account!]) throw new ValidationError({ severity: "error", code: "TAX_ACCOUNT_MISSING", message: "Tax account does not resolve in the current realization.", entityType: "tax_execution" });
          const nextLiabilities = { ...prior.liabilities };
          const nextPaymentRefs = { ...prior.paymentTraceRefs };
          const jurisdictions = [...new Set([...totals.keys(), ...Object.keys(prior.liabilities), ...(instruction === undefined ? [] : [instruction.jurisdiction]), ...(finalSettlement === undefined ? [] : [finalSettlement.jurisdiction])])].sort();
          for (const jurisdiction of jurisdictions) {
          const { liabilityId, creditPositionId } = balanceIds(jurisdiction, year);
          const refs = appliedTraces.get(jurisdiction) ?? [];
          const total = totals.get(jurisdiction) ?? prior.liabilities[jurisdiction] ?? zero();
          const priorLiability = prior.liabilities[jurisdiction] ?? zero();
          state.liabilities[liabilityId] ??= { id: liabilityId, balance: zero() };
          state.positions[creditPositionId] ??= { id: creditPositionId, accountId: account!, quantity: Quantity.parse("0", creditUnit), price: money("1"), carryingValue: zero() };
          const delta = total.minus(priorLiability);
          const provenance = createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: id, effectiveAt: at });
          if (delta.isPositive()) {
            const recognition = createRecognitionFact({ id: recognitionId(`${id}:${jurisdiction}:liability`), category: "tax_liability", amount: delta, recognizedAt: at, provenance, traceRefs: refs }, state.identities.recognitionIds);
            registerAuthoritativeIdentity(state.identities, "recognitionIds", recognition.id);
            post(`${jurisdiction}:recognition`, "tax_liability", [{ type: "tax", posting: "debit", amount: delta }, { type: "liability", posting: "credit", amount: delta, entityId: liabilityId }], refs);
          }
          // Previously paid credits reduce newly accrued liabilities without another cash payment.
          const creditBalance = state.positions[creditPositionId]!.carryingValue, payable = state.liabilities[liabilityId]!.balance;
          const offset = creditBalance.compare(payable) < 0 ? creditBalance : payable;
          if (offset.isPositive()) post(`${jurisdiction}:credit`, "tax_credit_application", [{ type: "liability", posting: "debit", amount: offset, entityId: liabilityId }, { type: "asset", posting: "credit", amount: offset, entityId: creditPositionId }], refs);
          const payment = (suffix: string, requested: Money, kind: string) => {
            if (!requested.isPositive()) return;
            suffix = `${jurisdiction}:${suffix}`;
            const recognition = createRecognitionFact({ id: recognitionId(`${id}:${suffix}`), category: kind, amount: requested, recognizedAt: at, provenance, traceRefs: refs }, state.identities.recognitionIds);
            registerAuthoritativeIdentity(state.identities, "recognitionIds", recognition.id);
            const obligation = createObligation({ id: claimId(`${id}:${suffix}:claim`), category: kind, originatingRecognitionId: recognition.id, economicOwnerId: input.ownerId, originalAmount: requested, recognizedAt: at, traceRefs: refs }, authoritativeClaimHistory(state));
            state.obligations[obligation.id] = obligation;
            const proposal = createSettlementProposal({ id: settlementProposalId(`${id}:${suffix}:proposal`), claimId: obligation.id, requestedAmount: requested, requestedAt: at, fundingPolicyId: input.fundingPolicy!.id, provenance, traceRefs: refs }, obligation);
            const funding = resolveFunding(proposal, obligation, input.fundingPolicy!, Object.fromEntries(Object.entries(state.accounts).map(([key, value]) => [key, value.cash])), at);
            outcomes.push(funding.outcome); if (funding.liquidityShortfall) shortfalls.push(funding.liquidityShortfall);
            if (!isAcceptedFundingResolution(funding)) return;
            const settlement = createSettlement({ id: settlementId(`${id}:${suffix}:settlement`), settledAt: at, provenance, traceRefs: refs }, funding, obligation, state.identities.settlementIds);
            registerAuthoritativeIdentity(state.identities, "settlementIds", settlement.id);
            state.obligations[obligation.id] = applySettlement(obligation, settlement);
            const settlementRefs = mergeTraceRefs(refs, [calculationTraceRef(calculationTraceId(`tax:claim:${obligation.id}`)), calculationTraceRef(calculationTraceId(`tax:settlement:${settlement.id}`))]) ?? [];
            nextPaymentRefs[jurisdiction] = mergeTraceRefs(nextPaymentRefs[jurisdiction], settlementRefs) ?? [];
            const balance = state.liabilities[liabilityId]!.balance;
            const applied = balance.compare(settlement.amount) < 0 ? balance : settlement.amount;
            const prepaid = settlement.amount.minus(applied);
            post(suffix, kind, [...(applied.isPositive() ? [{ type: "liability" as const, posting: "debit" as const, amount: applied, entityId: liabilityId }] : []), ...(prepaid.isPositive() ? [{ type: "asset" as const, posting: "debit" as const, amount: prepaid, entityId: creditPositionId }] : []), ...settlement.fundingAllocations.map(allocation => ({ type: "cash" as const, posting: "credit" as const, amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "operating" as const }))], settlementRefs);
          };
          if (instruction !== undefined && instruction.jurisdiction === jurisdiction) payment(instruction.id, instruction.amount, `tax_${instruction.kind}`);
          if (finalSettlement?.jurisdiction === jurisdiction && !uniqueDiagnostics.some(diagnostic => diagnostic.jurisdiction === undefined || diagnostic.jurisdiction === jurisdiction)) {
            payment("final", state.liabilities[liabilityId]!.balance, "tax_final_settlement");
            const refund = state.positions[creditPositionId]!.carryingValue;
            if (refund.isPositive()) post(`${jurisdiction}:refund`, "tax_refund", [{ type: "cash", posting: "debit", amount: refund, accountId: account!, cashFlowClass: "operating" }, { type: "asset", posting: "credit", amount: refund, entityId: creditPositionId }], mergeTraceRefs(refs, nextPaymentRefs[jurisdiction]) ?? []);
          }
          nextLiabilities[jurisdiction] = delta.isNegative() && uniqueDiagnostics.length ? priorLiability : total;
          }
          sink.traces(ruleTraces);
          return { state, primitiveState: opening.primitiveState, runtime: withYear(runtime, year, { ...prior, liabilities: nextLiabilities, paymentTraceRefs: nextPaymentRefs, diagnostics: uniqueDiagnostics }), facts: { ...(tier === "summary" ? { summary: { evidence: sink.snapshot() } } : { transactions, traceRefs: mergeTraceRefs(ruleTraces, ...transactions.map(transaction => transaction.traceRefs)) ?? [] }), instrumentation: { taxRecognizedEconomicsVisited: prior.economics.size, taxRuleGroupsEvaluated: groups.size, taxJurisdictionsCalculated: totals.size }, diagnostics: uniqueDiagnostics, constraintOutcomes: outcomes, liquidityShortfalls: shortfalls, outputCapabilities: taxOutputCapabilities(uniqueDiagnostics) } };
        } }; }) };
    },
  } satisfies HouseholdKernelParticipant);
};
