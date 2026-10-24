import type { HouseholdForecastPoint, PersonalHouseholdForecastReadModel } from "./householdProjection.js";
import { restorePortableHouseholdReplayArtifact, type PortableHouseholdReplayArtifact, type ReplayRestoreObserver } from "../simulation/r3/replayArtifact.js";
import { replayHouseholdForecastWindow, householdReplayCheckpointSelection } from "../simulation/householdExecution.js";
import { instant } from "../time/index.js";
import { Currency, Money, decimal, RoundingPolicy } from "../values/index.js";
import { createForecastDiagnosticEquality, createForecastDiagnosticTransport, validateForecastCatalogTable, type ForecastCatalogTable } from "./forecastDiagnosticTransport.js";

/** Immutable proof transport; financial restoration stays application-owned. */
export type HouseholdEvidenceProof = PortableHouseholdReplayArtifact;
export type { ReplayRestoreMeasurement } from "../simulation/r3/replayArtifact.js";
export type { HouseholdReplayVerificationCounts } from "../simulation/householdExecution.js";
export type HouseholdEvidencePhase = Parameters<NonNullable<import("../simulation/r3/replayArtifact.js").ReplayRestoreObserver["phase"]>>[0]
  | "catalog_validation_started" | "catalog_validated" | "qualification_started" | "qualification_validated"
  | import("../simulation/householdExecution.js").HouseholdReplayPhase | "replay_cached";
export interface HouseholdEvidenceObserver extends ReplayRestoreObserver {
  readonly phase?: (phase: HouseholdEvidencePhase, counts?: import("../simulation/householdExecution.js").HouseholdReplayVerificationCounts) => void;
}
function evidencePhase(observer: HouseholdEvidenceObserver | undefined, phase: HouseholdEvidencePhase): void {
  try { observer?.phase?.(phase); } catch { /* Observation never changes source validation. */ }
}
export interface HouseholdEvidenceMeasurements {
  readonly restore?: import("../simulation/r3/replayArtifact.js").ReplayRestoreMeasurement;
  readonly startIndex: number;
  readonly selectedMonths: number;
  readonly checkpointCount: number;
  readonly retainedCheckpointStates: number;
  readonly selectedCheckpointIndex: number;
  readonly replayPrefixMonths: number;
  readonly restoreAndSourceValidationMs?: number;
  readonly replayAndProjectionMs?: number;
  readonly workerHeapAfterBytes?: number;
}
export interface HouseholdEvidenceSelection {
  readonly operation: "monthly_evidence" | "mortgage_evidence";
  readonly startIndex: number;
  readonly liabilityId: string;
}

type EvidenceBasis = ReturnType<typeof restorePortableHouseholdReplayArtifact>;
type EvidenceReplay = ReturnType<typeof replayHouseholdForecastWindow>;
type EvidenceWindow = { readonly periods: EvidenceReplay["periods"]; readonly closingLiabilities: EvidenceReplay["state"]["liabilities"] };
// At most 24 detailed periods per verified source. Keep only the closing loan
// balances, not the replay's full closing state or identity/posting archives.
// Readers restore/check the exact portable wire before looking up this cache.
const evidenceWindows = new WeakMap<EvidenceBasis, Map<string, EvidenceWindow>>();
const evidenceCatalogs = new WeakMap<EvidenceBasis, ReadonlySet<string>>();
function evidenceWindow(basis: EvidenceBasis, start: string, end: string, observation?: HouseholdEvidenceObserver): EvidenceWindow {
  const selected = basis.periods.filter(period => period.period.start >= start && period.period.end <= end);
  if (!selected.length || selected.length > 12 || selected[0]!.period.start !== start || selected.at(-1)!.period.end !== end)
    throw new Error("Evidence requires one to twelve aligned source periods");
  const key = `${start}:${end}`;
  const cache = evidenceWindows.get(basis) ?? new Map<string, EvidenceWindow>();
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); evidencePhase(observation, "replay_cached"); return cached; }
  const replay = replayHouseholdForecastWindow(basis, { start: instant(start), end: instant(end) }, undefined,
    (phase, counts) => { try { observation?.phase?.(phase, counts); } catch { /* Observation only. */ } });
  const boundedReplay = Object.freeze({ periods: replay.periods, closingLiabilities: replay.state.liabilities });
  if (cache.size === 2) cache.delete(cache.keys().next().value!);
  cache.set(key, boundedReplay);
  evidenceWindows.set(basis, cache);
  return boundedReplay;
}

