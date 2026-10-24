import type { AccountingTransaction } from "../../../../../accounting/index.js";
import type { AppliedPayrollHealthWageBase, D2SettlementSourceContext, PayrollHealthSourceBinding } from "../../../../../state/index.js";
import { instant, type Instant } from "../../../../../time/index.js";
import { Money } from "../../../../../values/index.js";
import type { PayrollWithholdingElection } from "../../../../tax/contracts.js";
import { canonicalSerialize } from "../../../../run.js";
import { proposePremiums, type PremiumCoverage, type PremiumProposal, type PremiumRequest, type PremiumSource } from "../index.js";

export interface PayrollPremiumSourceWindow {
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
}
export interface RequiredPayrollPremiumBase {
  readonly jurisdiction: string;
  readonly regime: AppliedPayrollHealthWageBase["regime"];
  readonly ruleId: string;
  readonly ruleVersion: string;
}
/** Original employer inputs, NOT PayrollHealthDeductionEvidence or a posted receipt.
 * The signed wage is the original no-health paycheck. Its complete inventories
 * remain factual; this module never recalculates them after a proposed deduction. */
export interface OriginalPayrollPremiumFacts {
  readonly source: PayrollHealthSourceBinding;
  readonly employmentId: string;
  readonly employment: PayrollPremiumSourceWindow;
  readonly bankOwnerId: string;
  readonly gross: Money;
  readonly transaction: AccountingTransaction;
  readonly quote: {
    readonly operationId: string;
    readonly quoteId: string;
    readonly version: string;
    readonly asOf: PremiumSource["asOf"];
    readonly schedule: PremiumCoverage["quote"]["schedule"];
    /** Explicit employer mapping, not a conversion from civil date to Instant. */
    readonly premiumEffectiveAt: PremiumProposal["effectiveAt"];
    readonly payrollAt: Instant;
    readonly allocation: "full_quoted_occurrence";
    readonly grossAmount: Money;
    readonly employerAmount: Money;
    readonly employeeAmount: Money;
  };
  readonly election: {
    readonly id: string;
    readonly incomeId: string;
    readonly ownerId: string;
    readonly employerId: string;
    readonly coverageId: string;
    readonly planId: string;
    readonly evidenceWindow: PayrollPremiumSourceWindow;
    readonly taxCharacter: "section125" | "aftertax" | "unknown";
    readonly section125Qualified: boolean;
  };
  readonly inventoryComplete: boolean;
  readonly contributions: readonly { readonly id: string; readonly character: string; readonly amount: Money }[];
  readonly withholding: readonly { readonly election: PayrollWithholdingElection; readonly amount: Money }[];
  readonly deductionInventory: readonly string[];
  /** Source-owned prior allocation check; true suppresses another recognition. */
  readonly alreadyAllocated: boolean;
  /** Complete source-authored jurisdiction/regime/rule inventory, including locals.
   * An empty inventory is unknown law, never an exemption. */
  readonly requiredBases: readonly RequiredPayrollPremiumBase[];
  readonly legalInventoryComplete: boolean;
}
/** Read-only deterministic source seams. Implementations must retrieve independent
 * original records, never echo submitted proposals/bindings. These seams do NOT
 * register or replace the canonical PayrollHealthSourceAuthority. */
