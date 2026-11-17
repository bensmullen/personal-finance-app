import { accountingTransactionId } from "../../../../../accounting/index.js";
import { ValidationError } from "../../../../../diagnostics/index.js";
import { claimId, settlementId } from "../../../../../semantics/identity.js";
import type { SsaDeductionSource, SsaPayableEvidence } from "../../../../../semantics/settlement.js";
import { registerHouseholdEconomicOriginalAuthority, ssaMedicarePaymentJournal,
  type HouseholdBankEventContext, type HouseholdEconomicWitness } from "../../../../../state/index.js";
import { civilDate, instant, type Instant } from "../../../../../time/index.js";
import { money, type Money } from "../../../../../values/index.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { composeMedicareObligations, type MedicareCoordinationRequest } from "../../../health/medicare/coordination/index.js";
import { irmaaOriginalDigest } from "../../../health/medicare/originalBinding/index.js";
import { coordinateSocialSecurity } from "../../../retirement/benefits/coordination/index.js";
import { qualifyHouseholdBankRoute } from "../../householdBank/index.js";
import type { SsaMedicarePaymentFacts } from "../index.js";
import type { SsaMedicareOriginalSources } from "../originalSources.js";
import { fail, qualifyRawPayment, same } from "./qualification.js";

export interface NativeSsaMedicareOriginalInput {
  readonly mode: "ssa-medicare-originals/v2";
  readonly context: HouseholdBankEventContext;
  readonly ssaPublisherId: string;
  readonly medicarePublisherId: string;
  readonly bankCashBefore: Money;
}

interface Publication<T> {
  readonly id: string;
  readonly revision: string;
  readonly issuer: string;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly status: "active" | "withdrawn";
  readonly document: T;
}
interface Inventory<T> {
  readonly event: Pick<HouseholdBankEventContext, "householdId" | "personId" | "eventId" | "eventAt">;
  readonly checkedAt: Instant;
  readonly completeThrough: Instant;
  readonly completeness: "complete" | "unknown";
  readonly originals: readonly Publication<T>[];
}
export interface SsaInstallmentOriginal {
  readonly recipient: Parameters<typeof coordinateSocialSecurity>[0]["recipients"][number];
  readonly award: SsaMedicareOriginalSources["ssa"];
  readonly payableSource: SsaDeductionSource;
  readonly withholding: {
    readonly awardId: string;
    readonly workerRecordId: string;
    readonly entitlementId: string;
    readonly amount: Money;
    readonly source: SsaDeductionSource;
  };
  readonly bank: { readonly publisherId: string; readonly sourceId: string };
}
export interface MedicareInstallmentOriginal {
  readonly premiums: MedicareCoordinationRequest["premiums"];
  readonly inventories: MedicareCoordinationRequest["inventories"];
  readonly irmaa: MedicareCoordinationRequest["irmaa"];
  readonly surchargeOriginals: SsaMedicareOriginalSources["irmaa"];
  readonly deductionTerms: MedicareCoordinationRequest["deductionTerms"];
  readonly instructions: readonly {
    readonly part: "part_b" | "part_d";
    readonly premiumSource: SsaDeductionSource;
    readonly authorizationSource: SsaDeductionSource;
  }[];
}
type Reader<T> = (context: HouseholdBankEventContext) => Inventory<T> | undefined;
const ssaReaders = new Map<string, Reader<SsaInstallmentOriginal>>();
const medicareReaders = new Map<string, Reader<MedicareInstallmentOriginal>>();
const pairedPublishers = new Map<string, string>();
function requireOriginal(condition: boolean): asserts condition {
  if (!condition) throw new ValidationError({ severity: "error", code: "SSA_MEDICARE_NATIVE_ORIGINAL_NOT_ADMITTED",
    entityType: "ssa_medicare_payment", message: "Current independent SSA, Medicare and household BANK originals are required" });
}

/** Composition-time ports supply source documents and their revision histories. */
export function registerNativeSsaMedicareOriginalProviders(providers: {
  readonly ssa: { readonly publisherId: string; readonly readOriginals: Reader<SsaInstallmentOriginal> };
  readonly medicare: { readonly publisherId: string; readonly readOriginals: Reader<MedicareInstallmentOriginal> };
}): void {
  const ssaId = providers.ssa.publisherId, medicareId = providers.medicare.publisherId;
  requireOriginal(Boolean(ssaId.trim()) && Boolean(medicareId.trim()) && !ssaReaders.has(ssaId) && !medicareReaders.has(medicareId));
  function register(family: "ssa" | "medicare", publisherId: string) {
    registerHouseholdEconomicOriginalAuthority(family, publisherId, { qualify: (reference, context) => {
      try {
        // Opening cash is verified by the writer. It does not contribute to
        // the gross, deduction, net or either source witness.
        const qualified = qualifyNativeSsaMedicareInput({ mode: "ssa-medicare-originals/v2", context,
          ssaPublisherId: ssaId, medicarePublisherId: medicareId, bankCashBefore: zero });
        const witness = qualified.payment.nativeHousehold!.originals.find(row => row.original.family === family)!;
        if (!same(reference, witness.original)) return undefined;
        return { witness, context, requiredFamilies: ["ssa", "medicare"], transaction: ssaMedicarePaymentJournal(qualified.payment) };
      } catch { return undefined; }
    } });
  }
  register("ssa", ssaId);
  register("medicare", medicareId);
  ssaReaders.set(ssaId, providers.ssa.readOriginals.bind(providers.ssa));
  medicareReaders.set(medicareId, providers.medicare.readOriginals.bind(providers.medicare));
  pairedPublishers.set(ssaId, medicareId);
}