/** Monthly and mortgage readers share only already verified original detail. */
export function householdEvidenceMonth(basis: EvidenceBasis, start: string, end: string, observation?: HouseholdEvidenceObserver): EvidenceReplay["periods"] {
  for (const boundedReplay of evidenceWindows.get(basis)?.values() ?? []) {
    const period = boundedReplay.periods.find(period => period.period.start === start && period.period.end === end);
    if (period) { evidencePhase(observation, "replay_cached"); return Object.freeze([period]); }
  }
  return evidenceWindow(basis, start, end, observation).periods;
}

export function householdEvidenceProof(points: readonly HouseholdForecastPoint[]): HouseholdEvidenceProof | undefined {
  return (points[0]?.traceRefs.find(ref => ref.replayArtifact !== undefined)?.replayArtifact as { basis?: HouseholdEvidenceProof } | undefined)?.basis;
}

export function householdEvidenceSelectionMeasurements(proof: HouseholdEvidenceProof, selection: HouseholdEvidenceSelection, selectedMonths: number) {
  const basis = restorePortableHouseholdReplayArtifact(proof);
  const start = basis.periods[selection.startIndex]?.period.start;
  if (!start || selectedMonths < 1 || selectedMonths > 12) throw new Error("Unavailable evidence selection");
  return Object.freeze({ startIndex: selection.startIndex, selectedMonths, ...householdReplayCheckpointSelection(basis, start) });
}

/** Explicit engineering-validation seam: transport a v3 proof cold, then restore
 * the identical object warm. It never runs another full-horizon forecast and
 * never returns/logs catalogs, personal facts or checkpoint state. */
export function measureHouseholdCheckpointRestoration(proof: HouseholdEvidenceProof, now: () => number): {
  readonly cold: import("../simulation/r3/replayArtifact.js").ReplayRestoreMeasurement;
  readonly warm: import("../simulation/r3/replayArtifact.js").ReplayRestoreMeasurement;
  readonly cloneMs: number;
} {
  const started = now();
  const transported = structuredClone(proof);
  const cloneMs = now() - started;
  const measurements: import("../simulation/r3/replayArtifact.js").ReplayRestoreMeasurement[] = [];
  const observer = { now, includeCheckpointBytes: true, record: (measurement: import("../simulation/r3/replayArtifact.js").ReplayRestoreMeasurement) => { measurements.push(measurement); } };
  restorePortableHouseholdReplayArtifact(transported, observer);
  restorePortableHouseholdReplayArtifact(transported, observer);
  if (measurements[0]?.cache !== "cold" || measurements[1]?.cache !== "warm") throw new Error("Independent cold/warm restore measurement unavailable");
  return Object.freeze({ cold: measurements[0], warm: measurements[1], cloneMs });
}

/** Strip repeated attachments without restoring financial state on the UI thread. */
export function boundedEvidencePoints(source: PersonalHouseholdForecastReadModel, selection: HouseholdEvidenceSelection) {
  if (source.status === "unavailable" || !Number.isSafeInteger(selection.startIndex) || selection.startIndex < 0) throw new Error("Unavailable evidence");
  const points = source.points.slice(selection.startIndex, selection.startIndex + (selection.operation === "monthly_evidence" ? 1 : 12));
  if (!points.length) throw new Error("Unavailable period");
  const basis = householdEvidenceProof(points);
  if (!basis) throw new Error("Unavailable proof");
  return { basis, points: points.map(point => ({ ...point, traceRefs: point.traceRefs.map(ref => {
    if (ref.replayArtifact === undefined) return ref;
    const { basis: attached, ...address } = ref.replayArtifact as { basis: HouseholdEvidenceProof; start: string; end: string };
    if (!attached || attached !== basis && (attached.version !== basis.version || attached.integrity !== basis.integrity || attached.encoded !== basis.encoded)) throw new Error("Mismatched proof");
    return { ...ref, replayArtifact: address };
  }) })) };
}

/** Authenticate checkpoints and exact original indices before reattaching proof.
 * Call in the worker; application readers retain ownership of financial replay. */
