import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { money, Money } from "../../../../../values/index.js";
import { proposePremiums, type EffectivePeriod, type MedicareElection, type PremiumProposal,
  type PremiumRequest, type PremiumSource } from "../../premiums/index.js";
import { evaluateIrmaa, type IrmaaCandidate, type IrmaaRequest } from "../index.js";
import { calculateQuotedBenefits, type QuotedBenefit } from "../../../retirement/benefits/index.js";

const parts: readonly MedicareElection[] = ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"];
/** Exhaustive source-owned inventory. An elected zero still needs a real C1 quote. */
export interface MedicareInventory extends EffectivePeriod {
  readonly householdId: string;
  readonly personId: string;
  readonly eventAt: CivilDate;
  readonly source: PremiumSource;
  readonly parts: readonly ({ readonly part: MedicareElection; readonly source: PremiumSource } & (
    { readonly status: "excluded"; readonly reason: string }
    | { readonly status: "elected"; readonly coverageId: string }))[];
  readonly surcharges: readonly { readonly part: "part_b" | "part_d";
    readonly status: "applicable" | "not_applicable"; readonly source: PremiumSource; readonly reason: string }[];
  readonly advantageStandaloneD?: { readonly compatible: true; readonly source: PremiumSource };
}
export interface BankEvidence extends EffectivePeriod {
  readonly householdId: string;
  readonly accountId: string;
  readonly accountKind: "BANK";
  readonly ownerIds: readonly string[];
  readonly source: PremiumSource;
}
export interface SsaDeductionTerms extends EffectivePeriod {
  readonly householdId: string;
  readonly personId: string;
  /** Exact A1 award identity, never a pension ID or another recipient's award. */
  readonly benefitId: string;
  readonly part: MedicareElection;
  readonly coverageId: string;
  readonly recipientId: string;
  readonly permittedAmount: Money;
  readonly source: PremiumSource;
}
export interface MedicareCoordinationRequest {
  readonly premiums: PremiumRequest;
  readonly irmaa: IrmaaRequest;
  readonly inventories: readonly MedicareInventory[];
  readonly banks: readonly BankEvidence[];
  readonly awards: readonly QuotedBenefit[];
  readonly deductionTerms: readonly SsaDeductionTerms[];
}
export interface MedicareObligation {
  readonly operationId: string;
  readonly claimId: string;
  readonly kind: "uncommitted_medicare_obligation";
  readonly committed: false;
  readonly householdId: string;
  readonly personId: string;
  readonly part: MedicareElection;
  readonly period: EffectivePeriod;
  readonly effectiveAt: CivilDate;
  readonly coverageId: string;
  readonly planId: string;
  readonly recipientId: string;
  readonly payerId: string;
  readonly quoteId: string;
  readonly memberBase: Money;
  readonly grossBase: Money;
  readonly employerShare: Money;
  readonly surcharge: Money;
  readonly memberObligation: Money;
  readonly base: PremiumProposal;
  readonly irmaa: IrmaaCandidate | null;
  readonly intendedRoute: Exclude<PremiumProposal["expectedSettlementRoute"], { kind: "pretax_payroll" }>;
  readonly consumedOperationIds: readonly string[];
  readonly traceRefs: readonly string[];
}
export interface CoordinationDiagnostic {
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly period: EffectivePeriod;
  readonly affectedOutput: "medicare_total";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const contains = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start <= b.start && a.endExclusive >= b.endExclusive;
const overlaps = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start < b.endExclusive && b.start < a.endExclusive;
const same = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start === b.start && a.endExclusive === b.endExclusive;
const exact = (m: Money): boolean => m instanceof Money && m.currency.code === "USD" && m.amount.fitsScale(2) && !m.isNegative();
const qualified = (s: PremiumSource, at: CivilDate, scope?: EffectivePeriod): boolean => {
  civilDate(s.asOf); civilDate(s.start); civilDate(s.endExclusive);
  return s.start < s.endExclusive && s.projectionStatus === "verified" && s.jurisdiction === "US"
    && [s.ruleSnapshotId, s.ruleFamily, s.sourcePublication, s.version].every(text)
    && s.asOf <= at && (!scope || contains(s, scope));
};
const snapshot = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money) return v;
  // These output collections are sets of facts, never economic precedence.
  if (Array.isArray(v)) return Object.freeze(v.map(x => snapshot(x))
    .sort((a, b) => order(JSON.stringify(a) ?? "", JSON.stringify(b) ?? ""))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(x)]))) as T;
};
const month = (at: CivilDate): EffectivePeriod => {
  const y = Number(at.slice(0, 4)), m = Number(at.slice(5, 7));
  return { start: civilDate(`${at.slice(0, 7)}-01`), endExclusive: civilDate(m === 12
    ? `${String(y + 1).padStart(4, "0")}-01-01` : `${at.slice(0, 4)}-${String(m + 1).padStart(2, "0")}-01`) };
};

