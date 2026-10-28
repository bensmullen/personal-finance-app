import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate } from "../../../../../time/index.js";
import { Money } from "../../../../../values/index.js";
import { canonicalSerialize } from "../../../../run.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { propose529Distribution, type EducationRequest, type EducationResult, type EducationProposal, type EducationSource } from "../index.js";
import type { BindingCode, CompactEconomics, DistributionBinding, DistributionBindingResult, DistributionOriginal,
  DistributionOriginalPorts, OriginalPin, OriginalRole } from "./types.js";
export type * from "./types.js";

const common = ["plan", "funding", "law", "usage", "trustee", "route"] as const;
const tuitionRoles = ["tuition", "adjustments", "payment"] as const;
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const id = (v: string): boolean => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const distributionOriginalDigest = <K extends OriginalRole>(o: DistributionOriginal<K>): string =>
  `529-distribution-original/v1:sha256:${sha256(canonicalSerialize(o))}`;
class Refused extends Error {
  constructor(readonly code: BindingCode, readonly port: OriginalRole | null = null) { super(code); }
}
const need = (ok: boolean, code: BindingCode): void => { if (!ok) throw new Refused(code); };
const unique = (ids: readonly string[], code: BindingCode): void => {
  need(ids.every(id) && new Set(ids).size === ids.length, code);
};
/** Check nested observations even in unused receipts/adjustments. Effective legal
 * qualification and historical fact-date admission remain the evaluator's job. */
const observationsAt = (value: unknown, cutoff: EducationRequest["knownAt"]): void => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) observationsAt(item, cutoff); return; }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return;
  const record = value as Record<string, unknown>;
  if (record.ruleFamily === "education_529" && "sourcePublication" in record) {
    const s = value as EducationSource;
    for (const d of [s.publishedAt, s.asOf, s.start, s.endExclusive]) civilDate(d);
    need(s.publishedAt <= s.asOf && s.asOf <= cutoff && s.start < s.endExclusive, "ORIGINAL_CHRONOLOGY_INVALID");
  }
  for (const item of Object.values(record)) observationsAt(item, cutoff);
};
const compact = (p: EducationProposal): CompactEconomics => ({ grossAmount: p.grossAmount,
  basisRecovered: p.basisRecovered, earnings: p.earnings, planAssetDelta: p.planAssetDelta,
  ownedBankCashDelta: p.ownedBankCashDelta, institutionClaimLiabilityDelta: p.institutionClaimLiabilityDelta,
  institutionPaymentAmount: p.institutionPaymentAmount, basisDelta: p.basisDelta, movementNetWorthDelta: p.movementNetWorthDelta,
  bankReceiptCharacter: p.bankReceiptCharacter, taxFacts: p.taxFacts,
  expense: p.expense ? { paidExpenseId: p.expense.paidExpenseId, economicExpenseId: p.expense.economicExpenseId,
    recognize: p.expense.recognize, amount: p.expense.amount, institutionClaimId: p.expense.institutionClaimId } : null });

/** Source-only conditional adapter. Economic allocation and legal coverage remain
 * owned by the unchanged evaluator. No stock, BANK or tax writer. */
