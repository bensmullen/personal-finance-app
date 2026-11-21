import { civilDate } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import type { HouseholdBankEventContext } from "../../../../../src/state/index.js";
import { registerNativeSsaMedicareOriginalProviders, registerSsaMedicareOriginalSources,
  type NativeSsaMedicareOccurrence } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import type { MedicareInstallmentOriginal, SsaInstallmentOriginal } from "../../../../../src/simulation/d2/integration/ssaMedicare/nativeHouseholdOriginalBridge/index.js";
import { irmaaOriginalDigest, proposeOriginalIrmaa, type IrmaaOriginals } from "../../../../../src/simulation/d2/health/medicare/originalBinding/index.js";
import { ssaOriginalDigest } from "../../../../../src/simulation/d2/retirement/benefits/ssaOriginalBinding/index.js";
import { cutoff as publicationDate, originalPayment, providers as domainPublishers, control, resetSources } from "../../ssaMedicare/originalScenario.js";
import { bank, ids, sameObservation } from "./bank.js";
import { observe } from "./sourceMeter.js";

const irmaaPublisher: IrmaaOriginals = { ...domainPublishers.irmaa, enrollments(query) {
  const inventory = domainPublishers.irmaa.enrollments(query);
  return control.zeroNet || !inventory ? inventory : { ...inventory, originals: inventory.originals.map(original => ({
    ...original, value: { ...original.value, enrollment: { ...original.value.enrollment, elected: ["part_b"] as const } },
  })) };
} };

export function resetBenefits(zeroNet = false): void {
  resetSources();
  benefitOriginals.clear();
  benefitFault.unavailable = "";
  control.zeroNet = zeroNet;
}

export function meterBenefitDomain(): void {
  control.changeSsa = original => observe("ssaAward", original);
  control.changeInventory = (_family, original) => observe("irmaa", original);
}

const ssaPublisherId = "331-ssa-installments";
const medicarePublisherId = "331-cms-installments";
const benefitOriginals = new Map<string, { event: NativeSsaMedicareOccurrence; ssa: SsaInstallmentOriginal;
  medicare: MedicareInstallmentOriginal }>();
export const benefitFault = { unavailable: "" };

function readBenefit<K extends "ssa" | "medicare">(family: K, context: HouseholdBankEventContext) {
  const issued = benefitOriginals.get(context.eventId);
  if (!issued || benefitFault.unavailable === context.eventId || issued.event.eventAt !== context.eventAt ||
      issued.event.personId !== context.personId || context.householdId !== ids.household ||
      context.direction !== "credit" || issued.event.bankAccountId !== context.bankAccountId || !sameObservation(context)) return undefined;
  const { eventId, eventAt, personId } = issued.event;
  return observe(family === "ssa" ? "ssaInstallment" : "medicareInstallment", {
    event: { eventId, eventAt, personId, householdId: ids.household },
    checkedAt: context.asOf, completeThrough: context.dataCutoff, completeness: "complete" as const,
    originals: [{ id: `${family}:${eventId}`, revision: "1", issuer: family === "ssa" ? "SSA" : "CMS",
      publishedAt: publicationDate, knownAt: publicationDate, status: "active" as const, document: issued[family] }],
  });
}
export function installBenefits(): void {
  registerSsaMedicareOriginalSources({ ssa: domainPublishers.ssa, irmaa: irmaaPublisher });
  registerNativeSsaMedicareOriginalProviders({
  ssa: { publisherId: ssaPublisherId, readOriginals: context => readBenefit("ssa", context) },
  medicare: { publisherId: medicarePublisherId, readOriginals: context => readBenefit("medicare", context) },
  });
}

export function publishBenefit(month: string, dataCutoff: HouseholdBankEventContext["dataCutoff"], oneCent = false): NativeSsaMedicareOccurrence {
  const { c2, payable, deductions, originalSources } = originalPayment(month);
  const { ssa: award, irmaa } = originalSources!;
  const cutoff = civilDate(dataCutoff.slice(0, 10));
  const history = domainPublishers.ssa.find(publisher => publisher.publisherId === award.publisherId)?.readOriginals({
    sourceId: award.sourceId, householdId: ids.household, recipientPersonId: ids.person, knownAt: cutoff, dataCutoff: cutoff,
  });
  const publication = history?.originals.find(original => original.originalId === award.originalId);
  if (!publication) throw new Error("Combined SSA award original unavailable");
  // Issue both installments against the shared observation cutoff from
  // the independent original book and the real award/surcharge producers.
  const partAllowed = (part: string) => control.zeroNet || part === "part_b";
  const elected = control.zeroNet ? ["part_b", "part_d"] as const : ["part_b"] as const;
  const queries = irmaa.filter(({ query }) => partAllowed(query.part)).map(({ query }) => ({ ...query, knownAt: dataCutoff }));
  const result = proposeOriginalIrmaa({ events: queries, originals: irmaaPublisher, deaths: [] });
  if (result.diagnostics.length || result.candidates.length !== queries.length)
    throw new Error("Combined CMS original inventory did not qualify");
  const event = { eventId: `ssa-medicare:${payable.paymentId}`, eventAt: payable.paymentAt,
    personId: ids.person, bankAccountId: ids.bank, ssaPublisherId, medicarePublisherId };
  benefitOriginals.set(event.eventId, {
    event,
    ssa: { recipient: publication.recipient, award: { ...award, dataCutoff: cutoff, digest: ssaOriginalDigest(publication) },
      payableSource: payable.source, withholding: { awardId: payable.awardId, workerRecordId: payable.workerRecordId,
        entitlementId: payable.entitlementId, amount: money("0"), source: payable.taxWithholding.source },
      bank: bank("ssaBank") },
    medicare: {
      premiums: { ...c2.premiums, coordination: control.zeroNet ? c2.premiums.coordination : [],
        coverages: c2.premiums.coverages.filter(coverage => partAllowed(coverage.medicare!.premiumFor)).map(coverage => ({
          ...coverage, medicare: { ...coverage.medicare!, elected },
          quote: oneCent && coverage.medicare!.premiumFor === "part_d"
            ? { ...coverage.quote, gross: money("119.99"), member: money("119.99") } : coverage.quote,
        })) },
      inventories: c2.inventories.map(inventory => ({ ...inventory, parts: inventory.parts.map(part =>
        part.status === "elected" && !partAllowed(part.part)
          ? { part: part.part, source: part.source, status: "excluded" as const, reason: "No Part D enrollment" } : part),
      surcharges: inventory.surcharges.map(surcharge => partAllowed(surcharge.part) ? surcharge
        : { ...surcharge, status: "not_applicable" as const, reason: "No Part D enrollment" }) })),
      irmaa: { ...c2.irmaa, enrollments: c2.irmaa.enrollments.filter(enrollment => partAllowed(enrollment.part))
        .map(enrollment => ({ ...enrollment, elected })) },
      deductionTerms: c2.deductionTerms.filter(terms => partAllowed(terms.part)).map(terms =>
        !oneCent || terms.part !== "part_d" ? terms : { ...terms, permittedAmount: money("119.99") }),
      surchargeOriginals: result.candidates.map(candidate => ({
        query: queries.find(query => query.part === candidate.part)!, candidateDigest: irmaaOriginalDigest(candidate),
      })),
      instructions: deductions.filter(({ terms }) => partAllowed(terms.premium.part)).map(({ terms }) => ({
        part: terms.premium.part === "part_b" ? "part_b" : "part_d",
        premiumSource: terms.premium.source, authorizationSource: terms.source,
      })),
    },
  });
  return event;
}