export interface PayrollPremiumOriginals {
  readonly premiumRequest: () => PremiumRequest | undefined;
  readonly payroll: (sourceId: string, sourceVersion: string) => OriginalPayrollPremiumFacts | undefined;
  readonly legalBases: (sourceId: string, sourceVersion: string) => readonly AppliedPayrollHealthWageBase[] | undefined;
}
export interface PayrollPremiumDiagnostic {
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly period: { readonly start: Instant; readonly end: Instant } | PremiumProposal["coveragePeriod"] | null;
  readonly affectedOutput: "binding" | "bank" | "tax" | "net_pay" | "recognition" | "settlement";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
const conditional = { committed: false, postable: false } as const;
export interface PayrollPremiumBindingIntent {
  readonly kind: "conditional_original_payroll_premium";
  readonly committed: false;
  readonly postable: false;
  readonly source: PayrollHealthSourceBinding;
  readonly premiumOperationId: string;
  readonly quoteId: string;
  readonly quoteVersion: string;
  readonly quoteRef: {
    readonly ruleSnapshotId: string;
    readonly asOf: PremiumSource["asOf"];
    readonly effectiveAt: PremiumProposal["effectiveAt"];
    readonly coveragePeriod: PremiumProposal["coveragePeriod"];
  };
  readonly memberIds: readonly string[];
  readonly claimKeys: readonly string[];
  readonly employmentRef: { readonly sourceId: string; readonly sourceVersion: string };
  readonly electionRef: { readonly sourceId: string; readonly sourceVersion: string; readonly electionId: string };
  readonly proposedCashPayDeduction: { readonly amount: Money; readonly committed: false; readonly postable: false };
  readonly proposedHealthcareExpense: { readonly amount: Money; readonly claimId: string; readonly committed: false; readonly postable: false } | null;
  readonly employerSubsidy: Money;
  readonly legalBaseCandidate: {
    readonly status: "documented_conditional" | "incomplete";
    readonly committed: false;
    readonly postable: false;
    readonly requiredBases: readonly RequiredPayrollPremiumBase[];
    readonly appliedBases: readonly AppliedPayrollHealthWageBase[];
  };
  readonly sourceAuthorityCoverage: "incomplete";
  readonly bankCoverage: "incomplete";
  readonly taxCoverage: "incomplete";
  readonly netPayCoverage: "incomplete";
  readonly recognitionCoverage: "incomplete";
  readonly settlementCoverage: "incomplete";
}
const ordered = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const unique = (s: readonly string[]): boolean => s.every(text) && new Set(s).size === s.length;
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const snapshot = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || value instanceof Money) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]))) as T;
};
const validMoney = (m: Money, gross: Money): boolean => m instanceof Money && !m.isNegative()
  && m.currency.equals(gross.currency) && m.amount.fitsScale(gross.currency.minorUnitScale);
const windowAt = (w: PayrollPremiumSourceWindow, at: Instant, context: D2SettlementSourceContext): boolean => {
  for (const t of [w.publishedAt, w.knownAt, w.effectiveFrom, w.effectiveUntil]) instant(t);
  return text(w.sourceId) && text(w.sourceVersion) && w.effectiveFrom <= at && at < w.effectiveUntil
    && w.publishedAt <= w.knownAt && w.publishedAt <= context.asOf && w.knownAt <= context.dataCutoff && w.knownAt <= at;
};
const baseKey = (b: Pick<RequiredPayrollPremiumBase, "jurisdiction" | "regime">): string => JSON.stringify([b.jurisdiction, b.regime]);
const claimKeys = (s: PayrollHealthSourceBinding, p: PremiumProposal): readonly string[] => [
  JSON.stringify(["claim", s.householdId, s.claimId]),
  JSON.stringify(["quote", p.householdId, p.quoteId, p.effectiveAt]),
  JSON.stringify(["premium", p.operationId]),
  JSON.stringify(["payroll", s.transactionId]),
  JSON.stringify(["occurrence", s.incomeId, s.occurrenceId]),
];

/** Pure conditional preview. No canonical qualification, state, posting, tax
 * calculation, reservation, or source-authority registration occurs here. */