const zero = money("0");

function readCurrent<T>(reader: Reader<T> | undefined, context: HouseholdBankEventContext) {
  requireOriginal(reader !== undefined);
  const read = () => reader(context);
  const inventory = immutableConfiguration(read());
  const { householdId, personId, eventId, eventAt, dataCutoff, asOf } = context;
  requireOriginal(inventory !== undefined && inventory.completeness === "complete" &&
    same(inventory.event, { householdId, personId, eventId, eventAt }) &&
    inventory.checkedAt === asOf && inventory.completeThrough === dataCutoff && inventory.originals.length <= 1200);
  const originals = inventory.originals;
  for (const original of originals) {
    instant(original.publishedAt); instant(original.knownAt);
    requireOriginal(Boolean(original.id.trim()) && Boolean(original.revision.trim()) && Boolean(original.issuer.trim()) &&
      original.publishedAt <= original.knownAt && (original.status === "active" || original.status === "withdrawn"));
  }
  requireOriginal(new Set(originals.map(row => row.revision)).size === originals.length &&
    new Set(originals.map(row => row.id)).size === 1);
  const visible = originals.filter(row => row.knownAt <= dataCutoff)
    .sort((a, b) => a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0);
  const selected = visible[0];
  requireOriginal(selected !== undefined && selected.status === "active" &&
    selected.knownAt <= eventAt && selected.publishedAt !== visible[1]?.publishedAt);
  const digest = irmaaOriginalDigest(inventory);
  return { selected, unchanged: () => requireOriginal(irmaaOriginalDigest(read()) === digest) };
}

type Observation = Pick<HouseholdBankEventContext, "asOf" | "dataCutoff">;

export function qualifyNativeSsaMedicareInput(input: NativeSsaMedicareOriginalInput, observation?: Observation,
  retainSourceCheck?: (check: () => void) => void) {
  try {
    return rebuildNativeSsaMedicarePayment(immutableConfiguration(input), observation, retainSourceCheck);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return fail("SSA_MEDICARE_SOURCE_INCOMPLETE", "Valid current SSA, Medicare and household BANK originals required");
  }
}