export function restoreHouseholdEvidencePoints(basis: HouseholdEvidenceProof, selection: HouseholdEvidenceSelection,
  points: readonly HouseholdForecastPoint[], fingerprint: string, catalogs?: ForecastCatalogTable,
  observation?: HouseholdEvidenceObserver): readonly HouseholdForecastPoint[] {
  if (!Number.isSafeInteger(selection.startIndex) || selection.startIndex < 0 || points.length < 1 ||
    points.length > (selection.operation === "monthly_evidence" ? 1 : 12)) throw new Error("Unavailable evidence window");
  const original = restorePortableHouseholdReplayArtifact(basis, observation);
  const source = { runId: String(original.runMetadata.runId), inputFingerprint: String(original.runMetadata.inputFingerprint) };
  if (catalogs) {
    evidencePhase(observation, "catalog_validation_started");
    validateForecastCatalogTable(catalogs, source);
    const canonicalCatalogs = evidenceCatalogs.get(original) ?? (() => {
      const contents = new Set<string>();
      for (const participant of original.replay.kernel.executable.participants ?? []) {
        if (participant.id !== "tax" || !participant.portableCodec?.startsWith("household-tax/")) continue;
        const inputs = participant.economicInputs as { readonly catalogFingerprint?: unknown };
        if (typeof inputs.catalogFingerprint === "string") contents.add(inputs.catalogFingerprint);
      }
      if (!contents.size) for (const period of original.periods) for (const output of Object.values(period.outputCapabilities ?? {}))
        for (const item of output.diagnostics) if (item.projectedLaw) contents.add(item.projectedLaw.catalogFingerprint);
      evidenceCatalogs.set(original, contents);
      return contents;
    })();
    if (catalogs.entries.some(entry => !canonicalCatalogs.has(entry.content)))
      throw new Error("Mismatched canonical catalog content");
    evidencePhase(observation, "catalog_validated");
  }
  const transport = createForecastDiagnosticTransport(source, catalogs?.entries.map(entry => entry.content));
  const equalCapabilities = createForecastDiagnosticEquality();
  if (points.some((point, index) => original.periods[selection.startIndex + index]?.period.start !== point.periodStart ||
    original.periods[selection.startIndex + index]?.period.end !== point.periodEnd)) throw new Error("Mismatched period index");
  evidencePhase(observation, "qualification_started");
  points.forEach((point, index) => {
    const canonical = original.periods[selection.startIndex + index]!.outputCapabilities;
    if (catalogs && !equalCapabilities(canonical === undefined ? null : transport.capabilities(canonical), point.outputCapabilities ?? null))
      throw new Error("Mismatched output capability qualification");
    if (!catalogs && Object.values(point.outputCapabilities ?? {}).some(output => output.diagnostics.some((item: import("./forecastDiagnosticTransport.js").ForecastTaxDiagnostic) => item.projectedLaw !== undefined)))
      throw new Error("Missing source catalog");
  });
  evidencePhase(observation, "qualification_validated");
  const restored = points.map(point => ({ ...point, traceRefs: point.traceRefs.map(ref => {
    if (ref.replayArtifact === undefined) return ref;
    const address = ref.replayArtifact as { start: string; end: string };
    if (address.start !== point.periodStart || address.end !== point.periodEnd ||
      ref.traceId !== `household:replay:${original.runMetadata.inputFingerprint}:${address.start}:${address.end}`) throw new Error("Mismatched source identity");
    return { ...ref, replayArtifact: { ...address, basis } };
  }) }));
  if (restored[0]!.traceRefs.find(ref => ref.replayArtifact !== undefined)?.traceId !== fingerprint) throw new Error("Mismatched forecast identity");
  return restored;
}

export interface MortgageMonth {
  readonly start: string;
  readonly end: string;
  readonly currency: string;
  readonly openingPrincipal: string;
  readonly endingPrincipal: string;
  readonly interestPaid: string;
  readonly scheduledPrincipalPaid: string;
  readonly extraPrincipalPaid: string;
  readonly scheduledDue: string;
  readonly interestAccrued: string;
  readonly funding: string;
  readonly extraFunding: string;
  readonly sourceIds: readonly string[];
  readonly accountIds: readonly string[];
  readonly reconciled: boolean;
}
export interface MortgageWindow {
  readonly fingerprint: string;
  readonly loanId: string;
  readonly liabilityId: string;
  readonly start: string;
  readonly end: string;
  readonly forecastStart: string;
  readonly rows: readonly MortgageMonth[];
  readonly status: "current" | "incomplete";
}