export function proposePayrollPremiumBindings(input: {
  readonly context: D2SettlementSourceContext;
  readonly proposals: readonly PremiumProposal[];
  readonly bindings: readonly PayrollHealthSourceBinding[];
  readonly originals: PayrollPremiumOriginals;
}) {
  instant(input.context.asOf); instant(input.context.dataCutoff);
  const context = snapshot(input.context);
  const diagnostics: PayrollPremiumDiagnostic[] = [];
  const intents: PayrollPremiumBindingIntent[] = [];
  const diagnose = (code: string, s: PayrollHealthSourceBinding | undefined, p: PremiumProposal | undefined,
    output: PayrollPremiumDiagnostic["affectedOutput"], facts: readonly string[]) => {
    diagnostics.push({ diagnosticCode: code, sourceEntityPath: s ? `payrollHealth/${encodeURIComponent(s.claimId)}` : "payrollHealth",
      period: s && s.periodStart < s.periodEnd ? { start: s.periodStart, end: s.periodEnd } : p?.coveragePeriod ?? null, affectedOutput: output,
      coverage: "incomplete", missingFacts: facts, ruleSnapshotId: p?.source.ruleSnapshotId ?? "unavailable",
      traceRefs: [s?.sourceId, s?.transactionId, s?.claimId, p?.operationId, p?.quoteId].filter((v): v is string => v !== undefined).sort(ordered) });
  };
  const finish = () => snapshot({ ...conditional, intents: intents.sort((a, b) => ordered(a.source.dueAt, b.source.dueAt)
    || ordered(a.premiumOperationId, b.premiumOperationId)), diagnostics: [...new Map(diagnostics.map(d => [canonicalSerialize(d), d])).entries()]
    .sort(([a], [b]) => ordered(a, b)).map(([, d]) => d) });
  if (input.bindings.length === 0 && !input.proposals.some(p => p.expectedSettlementRoute.kind === "pretax_payroll")) return finish();
  const originalRequest = input.originals.premiumRequest();
  if (!originalRequest) {
    diagnose("C1_ORIGINAL_INPUTS_REQUIRED", undefined, undefined, "binding", ["independent unchanged C1 PremiumRequest"]);
    return finish();
  }
  // A caller-created PremiumProposal alone cannot authorize original C1 terms.
  let quoted: ReturnType<typeof proposePremiums>;
  try { quoted = proposePremiums(originalRequest); }
  catch {
    diagnose("C1_ORIGINAL_INPUTS_INVALID", undefined, undefined, "binding", ["admissible original C1 inputs"]);
    return finish();
  }
  const reconstructed = new Map(quoted.proposals.map(p => [p.operationId, p]));
  const submittedProposals = new Map<string, PremiumProposal[]>();
  for (const p of input.proposals) submittedProposals.set(p.operationId, [...(submittedProposals.get(p.operationId) ?? []), p]);
  const candidates: { s: PayrollHealthSourceBinding; p: PremiumProposal; f: OriginalPayrollPremiumFacts; keys: readonly string[] }[] = [];
  for (const submitted of [...input.bindings].sort((a, b) => ordered(canonicalSerialize(a), canonicalSerialize(b)))) {
    const s = snapshot(submitted);
    for (const t of [s.dueAt, s.periodStart, s.periodEnd, s.publishedAt, s.knownAt]) instant(t);
    const f = input.originals.payroll(s.sourceId, s.sourceVersion);
    const submittedQuotes = f && submittedProposals.get(f.quote.operationId);
    const p = submittedQuotes?.[0];
    const reject = (code: string, fact: string) => diagnose(code, s, p, "binding", [fact]);
    if (!f) { reject("ORIGINAL_PAYROLL_REQUIRED", "independent employer/job/original signed paycheck and full election inventory"); continue; }
    if (!p || submittedQuotes?.length !== 1 || !same(reconstructed.get(p.operationId) ?? null, p)) {
      reject("C1_QUOTE_MISMATCH", "one exact reconstructed C1 proposal including dated publication, cadence and full family quote"); continue;
    }
    const route = p.expectedSettlementRoute;
    if (route.kind !== "pretax_payroll" || p.medicare !== null) { reject("PRETAX_EMPLOYER_ROUTE_REQUIRED", "exclusive original employer health payroll route"); continue; }
    const c = originalRequest.coverages.find(c => c.id === p.coverageId)!;
    const sources = [c.quote.source, route.evidence, ...c.eligibility.map(e => e.evidence), ...p.coordinationEvidence.map(e => e.evidence)];
    if (sources.some(e => e.projectionStatus !== "verified" || e.asOf > context.asOf.slice(0, 10) || e.asOf > context.dataCutoff.slice(0, 10))) {
      reject("C1_SOURCE_AS_OF_REQUIRED", "verified quote, route, members and coordination published by the preview as-of date"); continue;
    }
    if (!same(s, f.source) || s.version !== "payroll-health-source/v1" ||
      ![s.sourceId, s.sourceVersion, s.householdId, s.ownerId, s.incomeId, s.employerId, s.occurrenceId, s.transactionId,
        s.bankAccountId, s.coverageId, s.planId, s.electionId, s.claimId].every(text) ||
      s.householdId !== p.householdId || s.ownerId !== p.payerId || s.employerId !== p.sponsorId ||
      s.coverageId !== p.coverageId || s.planId !== p.planId || f.employmentId !== route.employmentId || f.bankOwnerId !== s.ownerId ||
      s.transactionId !== `tx:recognition:income:${s.incomeId}:${s.dueAt}`) {
      reject("ORIGINAL_PAYROLL_IDENTITY_MISMATCH", "exact original wage/source, household, owner, employing sponsor, job and owned bank"); continue;
    }
    if (!(s.periodStart <= s.dueAt && s.dueAt < s.periodEnd) || s.publishedAt > s.knownAt || s.publishedAt > context.asOf
      || s.knownAt > context.dataCutoff || s.knownAt > s.dueAt || !windowAt(f.employment, s.dueAt, context)) {
      reject("PAYROLL_SOURCE_WINDOW_REQUIRED", "effective employment/pay period and available original payroll publication/observation"); continue;
    }
    const q = f.quote;
    if (q.allocation !== "full_quoted_occurrence" || q.quoteId !== p.quoteId || q.version !== p.source.version || q.asOf !== p.source.asOf
      || q.premiumEffectiveAt !== p.effectiveAt || q.payrollAt !== s.dueAt || !same(q.schedule, c.quote.schedule)
      || !q.employeeAmount.equals(p.memberAmount) || !q.employerAmount.equals(p.employerAmount) || !q.grossAmount.equals(p.grossAmount)) {
      reject("SOURCED_FULL_QUOTE_ALLOCATION_REQUIRED", "explicit original payroll mapping of full quoted shares; no inferred split, annual division or proration"); continue;
    }
    const e = f.election;
    if (e.id !== s.electionId || e.incomeId !== s.incomeId || e.ownerId !== s.ownerId || e.employerId !== s.employerId
      || e.coverageId !== s.coverageId || e.planId !== s.planId || !windowAt(e.evidenceWindow, s.dueAt, context)) {
      reject("PAYROLL_PLAN_ELECTION_REQUIRED", "source-owned existing effective payroll/plan election bound to this job and coverage"); continue;
    }
    if (f.alreadyAllocated !== false) { reject(f.alreadyAllocated === true ? "PREMIUM_ALREADY_ALLOCATED" : "PRIOR_ALLOCATION_CHECK_REQUIRED",
      "source-owned confirmation of an unallocated original premium claim; existing recognition must not be repeated"); continue; }
    const w = f.withholding.map(row => row.election);
    for (const row of w) { instant(row.start); if (row.end !== undefined) instant(row.end); }
    if (f.inventoryComplete !== true || !unique(f.contributions.map(row => row.id)) || !unique(w.map(row => row.id))
      || !unique(w.map(row => row.jurisdiction)) || f.deductionInventory.length !== 1 || f.deductionInventory[0] !== s.claimId
      || f.contributions.some(row => !["traditional_401k", "roth_401k", "after_tax_401k", "employee_hsa"].includes(row.character))
      || w.some(row => row.version !== "payroll-withholding/v1" || !row.userConfirmed || !text(row.provenance)
        || !/^[A-Z][A-Z0-9]*(?::[A-Z0-9_]+)+$/.test(row.jurisdiction)
        || row.incomeId !== s.incomeId || row.ownerId !== s.ownerId || row.employerId !== s.employerId || row.depositAccountId !== s.bankAccountId
        || row.start > s.dueAt || row.end !== undefined && s.dueAt >= row.end)) {
      reject("PAYROLL_INVENTORY_REQUIRED", "complete unique current #101 elections, contributions and single health claim inventory"); continue;
    }
    const amounts = [...f.contributions.map(r => r.amount), ...f.withholding.map(r => r.amount)];
    const tx = f.transaction;
    if (!(f.gross instanceof Money) || !validMoney(f.gross, p.memberAmount) ||
      [...amounts, ...tx.legs.map(l => l.amount)].some(m => !validMoney(m, f.gross))) {
      reject("PAYROLL_EXACT_CENTS_REQUIRED", "nonnegative exact same-currency original wage and full deduction inventory"); continue;
    }
    if (f.withholding.some(row => row.election.calculation.kind === "fixed" && !row.election.calculation.amount.equals(row.amount))) {
      reject("PAYROLL_INVENTORY_REQUIRED", "signed withholding inventory matching the existing fixed #101 election"); continue;
    }
    const total = (kind: "cash" | "asset" | "income") => tx.legs.filter(l => l.type === kind)
      .reduce((sum, l) => sum.plus(l.amount), Money.zero(f.gross.currency));
    const deducted = amounts.reduce((sum, amount) => sum.plus(amount), Money.zero(f.gross.currency));
    if (tx.id !== s.transactionId || tx.type !== "payroll_income" || tx.date !== s.dueAt
      || tx.legs.filter(l => l.type === "income").length !== 1 || tx.legs.filter(l => l.type === "cash").length > 1
      || tx.legs.some(l => l.type === "income" ? l.posting !== "credit" : l.type === "cash" ? l.posting !== "debit" || l.accountId !== s.bankAccountId
        : l.type !== "asset" || l.posting !== "debit")
      || !total("income").equals(f.gross) || !total("asset").equals(deducted) || !total("cash").plus(deducted).equals(f.gross)) {
      reject("SIGNED_ORIGINAL_PAYROLL_MISMATCH", "original signed gross/inventory/bank wage journal, never a premium-operation paycheck"); continue;
    }
    if (deducted.plus(p.memberAmount).compare(f.gross) > 0) {
      reject("PREMIUM_EXCEEDS_GROSS_CAPACITY", "original gross sufficient for all sourced deductions plus full member share"); continue;
    }
    candidates.push({ s, p, f, keys: claimKeys(s, p) });
  }
  const counts = new Map<string, number>();
  for (const c of candidates) for (const k of c.keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const electionOwners = new Map<string, Set<string>>();
  for (const { s, f } of candidates) {
    const owners = electionOwners.get(s.electionId) ?? new Set<string>();
    owners.add(JSON.stringify([s.householdId, s.ownerId, s.incomeId, s.employerId, s.coverageId, s.planId, f.employmentId]));
    electionOwners.set(s.electionId, owners);
  }
  for (const { s, p, f, keys } of candidates) {
    if (keys.some(k => counts.get(k)! > 1) || electionOwners.get(s.electionId)!.size !== 1) {
      diagnose("DUPLICATE_PREMIUM_PAYROLL_CLAIM", s, p, "binding", ["one quote/member share, coverage occurrence, claim and original paycheck"]); continue;
    }
    const required = [...f.requiredBases].sort((a, b) => ordered(canonicalSerialize(a), canonicalSerialize(b)));
    const bases = [...(input.originals.legalBases(s.sourceId, s.sourceVersion) ?? [])].sort((a, b) => ordered(canonicalSerialize(a), canonicalSerialize(b)));
    const legal = f.legalInventoryComplete === true && f.election.taxCharacter === "section125" && f.election.section125Qualified === true
      && required.length > 0 && unique(required.map(baseKey)) && unique(bases.map(baseKey)) && bases.length === required.length
      && f.withholding.every(w => required.some(r => r.jurisdiction === w.election.jurisdiction))
      && required.every(r => /^[A-Z][A-Z0-9]*(?::[A-Z0-9_]+)+$/.test(r.jurisdiction) && ["income", "payroll", "periodic"].includes(r.regime) && text(r.ruleId) && text(r.ruleVersion)
        && bases.some(b => baseKey(b) === baseKey(r) && b.ruleId === r.ruleId && b.ruleVersion === r.ruleVersion))
      && bases.every(b => windowAt({ ...b, sourceId: b.legalPlanSourceId, sourceVersion: b.legalPlanSourceVersion }, s.dueAt, context)
        && [b.before, b.exclusion, b.after].every(m => validMoney(m, f.gross)) && b.before.compare(f.gross) <= 0
        && b.exclusion.compare(p.memberAmount) <= 0 && b.before.minus(b.exclusion).equals(b.after));
    if (!legal) diagnose("LEGAL_WAGE_BASES_INCOMPLETE", s, p, "tax", [
      "independent Section 125 qualification and elected tax character",
      "complete dated jurisdiction/regime/rule inventory and original applied legal bases (including applicable local law)",
    ]);
    intents.push({ kind: "conditional_original_payroll_premium", ...conditional, source: s,
      premiumOperationId: p.operationId, quoteId: p.quoteId, quoteVersion: p.source.version, memberIds: p.memberIds,
      quoteRef: { ruleSnapshotId: p.source.ruleSnapshotId, asOf: p.source.asOf, effectiveAt: p.effectiveAt, coveragePeriod: p.coveragePeriod },
      claimKeys: keys, employmentRef: { sourceId: f.employment.sourceId, sourceVersion: f.employment.sourceVersion },
      electionRef: { sourceId: f.election.evidenceWindow.sourceId, sourceVersion: f.election.evidenceWindow.sourceVersion, electionId: s.electionId },
      proposedCashPayDeduction: { amount: p.memberAmount, ...conditional },
      proposedHealthcareExpense: p.memberAmount.isZero() ? null : { amount: p.memberAmount, claimId: s.claimId, ...conditional },
      employerSubsidy: p.employerAmount,
      legalBaseCandidate: { status: legal ? "documented_conditional" : "incomplete", ...conditional, requiredBases: required, appliedBases: bases },
      sourceAuthorityCoverage: "incomplete", bankCoverage: "incomplete", taxCoverage: "incomplete", netPayCoverage: "incomplete",
      recognitionCoverage: "incomplete", settlementCoverage: "incomplete" });
    for (const output of ["bank", "tax", "net_pay", "recognition", "settlement"] as const) diagnose("PAYROLL_EXECUTION_OWNER_PENDING", s, p, output, [
      "#149 independent canonical PayrollHealthSourceAuthority registration/requalification",
      "payrollContributionCandidate + applyPayrollHealthTransactionAtomically with original signed journal and complete source proof",
    ]);
  }
  const boundOperations = new Set(candidates.map(c => c.p.operationId));
  for (const p of input.proposals.filter(p => p.expectedSettlementRoute.kind === "pretax_payroll")) {
    if (!boundOperations.has(p.operationId)) diagnose("PREMIUM_BINDING_INCOMPLETE", undefined, p, "binding", ["matching admitted original payroll claim"]);
  }
  return finish();
}