function rebuildNativeSsaMedicarePayment(input: NativeSsaMedicareOriginalInput, observation?: Observation,
  retainSourceCheck?: (check: () => void) => void) {
  const c = input.context;
  instant(c.asOf); instant(c.dataCutoff); instant(c.eventAt);
  const { mode, ssaPublisherId, medicarePublisherId, bankCashBefore } = input;
  const { runId, eventId, eventAt, householdId, personId, bankAccountId, direction, asOf, dataCutoff } = c;
  requireOriginal(mode === "ssa-medicare-originals/v2" && direction === "credit" && dataCutoff <= asOf &&
    pairedPublishers.get(ssaPublisherId) === medicarePublisherId && same(input, { mode, ssaPublisherId, medicarePublisherId, bankCashBefore,
      context: { runId, eventId, eventAt, householdId, personId, bankAccountId, direction, asOf, dataCutoff } }));
  const ssa = readCurrent(ssaReaders.get(input.ssaPublisherId), c);
  const medicare = readCurrent(medicareReaders.get(input.medicarePublisherId), c);
  const s = ssa.selected.document, m = medicare.selected.document, date = civilDate(c.eventAt.slice(0, 10));
  const a1 = { householdId: c.householdId, horizon: m.premiums.period,
    knownAt: c.dataCutoff <= c.eventAt ? civilDate(c.dataCutoff.slice(0, 10)) : date, recipients: [s.recipient] };
  const output = coordinateSocialSecurity(a1), award = output.proposals[0];
  requireOriginal(output.diagnostics.length === 0 && output.proposals.length === 1 && award !== undefined &&
    date === award.effectiveAt && c.eventId === `ssa-medicare:${award.claimId}` && award.recipientPersonId === c.personId);
  const quoted = award.quotedAward;
  requireOriginal(s.withholding.awardId === quoted.awardId && s.withholding.workerRecordId === quoted.workerRecordPersonId &&
    s.withholding.entitlementId === quoted.entitlementId && quoted.benefitKind !== "pension");
  const identity = { householdId: c.householdId, recipientId: c.personId, workerRecordId: quoted.workerRecordPersonId,
    awardId: quoted.awardId, entitlementId: quoted.entitlementId, paymentId: award.claimId, rightClaimId: claimId(award.claimId),
    rightRecognitionId: `ssa-recognition:${award.claimId}`, paymentAt: c.eventAt };
  const payable: SsaPayableEvidence = { ...identity, kind: "coordinated_ssa_payable", benefitKind: quoted.benefitKind,
    eligibility: "eligible", grossPayable: award.grossAmount, source: s.payableSource,
    taxWithholding: { status: "verified_zero", payable: identity, amount: s.withholding.amount, source: s.withholding.source } };
  const c2: MedicareCoordinationRequest = { premiums: m.premiums, inventories: m.inventories,
    irmaa: m.irmaa, deductionTerms: m.deductionTerms, banks: [], awards: [quoted] };
  const composed = composeMedicareObligations(c2);
  requireOriginal(m.instructions.length === composed.obligations.length &&
    m.deductionTerms.length === composed.obligations.length);
  const deductions = composed.obligations.map((row): SsaMedicarePaymentFacts["deductions"][number] => {
    const instructions = m.instructions.filter(item => item.part === row.part);
    requireOriginal(instructions.length === 1);
    const instruction = instructions[0]!;
    const premiumScope = { evidenceId: instruction.premiumSource.scopeId, householdId: row.householdId,
      beneficiaryId: row.personId, part: row.part, coverageId: row.coverageId, providerId: row.recipientId,
      periodStart: row.period.start, periodEndExclusive: row.period.endExclusive };
    const premium = { ...premiumScope, status: "complete" as const, base: row.memberBase, irmaa: row.surcharge, source: instruction.premiumSource };
    return { draft: { id: settlementId(`medicare-settlement:${row.claimId}`), settledAt: c.eventAt },
      terms: { authorizationId: instruction.authorizationSource.scopeId, receiptId: `medicare-receipt:${row.claimId}`,
        traceId: premium.evidenceId, route: "ssa_payable_deduction", payable: identity, premium, premiumScope,
        obligationId: claimId(row.claimId), obligationRecognitionId: `medicare-recognition:${row.claimId}`,
        amount: row.memberObligation, partialDeduction: "forbidden", source: instruction.authorizationSource } };
  });
  const { publisherId, sourceId } = s.bank;
  const bankRoute = () => qualifyHouseholdBankRoute(publisherId, sourceId, c);
  const route = bankRoute();
  const witness = (family: "ssa" | "medicare", publisherId: string, original: Publication<unknown>): HouseholdEconomicWitness => ({
    original: { version: "household-economic-original/v1", family, publisherId, sourceId: original.id,
      revisionId: original.revision, digest: irmaaOriginalDigest(original) },
    source: { kind: "organization", id: original.issuer }, payer: family === "ssa"
      ? { kind: "organization", id: original.issuer } : { kind: "person", id: c.personId },
    beneficiary: c.personId,
  });
  const raw: SsaMedicarePaymentFacts = { a1, award, c2, payable, deductions, bankCashBefore: input.bankCashBefore,
    rightSettlementId: `ssa-settlement:${award.claimId}`,
    bank: { classification: "BANK", accountId: c.bankAccountId, householdId: c.householdId, personId: c.personId },
    originalSources: { mode: input.mode, dataCutoff: c.dataCutoff, ssa: s.award, irmaa: m.surchargeOriginals },
    nativeHousehold: { version: "native-household-posting/v1", transactionId: accountingTransactionId(c.eventId),
      family: "ssa", cashRole: "bank", context: c, route, originals: [
        witness("ssa", input.ssaPublisherId, ssa.selected), witness("medicare", input.medicarePublisherId, medicare.selected),
      ] },
  };
  let checkDomainSources: (() => void) | undefined;
  const payment = qualifyRawPayment(raw, householdId, personId, dataCutoff, input, observation,
    retainSourceCheck === undefined ? undefined : check => { checkDomainSources = check; });
  if (observation !== undefined && (observation.asOf !== c.asOf || observation.dataCutoff !== c.dataCutoff)) {
    requireOriginal(observation.dataCutoff >= c.dataCutoff && observation.asOf >= c.asOf);
    const observed = { ...c, asOf: observation.asOf, dataCutoff: observation.dataCutoff };
    const currentSsa = readCurrent(ssaReaders.get(input.ssaPublisherId), observed);
    const currentMedicare = readCurrent(medicareReaders.get(input.medicarePublisherId), observed);
    requireOriginal(same(currentSsa.selected, ssa.selected) && same(currentMedicare.selected, medicare.selected) &&
      same(qualifyHouseholdBankRoute(s.bank.publisherId, s.bank.sourceId, observed), route));
    currentSsa.unchanged(); currentMedicare.unchanged();
  }
  ssa.unchanged(); medicare.unchanged();
  requireOriginal(same(bankRoute(), route));
  // Keep only fresh read functions and commitments for an unchanged live
  // run boundary. Later-cutoff admission always rebuilds both originals.
  if (checkDomainSources !== undefined &&
      (observation === undefined || observation.asOf === asOf && observation.dataCutoff === dataCutoff)) {
    const checkSsa = ssa.unchanged, checkMedicare = medicare.unchanged;
    const checkDomain = checkDomainSources;
    retainSourceCheck?.(() => {
      checkDomain();
      checkSsa(); checkMedicare();
      requireOriginal(same(bankRoute(), route));
    });
  }
  return { payment, raw };
}
