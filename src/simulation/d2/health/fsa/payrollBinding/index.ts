import type { AccountingTransaction } from "../../../../../accounting/index.js";
import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate, instant, type Instant } from "../../../../../time/index.js";
import { Money, USD } from "../../../../../values/index.js";
import { taxBalanceIds, type PayrollWithholdingElection } from "../../../../tax/contracts.js";
import { evaluateFsa, fsaScopeId, type FsaIdentity, type FsaPayrollContribution, type FsaRequest } from "../index.js";

export interface FsaOriginalRef { readonly sourceId: string; readonly sourceVersion: string }
export interface FsaOriginalWindow extends FsaOriginalRef {
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
}
export interface FsaPayrollContext { readonly asOf: Instant; readonly dataCutoff: Instant }
export interface FsaOriginalElection {
  readonly id: string;
  readonly scope: FsaIdentity;
  readonly memberId: string;
  readonly instrumentFamily: "health_fsa";
  readonly annualEmployee: Money;
  readonly annualEmployer: Money;
  readonly electedAt: Instant;
  readonly userConfirmed: boolean;
  readonly planPermits: boolean;
  readonly evidence: FsaOriginalWindow;
}
export interface FsaOriginalPaycheck {
  readonly incomeId: string;
  readonly occurrenceId: string;
  readonly transactionId: string;
  readonly employmentId: string;
  readonly employerId: string;
  readonly ownerId: string;
  readonly householdId: string;
  readonly dueAt: Instant;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  readonly employment: FsaOriginalWindow;
  readonly bank: { readonly id: string; readonly ownerId: string; readonly householdId: string;
    readonly kind: "BANK"; readonly evidence: FsaOriginalWindow };
  readonly gross: Money;
  readonly netCash: Money;
  readonly journal: FsaOriginalRef;
  /** Independent original provider commitment; detects amendments, does not authenticate a provider. */
  readonly signedJournalDigest: string;
  readonly inventoryComplete: boolean;
  readonly contributions: readonly { readonly id: string; readonly character: "traditional_401k" | "roth_401k" | "after_tax_401k" | "employee_hsa";
    readonly positionId: string; readonly amount: Money }[];
  readonly withholding: readonly { readonly election: PayrollWithholdingElection; readonly amount: Money }[];
  /** ORIGINAL wage must contain no FSA allocation, including another claim. */
  readonly fsaClaimIds: readonly string[];
}
export interface FsaOriginalContribution {
  readonly ref: FsaOriginalWindow;
  readonly contribution: FsaPayrollContribution;
  /** Explicit source mapping to an Instant; never inferred from a pay cadence or civil date. */
  readonly effectiveAt: Instant;
  readonly claimId: string;
  readonly authorizationId: string;
  readonly authorization: FsaOriginalWindow;
  readonly election: FsaOriginalElection;
  readonly alreadyAllocated: boolean;
  readonly funding: { readonly kind: "employee"; readonly paycheck: FsaOriginalPaycheck }
    | { readonly kind: "employer_grant"; readonly employerId: string; readonly fundingSourceId: string;
      readonly fundingOwnerId: string;
      readonly grantId: string; readonly authorizedAmount: Money; readonly planPermits: boolean;
      readonly evidence: FsaOriginalWindow };
  /** Source-owned exhaustive jurisdiction inventory; missing facts never imply zero tax. */
  readonly wageBases: { readonly complete: boolean; readonly required: readonly string[];
    readonly facts: readonly { readonly jurisdiction: string; readonly regime: "income" | "payroll" | "periodic";
      readonly ruleId: string; readonly evidence: FsaOriginalWindow }[] };
}
/** Independently fetch originals, never echo caller proposals. No default state adapter or posting port. */
export interface FsaPayrollOriginals {
  readonly request: (scope: FsaIdentity) => { readonly ref: FsaOriginalWindow;
    readonly planRef: FsaOriginalWindow; readonly lawRef: FsaOriginalWindow; readonly request: FsaRequest } | undefined;
  readonly contribution: (id: string) => FsaOriginalContribution | undefined;
  readonly journal: (ref: FsaOriginalRef) => AccountingTransaction | undefined;
}
export interface FsaPayrollBinding {
  readonly kind: "conditional_original_fsa_payroll";
  readonly operationId: string;
  readonly scope: FsaIdentity;
  readonly contributionId: string;
  readonly claimId: string;
  readonly authorizationId: string;
  readonly memberId: string;
  readonly electionId: string;
  readonly effectiveAt: Instant;
  readonly contributionSource: FsaPayrollContribution["contributionSource"];
  readonly authorizedEmployee: Money;
  readonly authorizedEmployer: Money;
  readonly requestRef: FsaOriginalRef;
  readonly planRef: FsaOriginalRef;
  readonly lawRef: FsaOriginalRef;
  readonly sourceRef: FsaOriginalRef;
  readonly electionRef: FsaOriginalRef;
  readonly authorizationRef: FsaOriginalRef;
  readonly fundingRef: FsaOriginalRef;
  readonly inputDigest: string;
  readonly evaluationDigest: string;
  readonly payroll: { readonly incomeId: string; readonly occurrenceId: string; readonly transactionId: string;
    readonly employmentId: string; readonly bankAccountId: string; readonly dueAt: Instant;
    readonly journalRef: FsaOriginalRef; readonly journalDigest: string } | null;
  readonly employerGrantId: string | null;
  readonly committed: false;
  readonly postable: false;
  readonly funding: "incomplete";
  readonly payrollEffect: "incomplete";
  readonly tax: "incomplete";
  readonly entitlementSettlement: "incomplete";
  readonly netWorthTreatment: "excluded_restricted_entitlement";
  readonly medicalExpense: false;
  readonly householdIncome: false;
}
export interface FsaPayrollBindingDiagnostic {
  readonly diagnosticCode: string;
  readonly coverage: "incomplete";
  readonly affectedOutput: "binding" | "tax";
  readonly contributionId: string | null;
  readonly missingFacts: readonly string[];
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const unique = (a: readonly string[]): boolean => a.every(text) && new Set(a).size === a.length;
/** Unordered evidence sets normalized before hashing. Never stores full documents. */
const canonical = (v: unknown): string => {
  if (v instanceof Money) return canonical(v.toJSON());
  if (Array.isArray(v)) return `[${v.map(canonical).sort(compare).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => compare(a, b))
    .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
};
export const fsaPayrollDigest = (v: unknown): string => `sha256:${sha256(canonical(v))}`;
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const snapshot = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(x)]))) as T;
};
const ref = (r: FsaOriginalRef): FsaOriginalRef => ({ sourceId: r.sourceId, sourceVersion: r.sourceVersion });
const exact = (m: Money): boolean => m instanceof Money && m.currency.equals(USD) && !m.isNegative() && m.amount.fitsScale(2);
const zero = () => Money.zero(USD);
const windowAt = (w: FsaOriginalWindow, at: Instant, c: FsaPayrollContext): boolean => {
  [w.publishedAt, w.knownAt, w.effectiveFrom, w.effectiveUntil, at].forEach(instant);
  return text(w.sourceId) && text(w.sourceVersion) && w.effectiveFrom <= at && at < w.effectiveUntil
    && w.publishedAt <= w.knownAt && w.knownAt <= c.dataCutoff && w.knownAt <= c.asOf && w.knownAt <= at;
};
const scopeOf = (p: FsaIdentity): FsaIdentity => ({ householdId: p.householdId, personId: p.personId,
  employerId: p.employerId, planId: p.planId, planYearId: p.planYearId });

/** Reconstruct full history. Failure suppresses this whole owner/year bundle.
 * Posted rows are checked for provenance but never emitted for payment again. */
export function proposeFsaPayrollBindings(input: {
  readonly scope: FsaIdentity;
  readonly context: FsaPayrollContext;
  readonly originals: FsaPayrollOriginals;
}) {
  const scope = scopeOf(input.scope), context = snapshot(input.context);
  [context.asOf, context.dataCutoff].forEach(instant);
  const diagnostics: FsaPayrollBindingDiagnostic[] = [];
  const bindings: FsaPayrollBinding[] = [];
  const fail = (code: string, fact: string, id: string | null = null, output: "binding" | "tax" = "binding") => {
    diagnostics.push({ diagnosticCode: code, coverage: "incomplete", affectedOutput: output,
      contributionId: id, missingFacts: [fact] });
  };
  const finish = () => snapshot({ committed: false as const, postable: false as const,
    coverage: diagnostics.some(d => d.affectedOutput === "binding") ? "incomplete" as const : "conditional" as const,
    bindings: diagnostics.some(d => d.affectedOutput === "binding") ? [] : bindings.sort((a, b) => compare(a.operationId, b.operationId)),
    diagnostics: diagnostics.sort((a, b) => compare(canonical(a), canonical(b))) });
  const original = input.originals.request(scope);
  if (!original) { fail("FSA_ORIGINAL_REQUEST_REQUIRED", "independent original plan/election/law and complete claim/payroll history"); return finish(); }
  const request = snapshot(original.request), p = request.plan;
  let evaluation: ReturnType<typeof evaluateFsa>;
  try {
    const at = instant(`${request.evaluatedAt}T23:59:59.999Z`);
    if (!same(scopeOf(p), scope) || !windowAt(original.ref, at, context)
      || request.evaluatedAt > context.asOf.slice(0, 10) || request.evaluatedAt > context.dataCutoff.slice(0, 10)) {
      fail("FSA_ORIGINAL_SCOPE_REQUIRED", "one available original owner/employer/plan/year at the evaluation cutoff"); return finish();
    }
    evaluation = evaluateFsa(request);
  } catch {
    fail("FSA_ORIGINAL_INPUT_INVALID", "valid unchanged evaluateFsa inputs and source dates"); return finish();
  }
  if (evaluation.entitlementCoverage !== "complete" || evaluation.yearEndCoverage !== "complete") {
    fail("FSA_EVALUATION_INCOMPLETE", "original entitlement/year-end rules: " + evaluation.diagnostics
      .filter(d => d.affectedOutput === "entitlement" || d.affectedOutput === "year_end").map(d => d.diagnosticCode).sort(compare).join(","));
    return finish();
  }
  // Envelope supplies publication/withdrawal for the whole civil-dated source snapshot.
  const inputDigest = fsaPayrollDigest(request), evaluationDigest = fsaPayrollDigest(evaluation);
  const rows: FsaOriginalContribution[] = [];
  const seen = new Set<string>(), claimUses = new Set<string>();
  for (const r of request.receipts) {
    claimUses.add(r.proofId); claimUses.add(r.receiptId);
    if (r.payment.status === "paid") claimUses.add(r.payment.paymentRef);
    if (r.reimbursement && "settlementId" in r.reimbursement && r.reimbursement.settlementId) claimUses.add(r.reimbursement.settlementId);
  }
  for (const c of evaluation.claims) { claimUses.add(c.claimId); claimUses.add(c.operationId); }
  for (const c of [...request.payroll].sort((a, b) => compare(a.contributionId, b.contributionId))) {
    const f = input.originals.contribution(c.contributionId);
    if (!f || !same(f.contribution, c)) { fail("FSA_ORIGINAL_CONTRIBUTION_REQUIRED", "exact independent contribution including pending/posted status and provenance", c.contributionId); continue; }
    const row = snapshot(f), id = c.contributionId;
    try {
      const e = row.election, dueAt = row.effectiveAt;
      instant(e.electedAt);
      if (![id, row.claimId, row.authorizationId, e.id].every(text) || seen.has(id)
        || civilDate(dueAt.slice(0, 10)) !== c.effectiveAt
        || !p.planEvidence || !p.law
        || !windowAt(original.planRef, dueAt, context) || !windowAt(original.lawRef, dueAt, context)
        || original.planRef.sourceId !== p.planEvidence?.ruleSnapshotId || original.planRef.sourceVersion !== p.planEvidence?.version
        || original.lawRef.sourceId !== p.law?.evidence.ruleSnapshotId || original.lawRef.sourceVersion !== p.law?.evidence.version
        || p.planEvidence.asOf > c.effectiveAt || p.law.evidence.asOf > c.effectiveAt || c.evidence.asOf > c.effectiveAt
        || !windowAt(row.ref, dueAt, context) || !windowAt(row.authorization, dueAt, context)
        || !windowAt(e.evidence, dueAt, context) || e.electedAt > dueAt || !windowAt(e.evidence, e.electedAt, context)
        || e.userConfirmed !== true || e.planPermits !== true || e.instrumentFamily !== "health_fsa"
        || !same(e.scope, scope) || e.memberId !== p.personId
        || !e.annualEmployee.equals(p.annualElection) || !e.annualEmployer.equals(p.employerContribution)
        || row.alreadyAllocated !== (c.status === "previously_posted")) {
        fail("FSA_ELECTION_OR_SOURCE_INVALID", "unique original authorized health-FSA election, source windows, and exact prior allocation status", id); continue;
      }
      seen.add(id);
      if ([row.claimId, row.authorizationId, ...(c.postingRef ? [c.postingRef] : [])].some(k => claimUses.has(k))) {
        fail("FSA_CROSS_CLAIM_REUSE", "payroll authorization cannot reuse medical proof/payment/settlement", id); continue;
      }
      const bases = row.wageBases;
      if (!bases.complete || !unique(bases.required) || bases.required.length === 0
        || !unique(bases.facts.map(b => JSON.stringify([b.jurisdiction, b.regime])))
        || !same([...new Set(bases.facts.map(b => b.jurisdiction))], bases.required)
        || bases.facts.some(b => !text(b.ruleId) || !["income", "payroll", "periodic"].includes(b.regime) || !windowAt(b.evidence, dueAt, context))) {
        fail("FSA_WAGE_BASE_FACTS_INCOMPLETE", "independent complete federal/state/local jurisdiction and dated wage-base facts; no inferred exemptions", id, "tax");
      }
      if (row.funding.kind === "employer_grant") {
        const g = row.funding;
        if (c.contributionSource !== "employer" || g.employerId !== scope.employerId || g.fundingOwnerId !== scope.employerId || !text(g.grantId)
          || g.fundingSourceId !== c.sourceAccountId || !text(g.fundingSourceId) || g.planPermits !== true
          || !exact(g.authorizedAmount) || !g.authorizedAmount.equals(c.amount) || !windowAt(g.evidence, dueAt, context)) {
          fail("FSA_EMPLOYER_GRANT_REQUIRED", "separate original employer funding authorization and exact plan-permitted grant", id); continue;
        }
      } else {
        if (c.contributionSource !== "employee_salary_reduction" || row.funding.paycheck.dueAt !== dueAt
          || !validPaycheck(row.funding.paycheck, c, scope, context, input.originals)) {
          fail("FSA_ORIGINAL_PAYCHECK_INVALID", "exact signed original #101 paycheck, complete deduction inventory, job, owned BANK and gross capacity", id); continue;
        }
        if (!bases.required.includes("US:FEDERAL") || row.funding.paycheck.withholding.some(w => !bases.required.includes(w.election.jurisdiction))) {
          fail("FSA_WAGE_BASE_FACTS_INCOMPLETE", "all original withholding jurisdictions plus federal wage facts", id, "tax");
        }
      }
      rows.push(row);
    } catch { fail("FSA_SOURCE_INVALID", "valid dated exact-money original evidence", id); }
  }
  // Reject all contenders: source order must not pick an economic winner.
  const uses = new Map<string, number>();
  const keys = (r: FsaOriginalContribution) => [JSON.stringify(["claim", r.claimId]), JSON.stringify(["authorization", r.authorizationId]),
    JSON.stringify(["source", r.ref.sourceId, r.ref.sourceVersion]),
    ...(r.contribution.postingRef ? [JSON.stringify(["posting", r.contribution.postingRef])] : []),
    ...(r.funding.kind === "employee" ? [JSON.stringify(["paycheck", r.funding.paycheck.transactionId]),
      JSON.stringify(["occurrence", r.funding.paycheck.incomeId, r.funding.paycheck.occurrenceId]),
      JSON.stringify(["journal", r.funding.paycheck.journal.sourceId, r.funding.paycheck.journal.sourceVersion])]
      : [JSON.stringify(["grant", r.funding.grantId])])];
  for (const row of rows) for (const k of keys(row)) uses.set(k, (uses.get(k) ?? 0) + 1);
  const electionOwners = new Map<string, Set<string>>();
  for (const r of rows.filter(r => r.funding.kind === "employee")) {
    const owners = electionOwners.get(r.election.id) ?? new Set<string>();
    owners.add(canonical({ election: r.election, job: r.funding.kind === "employee"
      ? [r.funding.paycheck.employmentId, r.funding.paycheck.incomeId] : null }));
    electionOwners.set(r.election.id, owners);
  }
  for (const row of rows) {
    const c = row.contribution;
    if (keys(row).some(k => uses.get(k)! > 1) || (electionOwners.get(row.election.id)?.size ?? 0) > 1) {
      fail("FSA_DUPLICATE_OR_CROSS_JOB_AUTHORIZATION", "one original claim, payment, authorization and election/job owner", c.contributionId); continue;
    }
    if (c.status === "previously_posted") continue;
    const f = row.funding, w = f.kind === "employee" ? f.paycheck : null;
    bindings.push({ kind: "conditional_original_fsa_payroll", operationId: JSON.stringify(["fsa-payroll-binding/v1", fsaScopeId(scope), c.contributionId]),
      scope, contributionId: c.contributionId, claimId: row.claimId, authorizationId: row.authorizationId,
      memberId: row.election.memberId, electionId: row.election.id, effectiveAt: row.effectiveAt, contributionSource: c.contributionSource,
      authorizedEmployee: w ? c.amount : zero(), authorizedEmployer: w ? zero() : c.amount,
      requestRef: ref(original.ref), planRef: ref(original.planRef), lawRef: ref(original.lawRef),
      sourceRef: ref(row.ref), electionRef: ref(row.election.evidence), authorizationRef: ref(row.authorization),
      fundingRef: ref(f.kind === "employee" ? f.paycheck.employment : f.evidence),
      inputDigest: fsaPayrollDigest({ request: inputDigest, envelope: [original.ref, original.planRef, original.lawRef], original: row }), evaluationDigest,
      payroll: w ? { incomeId: w.incomeId, occurrenceId: w.occurrenceId, transactionId: w.transactionId, employmentId: w.employmentId,
        bankAccountId: w.bank.id, dueAt: w.dueAt, journalRef: ref(w.journal), journalDigest: w.signedJournalDigest } : null,
      employerGrantId: f.kind === "employer_grant" ? f.grantId : null,
      committed: false, postable: false, funding: "incomplete", payrollEffect: "incomplete", tax: "incomplete",
      entitlementSettlement: "incomplete", netWorthTreatment: "excluded_restricted_entitlement", medicalExpense: false, householdIncome: false });
  }
  return finish();
}

function validPaycheck(w: FsaOriginalPaycheck, c: FsaPayrollContribution, scope: FsaIdentity,
  context: FsaPayrollContext, originals: FsaPayrollOriginals): boolean {
  [w.dueAt, w.periodStart, w.periodEnd].forEach(instant);
  const tx = originals.journal(w.journal);
  if (!tx || ![w.journal.sourceId, w.journal.sourceVersion].every(text) || fsaPayrollDigest(tx) !== w.signedJournalDigest
    || tx.id !== w.transactionId || tx.date !== w.dueAt || tx.type !== "payroll_income"
    || w.transactionId !== `tx:recognition:income:${w.incomeId}:${w.dueAt}` || ![w.incomeId, w.occurrenceId, w.employmentId, w.bank.id].every(text)
    || w.employerId !== scope.employerId || w.ownerId !== scope.personId || w.householdId !== scope.householdId
    || w.bank.kind !== "BANK" || w.bank.ownerId !== scope.personId || w.bank.householdId !== scope.householdId
    || c.sourceAccountId !== w.incomeId || civilDate(w.dueAt.slice(0, 10)) !== c.effectiveAt
    || !(w.periodStart <= w.dueAt && w.dueAt < w.periodEnd) || !windowAt(w.employment, w.dueAt, context)
    || !windowAt(w.bank.evidence, w.dueAt, context) || !w.inventoryComplete || w.fsaClaimIds.length !== 0
    || !unique(w.contributions.map(r => r.id)) || !unique(w.withholding.map(r => r.election.id))
    || !unique(w.withholding.map(r => r.election.jurisdiction)) || !exact(w.gross) || !exact(w.netCash)
    || [...w.contributions, ...w.withholding, ...tx.legs].some(r => !exact(r.amount))) return false;
  const assets = new Map<string, Money>();
  const add = (id: string, m: Money) => assets.set(id, (assets.get(id) ?? zero()).plus(m));
  for (const r of w.contributions) {
    if (!["traditional_401k", "roth_401k", "after_tax_401k", "employee_hsa"].includes(r.character) || !text(r.positionId)) return false;
    add(r.positionId, r.amount);
  }
  for (const r of w.withholding) {
    const e = r.election;
    instant(e.start); if (e.end !== undefined) instant(e.end);
    if (e.version !== "payroll-withholding/v1" || !e.userConfirmed || !text(e.provenance) || e.incomeId !== w.incomeId
      || e.ownerId !== scope.personId || e.employerId !== scope.employerId || e.depositAccountId !== w.bank.id
      || !/^[A-Z][A-Z0-9]*(?::[A-Z0-9_]+)+$/.test(e.jurisdiction) || e.start > w.dueAt || e.end !== undefined && w.dueAt >= e.end
      || e.calculation.kind === "fixed" && !e.calculation.amount.equals(r.amount)) return false;
    add(taxBalanceIds(e.jurisdiction, w.dueAt.slice(0, 4)).creditPositionId, r.amount);
  }
  let cash = zero(), gross = zero(); let incomeCount = 0, cashCount = 0;
  for (const l of tx.legs) {
    if (l.type === "income" && l.posting === "credit") { gross = gross.plus(l.amount); incomeCount++; }
    else if (l.type === "cash" && l.posting === "debit" && l.accountId === w.bank.id && l.cashFlowClass === "operating") { cash = cash.plus(l.amount); cashCount++; }
    else if (l.type === "asset" && l.posting === "debit" && "entityId" in l) {
      const amount = assets.get(l.entityId);
      if (!amount || !amount.equals(l.amount)) return false;
      assets.delete(l.entityId);
    } else return false;
  }
  const deductions = [...w.contributions, ...w.withholding].reduce((s, r) => s.plus(r.amount), zero());
  return incomeCount === 1 && cashCount <= 1 && [...assets.values()].every(m => m.isZero())
    && gross.equals(w.gross) && cash.equals(w.netCash) && cash.plus(deductions).equals(gross)
    && deductions.plus(c.amount).compare(gross) <= 0;
}