/** Composition only: no recognition, net SSA payment, posting or shared capacity reservation. */
export function composeMedicareObligations(request: MedicareCoordinationRequest) {
  const p = request.premiums, i = request.irmaa;
  if (p.householdId !== i.householdId || !same(p.period, i.period)
    || JSON.stringify([...p.memberIds].sort(order)) !== JSON.stringify([...i.personIds].sort(order)))
    throw new Error("Medicare composition requires the same household, members and period");
  const c1 = proposePremiums(p), c2 = evaluateIrmaa(i);
  const obligations: MedicareObligation[] = [], diagnostics: CoordinationDiagnostic[] = [];
  const memberMonths: { personId: string; period: EffectivePeriod; coverage: "complete" | "incomplete"; amount: Money | null }[] = [];
  const fail = (person: string, period: EffectivePeriod, code: string, fact: string, part?: MedicareElection) => {
    const refs = request.inventories.filter(v => v.personId === person && overlaps(v, period)).map(v => v.source.ruleSnapshotId);
    diagnostics.push({ diagnosticCode: code, sourceEntityPath: `members/${encodeURIComponent(person)}/${part ?? "inventory"}`,
      period, affectedOutput: "medicare_total", coverage: "incomplete", missingFacts: [fact],
      ruleSnapshotId: refs.length === 1 ? refs[0]! : null, traceRefs: [...new Set(refs)].sort(order) });
  };
  for (const person of [...p.memberIds].sort(order)) {
    for (let at = month(p.period.start).start; at < p.period.endExclusive;) {
      const period = month(at); at = period.endExclusive;
      const startErrors = diagnostics.length, startRows = obligations.length;
      const inventories = request.inventories.filter(v => v.personId === person && overlaps(v, period));
      const inv = inventories[0];
      const badInventory = !contains(p.period, period) || inventories.length !== 1 || !inv
        || inv.householdId !== p.householdId || !contains(inv, period)
        || inv.eventAt < period.start || inv.eventAt >= period.endExclusive
        || !qualified(inv.source, inv.eventAt, period) || inv.source.ruleFamily !== "medicare_inventory"
        || inv.parts.length !== parts.length || parts.some(part => inv.parts.filter(e => e.part === part).length !== 1)
        || inv.parts.some(e => !qualified(e.source, inv.eventAt, period)
          || (e.status === "excluded" ? !text(e.reason) : !text(e.coverageId)))
        || inv.surcharges.length !== 2 || (["part_b", "part_d"] as const).some(part => inv.surcharges.filter(s => s.part === part).length !== 1)
        || inv.surcharges.some(s => !text(s.reason) || !qualified(s.source, inv.eventAt, period));
      if (badInventory || !inv) {
        fail(person, period, "COMPLETE_INVENTORY_REQUIRED", "one effective event-known exhaustive election and surcharge inventory");
      } else {
        const elected = inv.parts.filter(e => e.status === "elected");
        const selected = elected.map(e => e.part);
        const extra = p.coverages.some(c => c.medicare && c.memberIds.includes(person) && overlaps(c, period)
          && !elected.some(e => e.status === "elected" && e.coverageId === c.id && e.part === c.medicare!.premiumFor));
        const extraIrmaa = i.enrollments.some(e => e.personId === person && overlaps(e, period)
          && !elected.some(x => x.status === "elected" && x.part === e.part && x.coverageId === e.coverageId));
        if (extra || extraIrmaa || (selected.includes("advantage") && (selected.includes("medigap")
          || (selected.includes("part_d") && (!inv.advantageStandaloneD?.compatible
            || !qualified(inv.advantageStandaloneD.source, inv.eventAt, period))))))
          fail(person, period, "ELECTION_CONFLICT", "inventory must reconcile C1/C2 coverage and sourced compatible elections");
        for (const s of inv.surcharges) {
          if ((s.status === "applicable") !== selected.includes(s.part))
            fail(person, period, "SURCHARGE_INVENTORY_CONFLICT", "applicable B/D needs matching elected Part and base quote", s.part);
        }
        for (const entry of elected) {
          if (entry.status !== "elected") continue;
          const part = entry.part, before = diagnostics.length;
          const bases = c1.proposals.filter(b => b.memberIds.includes(person) && b.medicare?.premiumFor === part
            && b.effectiveAt >= period.start && b.effectiveAt < period.endExclusive);
          const b = bases[0], coverage = p.coverages.find(c => c.id === entry.coverageId);
          if (bases.length !== 1 || !b || !coverage || b.coverageId !== entry.coverageId
            || b.memberIds.length !== 1 || b.householdId !== p.householdId || b.effectiveAt < inv.eventAt
            || !contains(b.coveragePeriod, period) || coverage.quote.schedule.frequency !== "monthly"
            || coverage.quote.schedule.interval !== 1 || !b.medicare
            || JSON.stringify([...b.medicare.elected].sort(order)) !== JSON.stringify([...selected].sort(order))
            || ![b.memberAmount, b.grossAmount, b.employerAmount].every(exact)
            || !b.memberAmount.plus(b.employerAmount).equals(b.grossAmount)) {
            fail(person, period, "BASE_REQUIRED", "one matching whole-month C1 quote with reconciled USD cents", part); continue;
          }
          const evidence = [b.source, b.expectedSettlementRoute.evidence, b.medicare.enrollmentEvidence,
            b.medicare.compatibilityEvidence, ...b.eligibilityEvidence.map(e => e.evidence),
            ...b.coordinationEvidence.map(e => e.evidence)];
          if (!evidence.every(s => qualified(s, b.effectiveAt, period)))
            fail(person, period, "BASE_SOURCE_NOT_ADMITTED", "verified effective base and coordination known by claim event", part);
          let surcharge: IrmaaCandidate | null = null;
          if (part === "part_b" || part === "part_d") {
            const candidates = c2.candidates.filter(c => c.personId === person && c.part === part && overlaps(c.period, period));
            const rows = c2.coverage.filter(c => c.personId === person && c.part === part && overlaps(c.period, period));
            const enrollments = i.enrollments.filter(e => e.personId === person && e.part === part && overlaps(e, period));
            const c = candidates[0], e = enrollments[0];
            if (candidates.length !== 1 || rows.length !== 1 || rows[0]!.surchargeCoverage !== "complete"
              || !c || !e || enrollments.length !== 1 || !same(c.period, period) || !same(rows[0]!.period, period)
              || c.coverageId !== b.coverageId || c.planId !== b.planId || c.householdId !== b.householdId
              || JSON.stringify([...e.elected].sort(order)) !== JSON.stringify([...selected].sort(order))
              || !qualified(e.source, b.effectiveAt, period) || !qualified(c.ruleSource, b.effectiveAt, period)
              || !qualified(c.incomeSource, b.effectiveAt) || !exact(c.monthlySurcharge)
              || c2.diagnostics.some(d => d.diagnosticCode !== "TOTAL_AND_SETTLEMENT_OWNER_PENDING"
                && d.sourceEntityPath === `enrollments/${encodeURIComponent(b.coverageId)}/${encodeURIComponent(person)}/${part}`
                && overlaps(d.period, period))) {
              fail(person, period, "SURCHARGE_REQUIRED", "one event-known qualified C2 result including supported zero", part);
            } else surcharge = c;
          }
          const amount = b.memberAmount.plus(surcharge?.monthlySurcharge ?? money("0"));
          const route = b.expectedSettlementRoute, routeRefs: string[] = [];
          if (route.kind === "aftertax_bank") {
            const banks = request.banks.filter(a => a.accountId === route.sourceAccountId && overlaps(a, period));
            const bank = banks[0];
            if (banks.length !== 1 || !bank || bank.accountKind !== "BANK" || bank.householdId !== p.householdId
              || !bank.ownerIds.includes(route.payerId) || !p.memberIds.includes(route.payerId)
              || !contains(bank, period) || !qualified(bank.source, b.effectiveAt, period))
              fail(person, period, "BANK_REQUIRED", "one effective owned BANK source for the named payer", part);
            else routeRefs.push(bank.source.ruleSnapshotId);
            if (request.deductionTerms.some(t => t.personId === person && t.part === part && overlaps(t, period))
              || request.awards.some(a => a.recipientPersonId === person && a.benefitKind !== "pension"
                && a.medicareDeduction && a.commencement < period.endExclusive && (!a.endExclusive || a.endExclusive > period.start)))
              fail(person, period, "DOUBLE_ROUTE", "bank intent cannot also authorize SSA deduction", part);
          } else if (route.kind === "ssa_benefit_deduction_pending") {
            const awards = request.awards.filter(a => a.awardId === route.benefitId), award = awards[0];
            const terms = request.deductionTerms.filter(t => t.personId === person && t.part === part && overlaps(t, period)), term = terms[0];
            const gross = calculateQuotedBenefits({ householdId: p.householdId, horizon: period, awards: request.awards });
            const months = gross.recipientMonths.filter(m => m.awardId === route.benefitId && m.month === period.start.slice(0, 7)), payment = months[0];
            const sources = award ? [award.calendarSource, award.quote?.source, award.verifiedAward?.source,
              award.cola?.source, ...((award.cola?.changes ?? []).map(c => c.source)), award.claimingAdjustment?.source] : [];
            // A1 covers the installment from payment through month end, while
            // the premium's legal coverage still includes the whole month.
            const installment = payment && { start: payment.effectiveAt, endExclusive: period.endExclusive };
            if (route.payerId !== person || awards.length !== 1 || !award || award.recipientPersonId !== person
              || award.householdId !== p.householdId || award.benefitKind === "pension" || award.frequency !== "monthly"
              || !award.quote || !installment || !contains(award.quote.coveredHorizon, installment)
              || !award.verifiedAward || !contains(award.verifiedAward.coveredHorizon, installment)
              || !award.cola || !contains(award.cola.coveredHorizon, installment)
              || (award.endExclusive !== undefined && award.endExclusive < period.endExclusive)
              || sources.some(s => s && (s.projectionStatus !== "verified" || s.jurisdiction !== "US" || s.asOf > installment.start))
              || months.length !== 1 || !payment || payment.recipientPersonId !== person || payment.coverage !== "complete"
              || payment.effectiveAt < period.start || payment.effectiveAt >= period.endExclusive
              || !payment.grossAmount || !exact(payment.grossAmount) || !payment.grossAmount.isPositive()
              || payment.grossAmount.amount.compare(amount.amount) < 0
              || payment.effectiveAt < b.effectiveAt || terms.length !== 1 || !term || term.benefitId !== route.benefitId
              || term.householdId !== p.householdId || term.coverageId !== b.coverageId || term.recipientId !== b.recipientId
              || !contains(term, period) || !qualified(term.source, payment.effectiveAt, period)
              || term.source.ruleFamily !== "ssa_medicare_deduction" || !exact(term.permittedAmount) || !term.permittedAmount.equals(amount))
              fail(person, period, "SSA_TERMS_REQUIRED", "matching verified gross SSA award and legally supported exact deduction terms", part);
            else routeRefs.push(term.source.ruleSnapshotId, ...sources.flatMap(s => s ? [s.ruleSnapshotId] : []));
          } else fail(person, period, "ROUTE_REQUIRED", "exclusive bank or SSA uncommitted intent", part);
          if (diagnostics.length !== before || route.kind === "pretax_payroll") continue;
          const claimId = JSON.stringify(["medicare", p.householdId, person, part, period.start]);
          obligations.push({ operationId: claimId, claimId, kind: "uncommitted_medicare_obligation", committed: false,
            householdId: p.householdId, personId: person, part, period, effectiveAt: b.effectiveAt,
            coverageId: b.coverageId, planId: b.planId, recipientId: b.recipientId, payerId: b.payerId, quoteId: b.quoteId,
            memberBase: b.memberAmount, grossBase: b.grossAmount, employerShare: b.employerAmount,
            surcharge: surcharge?.monthlySurcharge ?? money("0"), memberObligation: amount, base: b, irmaa: surcharge,
            intendedRoute: route, consumedOperationIds: [b.operationId, ...(surcharge ? [surcharge.operationId] : [])].sort(order),
            traceRefs: [...new Set([inv.source.ruleSnapshotId, ...inv.parts.map(e => e.source.ruleSnapshotId),
              ...inv.surcharges.map(s => s.source.ruleSnapshotId), ...(inv.advantageStandaloneD ? [inv.advantageStandaloneD.source.ruleSnapshotId] : []),
              ...b.traceRefs, ...(surcharge?.traceRefs ?? []), ...routeRefs])].sort(order) });
        }
      }
      const complete = diagnostics.length === startErrors;
      if (!complete) obligations.splice(startRows);
      memberMonths.push({ personId: person, period, coverage: complete ? "complete" : "incomplete",
        amount: complete ? obligations.slice(startRows).reduce((sum, row) => sum.plus(row.memberObligation), money("0")) : null });
    }
  }
  obligations.sort((a, b) => order(a.claimId, b.claimId));
  diagnostics.sort((a, b) => order(a.sourceEntityPath, b.sourceEntityPath) || order(a.period.start, b.period.start)
    || order(a.diagnosticCode, b.diagnosticCode));
  const complete = memberMonths.every(m => m.coverage === "complete");
  return snapshot({ contractVersion: "d2-shared/v1" as const, evidenceTier: "conditional" as const, obligations, memberMonths,
    householdTotal: complete ? memberMonths.reduce((sum, m) => sum.plus(m.amount!), money("0")) : null,
    medicareTotalCoverage: complete ? "complete" as const : "incomplete" as const,
    netCashCoverage: "incomplete" as const, taxEffectsCoverage: "incomplete" as const,
    postingsCoverage: "not_applicable" as const, diagnostics, premiumEvaluation: c1, irmaaEvaluation: c2 });
}