export interface LiabilityBalanceWindow {
  readonly status: "current" | "incomplete";
  readonly opening: { readonly at: string; readonly amount: string; readonly currency: string; readonly supported: boolean };
  readonly rows: readonly { readonly start: string; readonly end: string; readonly amount: string; readonly currency: string; readonly supported: boolean }[];
}

/** Reconciled household liabilities, never a sum reconstructed from mortgage bars. */
export function inspectLiabilityBalanceWindow(forecast: PersonalHouseholdForecastReadModel, startIndex: number): LiabilityBalanceWindow {
  if (forecast.status === "unavailable") throw new Error(forecast.message);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex >= forecast.points.length) throw new Error("Select a supported liability window.");
  const points = forecast.points.slice(startIndex, startIndex + 12);
  const opening = startIndex === 0 ? forecast.openingSnapshot : forecast.points[startIndex - 1]!;
  const currency = opening.totalLiabilities.currency;
  const openingSupported = opening.outputCapabilities?.totalLiabilities?.status !== "incomplete" &&
    (startIndex === 0 || forecast.points[startIndex - 1]!.periodEnd === points[0]!.periodStart);
  const rows = points.map((point, index) => ({ start: point.periodStart, end: point.periodEnd,
    amount: point.totalLiabilities.amount, currency: point.totalLiabilities.currency,
    supported: openingSupported &&
      point.outputCapabilities?.totalLiabilities?.status !== "incomplete" && point.totalLiabilities.currency === currency &&
      (index === 0 || points[index - 1]!.periodEnd === point.periodStart) }));
  return { opening: { at: points[0]!.periodStart, ...opening.totalLiabilities, supported: openingSupported }, rows,
    status: forecast.status === "incomplete" || rows.some(row => !row.supported) ? "incomplete" : "current" };
}

/** Percent of this viewport's maximum; money stays exact outside SVG/CSS coordinates. */
export function liabilityBalanceCoordinates(rows: LiabilityBalanceWindow["rows"]) {
  const maximum = rows.reduce((max, row) => row.supported && decimal(row.amount).compare(max) > 0 ? decimal(row.amount) : max, decimal("0"));
  return rows.map(row => row.supported && maximum.isPositive()
    ? Number(decimal(row.amount).dividedBy(maximum, new RoundingPolicy(8, "half_even")).times(decimal("100")).toString()) : 0);
}

