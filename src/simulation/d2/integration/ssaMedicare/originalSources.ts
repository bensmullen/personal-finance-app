import { ValidationError } from "../../../../diagnostics/index.js";
import { civilDate, instant, type Instant } from "../../../../time/index.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { bindSsaOriginals, type SsaOriginalPin, type SsaOriginalProvider } from "../../retirement/benefits/ssaOriginalBinding/index.js";
import { irmaaOriginalDigest, proposeOriginalIrmaa, type IrmaaOriginals, type Original,
  type OriginalQuery, type SourcedIrmaaCandidate } from "../../health/medicare/originalBinding/index.js";
import type { ConfirmedSsaMedicarePayment } from "./index.js";

/** Change commitments only. Authentication belongs to registered source owners. */
export interface SsaMedicareOriginalSources {
  readonly mode: "ssa-medicare-originals/v1";
  readonly dataCutoff: Instant;
  readonly ssa: SsaOriginalPin;
  readonly irmaa: readonly { readonly query: OriginalQuery; readonly candidateDigest: string }[];
}
export interface SsaMedicareOriginalAdapter {
  readonly ssa: readonly SsaOriginalProvider[];
  readonly irmaa: IrmaaOriginals;
}
let adapter: SsaMedicareOriginalAdapter | undefined;
/** Composition-root only, once per process. No default or portable provider. */
export function registerSsaMedicareOriginalSources(value: SsaMedicareOriginalAdapter): void {
  if (adapter) throw new Error("SSA_MEDICARE_ORIGINAL_ADAPTER_DUPLICATE");
  adapter = Object.freeze({ ssa: Object.freeze(value.ssa.map(p => Object.freeze({
    publisherId: p.publisherId, readOriginals: p.readOriginals.bind(p),
  }))), irmaa: Object.freeze({ rules: value.irmaa.rules.bind(value.irmaa),
    enrollments: value.irmaa.enrollments.bind(value.irmaa), returns: value.irmaa.returns.bind(value.irmaa),
    determinations: value.irmaa.determinations.bind(value.irmaa), lifeEvents: value.irmaa.lifeEvents.bind(value.irmaa) }) });
}
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
function need(ok: boolean): asserts ok {
  if (!ok) throw new ValidationError({ severity: "error", code: "SSA_MEDICARE_ORIGINAL_NOT_ADMITTED",
    entityType: "ssa_medicare_payment", message: "Independent original inventories must match the exact consumed A1/C2 event and cutoff" });
}
/** Freeze every independent read, then re-read after BOTH source and financial
 * computations. Never cache source admission across events or replay imports. */
export function reviewSsaMedicareOriginals(q: ConfirmedSsaMedicarePayment, cutoff?: string): () => void {
  const pins = q.originalSources;
  if (pins === undefined) return () => {};
  need(pins.mode === "ssa-medicare-originals/v1" && adapter !== undefined);
  instant(pins.dataCutoff);
  const sources = adapter!;
  need(cutoff === undefined || pins.dataCutoff === cutoff);
  need(pins.dataCutoff <= q.payable.paymentAt && pins.ssa.dataCutoff === pins.dataCutoff.slice(0, 10));
  const reads = new Map<string, { read: () => unknown; digest: string }>();
  const capture = <T>(key: string, read: () => T): T => {
    const value = immutableConfiguration(read()), digest = irmaaOriginalDigest(value);
    const prior = reads.get(key);
    need(prior === undefined || prior.digest === digest);
    reads.set(key, { read, digest });
    return value;
  };
  let recipient: unknown;
  const providers = sources.ssa.map(p => ({ publisherId: p.publisherId, readOriginals: (query: Parameters<SsaOriginalProvider["readOriginals"]>[0]) => {
    const h = capture(`ssa:${canonicalSerialize(query)}`, () => p.readOriginals(query));
    const original = h?.originals.find(o => o.originalId === pins.ssa.originalId);
    if (original) recipient = original.recipient;
    return h;
  } }));
  const month = q.c2.premiums.period;
  const knownAt = civilDate(q.payable.paymentAt.slice(0, 10));
  const bound = bindSsaOriginals({ householdId: q.payable.householdId, knownAt,
    dataCutoff: civilDate(pins.dataCutoff.slice(0, 10)), horizon: month, pins: [pins.ssa] }, providers);
  need(q.a1.recipients.length === 1 && same(q.a1.recipients[0], recipient)
    && same(q.a1.horizon, month) && q.a1.knownAt <= pins.ssa.dataCutoff
    && bound.coverage.length === 1 && bound.coverage[0]!.coverage === "conditional"
    && bound.installments.length === 1);
  const installment = bound.installments[0]!;
  need(installment.claimId === q.award.claimId && installment.recipientPersonId === q.payable.recipientId
    && installment.effectiveAt === q.award.effectiveAt && installment.grossAmount.equals(q.payable.grossPayable));
  // Only independently used originals may supply the evaluator's raw inputs.
  // Reject same-dollar substitutions of filing status, MAGI or tier.
  const docs = new Map<string, Original<unknown>>();
  const read = <T>(kind: string, query: OriginalQuery, fetch: () => T): T => {
    const value = capture(`${kind}:${canonicalSerialize(query)}`, fetch);
    const inv = value as { originals?: readonly Original<unknown>[] } | undefined;
    for (const doc of inv?.originals ?? []) docs.set(irmaaOriginalDigest(doc), doc);
    return value;
  };
  const originals: IrmaaOriginals = {
    rules: query => read("rules", query, () => sources.irmaa.rules(query)),
    enrollments: query => read("enrollments", query, () => sources.irmaa.enrollments(query)),
    returns: (query, year) => read(`returns:${year}`, query, () => sources.irmaa.returns(query, year)),
    determinations: query => read("determinations", query, () => sources.irmaa.determinations(query)),
    lifeEvents: (query, claim) => read(`life:${claim}`, query, () => sources.irmaa.lifeEvents(query, claim)),
  };
  need(pins.irmaa.length === 2 && new Set(pins.irmaa.map(p => p.query.part)).size === 2);
  const result = proposeOriginalIrmaa({ events: pins.irmaa.map(p => p.query), originals, deaths: q.c2.irmaa.deaths ?? [] });
  need(result.diagnostics.length === 0 && result.candidates.length === 2);
  const consumed = <T>(candidate: SourcedIrmaaCandidate, field: string): T[] => candidate.sources.flatMap(p => {
    const value = docs.get(p.digest)?.value as Record<string, T> | undefined;
    return value && field in value ? [value[field]!] : [];
  });
  for (const pin of pins.irmaa) {
    const event = pin.query;
    need(event.householdId === q.payable.householdId && event.personId === q.payable.recipientId
      && event.eventAt === q.payable.paymentAt && event.knownAt === pins.dataCutoff && same(event.period, month));
    const c = result.candidates.find(c => c.part === event.part)!;
    need(Boolean(c) && irmaaOriginalDigest(c) === pin.candidateDigest);
    const raw = q.c2.irmaa, enrollments = raw.enrollments.filter(e => e.part === c.part);
    need(raw.taxYear === c.taxYear && same(enrollments, consumed(c, "enrollment")) && same(raw.rules, consumed(c, "rule"))
      && same(raw.histories, consumed(c, "income"))
      && same(raw.overrides ?? [], consumed<Record<string, unknown>>(c, "override").map(o =>
        ({ ...o, qualification: "verified_legal_determination" }))));
  }
  return () => {
    need(adapter === sources);
    for (const record of reads.values()) need(irmaaOriginalDigest(record.read()) === record.digest);
  };
}