export function bind529DistributionOriginals(input: readonly DistributionBinding[], ports: DistributionOriginalPorts): DistributionBindingResult {
  if (input.length > 256) throw new RangeError("DISTRIBUTION_BINDING_BATCH_LIMIT");
  const bindings = immutableConfiguration(input);
  const occurrences: DistributionBindingResult["occurrences"][number][] = [];
  const diagnostics: DistributionBindingResult["diagnostics"][number][] = [];
  const keys = (b: DistributionBinding): string[] => {
    const h = b.identity.householdId, t = b.identity.tuition;
    return [["event", h, b.event.eventId], ["operation", h, b.event.operationId], ["claim", h, b.event.claimId],
      ["plan-snapshot", h, b.identity.planId, b.event.effectiveAt],
      ["source-cash", h, b.identity.sourceAccountId, b.event.effectiveAt],
      ...(t ? [["paid-expense", h, t.paidExpenseId], ["economic-expense", h, t.economicExpenseId]] : [])].map(canonicalSerialize);
  };
  // Includes unavailable candidates. Never select an economic winner by source/order availability.
  const counts = new Map<string, number>();
  for (const b of bindings) for (const key of new Set(keys(b))) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const b of [...bindings].sort((a, c) => compare(canonicalSerialize(a), canonicalSerialize(c)))) {
    try {
      const i = b.identity, e = b.event, qualified = e.kind === "qualified_distribution";
      need([i.householdId, i.ownerId, i.beneficiaryId, i.planId, i.providerId, i.planAccountId,
        i.sourceAccountId, i.destinationAccountId, i.payeeId, e.eventId, e.operationId, e.claimId].every(id), "INVALID_BINDING");
      need(e.kind === "qualified_distribution" || e.kind === "nonqualified_distribution", "INVALID_BINDING");
      need(qualified ? i.tuition !== null && Object.values(i.tuition).every(id) : i.tuition === null, "INVALID_BINDING");
      civilDate(e.effectiveAt); civilDate(e.cutoff);
      need(e.cutoff === e.effectiveAt && Number.isSafeInteger(e.taxYear) && Number(e.effectiveAt.slice(0, 4)) === e.taxYear, "INVALID_BINDING");
      need(e.gross.isPositive() && e.gross.amount.fitsScale(2) && e.gross.currency.minorUnitScale === 2, "INVALID_BINDING");
      need(keys(b).every(key => counts.get(key) === 1), "CONTESTED_CLAIM");
      const roles: readonly OriginalRole[] = qualified ? [...common, ...tuitionRoles] : common;
      for (const role of roles) if (!b.originals[role] || !ports[role]) throw new Refused("ORIGINAL_UNAVAILABLE", role);
      unique(roles.map(role => b.originals[role]!.producerId), "INDEPENDENT_PRODUCER_REQUIRED");
      const read = <K extends OriginalRole>(role: K): DistributionOriginal<K> => {
        const pin = b.originals[role], port = ports[role];
        if (!pin || !port) throw new Refused("ORIGINAL_UNAVAILABLE", role);
        need([pin.producerId, pin.sourceId, pin.version].every(id) &&
          /^529-distribution-original\/v1:sha256:[a-f0-9]{64}$/.test(pin.digest), "INVALID_BINDING");
        let fetched: DistributionOriginal<K> | undefined;
        try { fetched = port(pin, e.cutoff); } catch { throw new Refused("ORIGINAL_UNAVAILABLE", role); }
        if (!fetched || fetched.status !== "active") throw new Refused("ORIGINAL_UNAVAILABLE", role);
        const o = immutableConfiguration(fetched);
        need(o.role === role && o.producerId === pin.producerId && o.sourceId === pin.sourceId && o.version === pin.version
          && distributionOriginalDigest(o) === pin.digest, "ORIGINAL_CHANGED");
        need(same(o.identity, i) && same(o.event, e), "ORIGINAL_SCOPE_MISMATCH");
        for (const d of [o.issuedAt, o.publishedAt, o.knownAt, o.asOf, o.start, o.endExclusive]) civilDate(d);
        need(o.issuedAt <= o.publishedAt && o.publishedAt <= o.knownAt && o.knownAt <= e.cutoff &&
          o.publishedAt <= o.asOf && o.asOf === e.cutoff && o.start <= e.effectiveAt && e.effectiveAt < o.endExclusive,
        "ORIGINAL_CHRONOLOGY_INVALID");
        observationsAt(o.payload, e.cutoff);
        return o;
      };
      const plan = read("plan").payload, funding = read("funding").payload, law = read("law").payload;
      const usage = read("usage").payload, trustee = read("trustee").payload, route = read("route").payload;
      const p = plan.plan, r = route.route;
      need(same({ householdId: p.householdId, ownerId: p.ownerId, beneficiaryId: p.beneficiaryId,
        planId: p.planId, providerId: p.providerId, planAccountId: p.accountId, sourceAccountId: p.cashAccountId,
        destinationAccountId: r.accountId, payeeId: route.payeeId, tuition: i.tuition }, i), "ORIGINAL_SCOPE_MISMATCH");
      need(route.accountKind === (r.kind === "owned_bank" ? "BANK" : "institution") &&
        (r.kind === "owned_bank" ? route.payeeId === p.ownerId : route.payeeId === r.payeeId), "ORIGINAL_SCOPE_MISMATCH");
      need(plan.complete === "all_current_lots" && funding.complete === "since_inception", "COMPLETE_INVENTORY_REQUIRED");
      need(plan.lots.length <= 10000 && funding.entries.length <= 10000, "COMPLETE_INVENTORY_REQUIRED");
      unique(plan.lots.map(l => l.lotId), "FUNDING_NOT_RECONCILED");
      unique(plan.lots.map(l => l.basisId), "FUNDING_NOT_RECONCILED");
      unique(funding.entries.map(f => f.operationId), "FUNDING_NOT_RECONCILED");
      unique(funding.entries.map(f => f.lotId), "FUNDING_NOT_RECONCILED");
      need(funding.entries.length === p.contributions.length && plan.lots.length === p.contributions.length, "FUNDING_NOT_RECONCILED");
      const contributionsByLot = new Map(p.contributions.map(c => [c.lotId, c]));
      const fundingByLot = new Map(funding.entries.map(f => [f.lotId, f]));
      const exact = (m: Money): boolean => m.currency.equals(e.gross.currency) && !m.isNegative() && m.amount.fitsScale(2);
      let basis = Money.zero(e.gross.currency), earnings = Money.zero(e.gross.currency);
      for (const lot of plan.lots) {
        need(contributionsByLot.get(lot.lotId)?.basisId === lot.basisId && exact(lot.basis) && exact(lot.earnings), "FUNDING_NOT_RECONCILED");
        basis = basis.plus(lot.basis); earnings = earnings.plus(lot.earnings);
      }
      need(Boolean(p.snapshot.contributionBasis?.equals(basis) && p.snapshot.earnings?.equals(earnings)), "FUNDING_NOT_RECONCILED");
      for (const c of p.contributions) {
        const f = fundingByLot.get(c.lotId);
        need(Boolean(f && f.basisId === c.basisId && f.operationId === c.fundingOperationId && f.fundedAt === c.fundedAt &&
          f.householdId === p.householdId && f.ownerId === p.ownerId && id(f.bankAccountId) &&
          ![p.accountId, p.cashAccountId].includes(f.bankAccountId) && f.accountKind === "BANK" &&
          f.planCashAccountId === p.cashAccountId && f.status === "posted" &&
          f.bankDebit.equals(c.principal) && f.planCredit.equals(c.principal)), "FUNDING_NOT_RECONCILED");
      }
      need(usage.complete === "all_household_education_uses_including_pending" && usage.at === e.cutoff && usage.entries.length <= 10000,
        "COMPLETE_INVENTORY_REQUIRED");
      unique(usage.entries.map(u => u.usage.operationId), "CONTESTED_CLAIM");
      unique(usage.entries.map(u => u.usage.claimId), "CONTESTED_CLAIM");
      for (const u of usage.entries) {
        need(u.householdId === i.householdId && id(u.economicExpenseId), "ORIGINAL_SCOPE_MISMATCH");
        need(u.usage.operationId !== e.operationId && u.usage.claimId !== e.claimId, "CONTESTED_CLAIM");
        if (i.tuition && (u.usage.paidExpenseId === i.tuition.paidExpenseId || u.economicExpenseId === i.tuition.economicExpenseId))
          need(u.usage.paidExpenseId === i.tuition.paidExpenseId && u.economicExpenseId === i.tuition.economicExpenseId &&
            u.usage.beneficiaryId === i.beneficiaryId, "CONTESTED_CLAIM");
      }
      let expense: EducationRequest["expense"] = null;
      if (qualified) {
        const tuition = read("tuition").payload, adjustments = read("adjustments").payload, payment = read("payment").payload;
        need(tuition.complete === "all_receipts" && adjustments.complete === "all_adjustments_and_benefits" &&
          payment.complete === "all_payments_and_recognition", "COMPLETE_INVENTORY_REQUIRED");
        need(tuition.bills.length <= 10000 && adjustments.entries.length === tuition.bills.length && payment.entries.length === tuition.bills.length,
          "COMPLETE_INVENTORY_REQUIRED");
        unique(tuition.bills.map(t => t.paidExpenseId), "TUITION_NOT_RECONCILED");
        unique(adjustments.entries.map(t => t.paidExpenseId), "TUITION_NOT_RECONCILED");
        unique(payment.entries.map(t => t.paidExpenseId), "TUITION_NOT_RECONCILED");
        unique(payment.entries.map(t => t.economicExpenseId), "TUITION_NOT_RECONCILED");
        unique(payment.entries.flatMap(t => t.payment ? [t.payment.operationId] : []), "TUITION_NOT_RECONCILED");
        unique(payment.entries.flatMap(t => t.unpaidClaim ? [t.unpaidClaim.claimId] : []), "TUITION_NOT_RECONCILED");
        const adjustmentsByExpense = new Map(adjustments.entries.map(a => [a.paidExpenseId, a]));
        const paymentsByExpense = new Map(payment.entries.map(paid => [paid.paidExpenseId, paid]));
        // Validate the entire receipt/payment inventory, not just the selected bill.
        for (const bill of tuition.bills) {
          const a = adjustmentsByExpense.get(bill.paidExpenseId);
          const paid = paymentsByExpense.get(bill.paidExpenseId);
          if (!a || !paid) throw new Refused("TUITION_NOT_RECONCILED");
          need(paid.studentId === bill.studentId && paid.institutionId === bill.institutionId && paid.payeeId === bill.payeeId &&
            paid.termId === bill.termId && paid.economicExpenseId === paid.recognition.economicExpenseId, "TUITION_NOT_RECONCILED");
          civilDate(bill.incurredAt);
          need(bill.incurredAt <= e.cutoff, "ORIGINAL_CHRONOLOGY_INVALID");
          if (bill.paymentMethod === "bank_paid") {
            const debit = paid.payment;
            if (debit) {
              civilDate(debit.paidAt);
              need(bill.incurredAt <= debit.paidAt && debit.paidAt <= e.cutoff, "ORIGINAL_CHRONOLOGY_INVALID");
            }
            need(Boolean(debit && id(debit.operationId) && debit.status === "posted" && debit.accountKind === "BANK" &&
              debit.accountId === bill.payerAccountId && debit.payerId === bill.payerId && debit.paidAt === bill.paidAt &&
              debit.amount.equals(bill.billed) && paid.unpaidClaim === null), "TUITION_NOT_RECONCILED");
          } else need(bill.paymentMethod === "direct_plan_payment" && bill.paidAt === null && paid.payment === null && paid.unpaidClaim !== null,
            "TUITION_NOT_RECONCILED");
          if (bill.paidExpenseId === i.tuition!.paidExpenseId) {
            need(same(i.tuition, { paidExpenseId: bill.paidExpenseId, economicExpenseId: paid.economicExpenseId,
              studentId: bill.studentId, institutionId: bill.institutionId, termId: bill.termId }), "ORIGINAL_SCOPE_MISMATCH");
            expense = { ...bill, adjustments: a.adjustments, adjustedEligible: a.adjustedEligible,
              adjustmentsComplete: "verified_complete", unreimbursedUse: a.unreimbursedUse,
              recognition: paid.recognition, unpaidClaim: paid.unpaidClaim };
          }
        }
        need(expense !== null, "TUITION_NOT_RECONCILED");
      } else need(law.qualification === null, "ORIGINAL_SCOPE_MISMATCH");
      need(trustee.authorization.gross.equals(e.gross), "ORIGINAL_SCOPE_MISMATCH");
      const request: EducationRequest = { operationId: e.operationId, claimId: e.claimId, kind: e.kind,
        effectiveAt: e.effectiveAt, knownAt: e.cutoff, taxYear: e.taxYear, currency: e.gross.currency, gross: trustee.authorization.gross,
        plan: p, rules: law.rules, qualification: law.qualification, expense, route: r, authorization: trustee.authorization,
        usage: { at: usage.at, complete: "verified_complete", source: usage.source,
          entries: usage.entries.filter(u => u.usage.beneficiaryId === i.beneficiaryId).map(u => u.usage) } };
      let evaluated: EducationResult;
      try { evaluated = propose529Distribution(request); }
      finally {
        // Even a failed first re-read must not skip another independent source.
        let race: unknown;
        for (const role of roles) try { read(role); } catch (error) { race ??= error; }
        if (race) throw race;
      }
      const originals: Partial<Record<OriginalRole, OriginalPin>> = {};
      for (const role of roles) {
        const pin = b.originals[role]!;
        originals[role] = { producerId: pin.producerId, sourceId: pin.sourceId, version: pin.version, digest: pin.digest };
      }
      const proposal = evaluated.proposals[0];
      // A conditional result is only emitted when the underlying evaluator
      // actually produced an admitted proposal. Diagnostics alone are not economics.
      if (!proposal) throw new Refused("EVALUATION_INCOMPLETE");
      occurrences.push({ contractVersion: "529-distribution-original/v1",
        identity: { householdId: i.householdId, ownerId: i.ownerId, beneficiaryId: i.beneficiaryId, planId: i.planId,
          providerId: i.providerId, planAccountId: i.planAccountId, sourceAccountId: i.sourceAccountId,
          destinationAccountId: i.destinationAccountId, payeeId: i.payeeId, tuition: i.tuition ? {
            paidExpenseId: i.tuition.paidExpenseId, economicExpenseId: i.tuition.economicExpenseId, studentId: i.tuition.studentId,
            institutionId: i.tuition.institutionId, termId: i.tuition.termId } : null },
        event: { eventId: e.eventId, operationId: e.operationId, claimId: e.claimId, kind: e.kind,
          effectiveAt: e.effectiveAt, cutoff: e.cutoff, taxYear: e.taxYear, gross: e.gross }, originals,
        committed: false, postable: false, physicalDistribution: "not_applied", settlement: "incomplete",
        taxLiability: "incomplete", penalty: "incomplete", economics: proposal ? compact(proposal) : null,
        coverage: evaluated.coverage.map(({ affectedOutput, coverage, diagnosticCode, ruleSnapshotId }) =>
          ({ affectedOutput, coverage, diagnosticCode, ruleSnapshotId })) });
    } catch (error) {
      diagnostics.push({ eventId: b.event.eventId, operationId: b.event.operationId,
        code: error instanceof Refused ? error.code : "INVALID_BINDING", missingPort: error instanceof Refused ? error.port : null,
        coverage: "incomplete" });
    }
  }
  return immutableConfiguration({ occurrences, diagnostics });
}