/** Reads one explicit viewport. All financial amounts come from committed replay. */
export function inspectMortgageWindow(points: readonly HouseholdForecastPoint[], liabilityId: string,
  observation?: HouseholdEvidenceObserver): MortgageWindow {
  if (points.length < 1 || points.length > 12) throw new Error("Select between one and twelve modeled months.");
  const addresses = points.map((point, index) => {
    const ref = point.traceRefs.find(value => value.replayArtifact !== undefined);
    const address = ref?.replayArtifact as { basis: PortableHouseholdReplayArtifact; start: string; end: string } | undefined;
    if (!address || address.start !== point.periodStart || address.end !== point.periodEnd ||
      index > 0 && points[index - 1]!.periodEnd !== point.periodStart) throw new Error("Mortgage evidence has a missing or mismatched period. Update the forecast.");
    return { address, traceId: ref!.traceId };
  });
  const artifact = addresses[0]!.address.basis;
  if (addresses.some(({ address }) => address.basis.version !== artifact.version || address.basis.encoded !== artifact.encoded || address.basis.integrity !== artifact.integrity))
    throw new Error("Mortgage evidence belongs to different forecast sources.");
  const basis = restorePortableHouseholdReplayArtifact(artifact, observation);
  const fingerprint = String(basis.runMetadata.inputFingerprint);
  if (addresses.some(({ address, traceId }) => traceId !== `household:replay:${fingerprint}:${address.start}:${address.end}`))
    throw new Error("Mortgage evidence identity does not match this forecast.");
  const first = points[0]!, last = points.at(-1)!;
  const firstIndex = basis.periods.findIndex(period => period.period.start === first.periodStart);
  if (firstIndex < 0 || artifact.version !== "household-replay/v3" && firstIndex + points.length > 12)
    throw new Error("Bounded mortgage evidence is unavailable for this older forecast. Update the forecast.");
  const loan = basis.replay.kernel.executable.liabilityInput?.loans.find(value => String(value.principalLiabilityId) === liabilityId);
  if (!loan || loan.debtFamily !== undefined && loan.debtFamily !== "mortgage") throw new Error("Amortization is unavailable for this debt source.");
  const currency = Currency.of(basis.runMetadata.baseCurrency);
  if (points.some(point => point.cash.currency !== currency.code)) throw new Error("Mortgage periods use incompatible currencies.");
  const replay = evidenceWindow(basis, first.periodStart, last.periodEnd, observation);
  if (replay.periods.length !== points.length) throw new Error("Mortgage replay did not cover the selected window.");
  let previous = firstIndex === 0 ? basis.replay.kernel.executable.reconciledOpeningState.liabilities[loan.principalLiabilityId]?.balance
    : basis.periods.slice(0, firstIndex).flatMap(period => period.debtBalances?.filter(value => value.loanId === loan.id) ?? []).at(-1)?.endingPrincipal;
  const rows = replay.periods.map((period, index): MortgageMonth => {
    const zero = () => Money.zero(currency);
    const occurrences = period.liability?.liabilities.filter(value => value.loanId === loan.id) ?? [];
    const principalMovement = period.transactions.some(tx => tx.legs.some(leg => leg.type === "liability" && leg.entityId === loan.principalLiabilityId));
    // Occurrences can start after an extra-principal operation in this month.
    // The period boundary, rather than the first scheduled occurrence, is the
    // opening authority. The verified summary supplies the closing boundary.
    const opening = previous;
    const ending = basis.periods[firstIndex + index]?.debtBalances?.filter(value => value.loanId === loan.id).at(-1)?.endingPrincipal
      ?? (!principalMovement ? previous : index === replay.periods.length - 1 ? replay.closingLiabilities[loan.principalLiabilityId]?.balance : undefined);
    if (!opening || !ending) throw new Error("This loan has incomplete principal coverage in the selected window.");
    let interest = zero(), scheduled = zero(), extra = zero();
    const sourceIds: string[] = [], accounts = new Set<string>(), seen = new Set<string>();
    for (const tx of period.transactions) {
      const category = tx.type === "mortgage_interest_settlement" ? "interest" : tx.type === "mortgage_principal_payment" ? "scheduled" : tx.type === "mortgage_extra_principal" ? "extra" : undefined;
      if (!category || !tx.legs.some(leg => leg.type === "liability" && leg.entityId === (category === "interest" ? loan.interestPayableLiabilityId : loan.principalLiabilityId))) continue;
      if (seen.has(tx.id)) throw new Error("Mortgage evidence contains duplicate postings.");
      seen.add(tx.id);
      const target = category === "interest" ? loan.interestPayableLiabilityId : loan.principalLiabilityId;
      const liability = tx.legs.filter(leg => leg.type === "liability" && leg.entityId === target && leg.posting === "debit");
      const cash = tx.legs.filter(leg => leg.type === "cash" && leg.posting === "credit");
      const paid = liability.reduce((sum, leg) => sum.plus(leg.amount), zero());
      const funded = cash.reduce((sum, leg) => sum.plus(leg.amount), zero());
      if (!paid.equals(funded) || paid.isNegative() || liability.length + cash.length !== tx.legs.length)
        throw new Error("Mortgage settlement legs cannot be reconciled to funded cash.");
      if (category === "interest") interest = interest.plus(paid);
      else if (category === "scheduled") scheduled = scheduled.plus(paid);
      else extra = extra.plus(paid);
      tx.legs.forEach((leg, legIndex) => { sourceIds.push(`${tx.id}:leg:${legIndex}`); if (leg.type === "cash") accounts.add(String(leg.accountId)); });
    }
    const point = points[index]!;
    const sourceBalance = point.debtBalances.filter(value => value.loanId === loan.id).at(-1)?.principal;
    const principalReconciled = opening.minus(scheduled).minus(extra).equals(ending) &&
      (sourceBalance ? sourceBalance.currency === currency.code && Money.parse(sourceBalance.amount, currency).equals(ending) : occurrences.length === 0 && !principalMovement);
    const scheduledSource = occurrences.reduce((sum, value) => sum.plus(value.scheduledPrincipalPaid), zero());
    const extraSource = occurrences.reduce((sum, value) => sum.plus(value.extraPrincipalPaid), zero());
    const reconciled = principalReconciled && scheduled.equals(scheduledSource) && extra.equals(extraSource);
    previous = ending;
    return { start: point.periodStart, end: point.periodEnd, currency: currency.code,
      openingPrincipal: opening.amount.toString(), endingPrincipal: ending.amount.toString(), interestPaid: interest.amount.toString(),
      scheduledPrincipalPaid: scheduled.amount.toString(), extraPrincipalPaid: extra.amount.toString(),
      scheduledDue: occurrences.reduce((sum, value) => sum.plus(value.scheduledPayment), zero()).amount.toString(),
      interestAccrued: occurrences.reduce((sum, value) => sum.plus(value.currentInterest), zero()).amount.toString(),
      funding: occurrences.length ? [...new Set(occurrences.map(value => value.scheduledFundingStatus))].join(", ") : ending.isZero() ? "No payment scheduled · paid off" : "No payment scheduled",
      extraFunding: extra.isPositive() ? "Paid · posted cash verified" : [...new Set(occurrences.flatMap(value => value.extraFundingStatus ? [value.extraFundingStatus] : []))].join(", ") || "No extra cash paid",
      sourceIds, accountIds: [...accounts].sort(), reconciled };
  });
  return { fingerprint, loanId: String(loan.id), liabilityId, start: first.periodStart, end: last.periodEnd,
    forecastStart: basis.replay.runContext.simulationStart, rows,
    status: rows.every(row => row.reconciled) ? "current" : "incomplete" };
}

/** Exact totals stop at the selected month and never bridge a gap or new loan. */
export function mortgageWindowTotals(mortgageWindow: MortgageWindow, selectedStart: string) {
  const index = mortgageWindow.rows.findIndex(row => row.start === selectedStart);
  if (index < 0) return undefined;
  const rows = mortgageWindow.rows.slice(0, index + 1), currency = Currency.of(rows[0]!.currency);
  if (rows.some((row, i) => !row.reconciled || row.currency !== currency.code || i > 0 &&
    (rows[i - 1]!.end !== row.start || rows[i - 1]!.endingPrincipal !== row.openingPrincipal))) return undefined;
  return { interest: rows.reduce((sum, row) => sum.plus(Money.parse(row.interestPaid, currency)), Money.zero(currency)).amount.toString(),
    principal: rows.reduce((sum, row) => sum.plus(Money.parse(row.scheduledPrincipalPaid, currency)).plus(Money.parse(row.extraPrincipalPaid, currency)), Money.zero(currency)).amount.toString(),
    start: mortgageWindow.start, end: rows.at(-1)!.end, fromForecastStart: mortgageWindow.start === mortgageWindow.forecastStart };
}

/** Disposable chart coordinates only. Exact strings remain the financial readout. */
export function mortgageBarCoordinates(rows: readonly MortgageMonth[]) {
  const totals = rows.map(row => decimal(row.interestPaid).plus(decimal(row.scheduledPrincipalPaid)).plus(decimal(row.extraPrincipalPaid)));
  const scale = totals.reduce((max, value) => value.compare(max) > 0 ? value : max, decimal("0"));
  return rows.map(row => [row.interestPaid, row.scheduledPrincipalPaid, row.extraPrincipalPaid].map(value =>
    scale.isPositive() ? Number(decimal(value).dividedBy(scale, new RoundingPolicy(8, "half_even")).times(decimal("100")).toString()) : 0));
}

/** Instance belongs to one current result/model. UI drops it on pending or stale. */
export class MortgageWindowCache {
  readonly #windows = new Map<string, MortgageWindow>();
  constructor(readonly forecast: PersonalHouseholdForecastReadModel) {}
  get(liabilityId: string, startIndex: number): MortgageWindow {
    if (!Number.isSafeInteger(startIndex) || startIndex < 0) throw new Error("Select a supported mortgage window.");
    if (this.forecast.status === "unavailable") throw new Error(this.forecast.message);
    const points = this.forecast.points.slice(startIndex, startIndex + 12);
    const key = `${liabilityId}:${points[0]?.periodStart}:${points.at(-1)?.periodEnd}`;
    const cached = this.#windows.get(key);
    if (cached) return cached;
    const result = inspectMortgageWindow(points, liabilityId);
    if (this.#windows.size >= 4) this.#windows.delete(this.#windows.keys().next().value!);
    this.#windows.set(key, result);
    return result;
  }
}
