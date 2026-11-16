import { describe, expect, it } from "vitest";
import { civilDate, instant } from "../../../../../../src/time/index.js";
import { Currency, money } from "../../../../../../src/values/index.js";
import { fsaScopeId, type FsaIdentity, type FsaReceipt, type FsaRequest, type FsaSource } from "../../../../../../src/simulation/d2/health/fsa/index.js";
import { fsaYearChainFingerprint } from "../../../../../../src/simulation/d2/health/fsa/yearChain/index.js";
import { registerFsaYearChainOriginalProvider, type FsaYearOriginal, type FsaYearOriginalInventory,
  type FsaYearOriginalQuery, type FsaYearOriginalRole, type FsaYearOriginalRoles } from
  "../../../../../../src/simulation/d2/health/fsa/yearChain/originalBinding/index.js";

// Independent synthetic publications with fictional terms. The caller has only a reference and a clock.
const ref = { publisherId: "fixture-catalog", chainId: "test-chain" };
const stamp = (day: string, clock = "00:00:00") => instant(`${day}T${clock}.000Z`);
const context = { runId: "test-run", asOf: stamp("2027-10-01", "23:00:00"), dataCutoff: stamp("2027-10-01", "19:00:00") };
const publishers = { plan: "employer", election: "employer", calendar: "employer", law: "synthetic-law", yearEnd: "employer",
  carryoverLaw: "synthetic-law", termination: "employer", enrollment: "employer", history: "administrator", claims: "administrator",
  paid: "bank", reimbursed: "bank", payroll: "payroll-provider", closeout: "administrator", transfers: "administrator" };
const scope = (year: string): FsaIdentity => ({ personId: "employee", householdId: "home", employerId: "employer", planId: "plan", planYearId: year });
const period = (year: string) => ({ start: civilDate(`${year}-07-01`), endExclusive: civilDate(`${Number(year) + 1}-07-01`) });
const source = (ruleFamily: string, subjectId: string): FsaSource => ({ ruleFamily, subjectId,
  ruleSnapshotId: `synthetic/${ruleFamily}/${subjectId}`, version: "fixture/v1", jurisdiction: "test", projectionStatus: "verified",
  sourcePublication: "independent fixture evidence", start: civilDate("2026-01-01"), endExclusive: civilDate("2030-01-01"),
  asOf: civilDate("2026-01-01"), verifiedThrough: civilDate("2029-12-31") });
const claim = (index: number, incurred: string, submitted: string): FsaReceipt => {
  const proofId = `proof/${index}`;
  return { ...scope("2026"), proofId, receiptId: `receipt/${index}`, memberId: "child", payeeId: "provider",
    expenseType: "qualified_medical_service", incurredAt: civilDate(incurred), submittedAt: civilDate(submitted),
    incurredAmount: money("40.01"), evidence: source("health_fsa_receipt", proofId),
    payment: { status: "paid", paidAt: civilDate(incurred), amount: money("40.01"), paymentRef: `payment/${index}` },
    destination: { kind: "bank_cash", ownerId: "employee", householdId: "home", accountId: "bank",
      evidence: source("health_fsa_destination", "bank") },
    decision: { kind: "eligible", eligibleAmount: money("40.01"), decidedAt: civilDate(submitted), evidence: source("health_fsa_adjudication", proofId) },
    reimbursement: { status: "settled", approvedAmount: money("40.01"), adjudicatedAt: civilDate(submitted),
      settledAt: civilDate(submitted), settlementId: `deposit/${index}`, allocations: [{ planYearId: "2026", amount: money("40.01") }],
      evidence: source("health_fsa_reimbursement", proofId) } };
};

interface Options {
  readonly disposition?: "carryover" | "grace_period" | "forfeiture";
  readonly count?: number;
  readonly cap?: string;
  readonly election?: string;
  readonly terminated?: boolean;
  readonly status?: "denied" | "pending";
}

function inventory(query: FsaYearOriginalQuery, options: Options = {}): FsaYearOriginalInventory {
  const prior = query.year === "prior";
  const year = prior ? "2026" : "2027", who = scope(year), dates = period(year), subject = fsaScopeId(who);
  const observed = stamp(query.asOf.startsWith("2027-07-17") ? "2027-07-17" : "2027-10-01", "17:00:00");
  const original = <R extends FsaYearOriginalRole>(role: R, value: FsaYearOriginalRoles[R],
    effectiveAt = stamp(dates.start)): readonly FsaYearOriginal<R>[] => [{ publisherId: publishers[role],
      scope: who, period: dates, sourceId: `${year}/${role}`, version: "synthetic/v1", revisionId: `${year}/${role}/v1`,
      replaces: null, publishedAt: observed, knownAt: observed, effectiveAt, status: "published",
      originalContent: `synthetic original ${year} ${role} ${"payload ".repeat(200)}`, value }];
  const kind = prior ? options.disposition ?? "carryover" : "forfeiture";
  const cap = { planCap: money("100.09"), legalCap: money(options.cap ?? "80.07") };
  const indexes = Array.from({ length: prior ? options.count ?? 1 : 0 }, (_, i) => i);
  const incurred = kind === "grace_period" ? "2027-07-15" : "2027-05-31";
  const submitted = options.terminated ? "2027-06-15" : observed.startsWith("2027-07") ? "2027-07-16" : "2027-09-30";
  const claims = indexes.map(i => {
    const row = claim(i, incurred, submitted);
    if (options.status === "denied") return { ...row, decision: { kind: "denied" as const, eligibleAmount: money("0"),
      decidedAt: row.submittedAt, evidence: source("health_fsa_adjudication", row.proofId) }, reimbursement: { status: "not_adjudicated" as const } };
    if (options.status === "pending" && row.reimbursement?.status === "settled") return { ...row,
      reimbursement: { ...row.reimbursement, status: "pending" as const, settledAt: null, settlementId: null } };
    return row;
  });
  const bank = (i: number) => ({ proofId: `proof/${i}`, receiptId: `receipt/${i}`, memberId: "child", accountId: "bank",
    ownerId: "employee", householdBank: false, amount: money("40.01") });
  return { version: "fsa-year-original-inventory/v1", query, complete: true, scope: who, period: dates, roles: {
    plan: original("plan", { instrumentFamily: "health_fsa", planEvidence: source("health_fsa_plan", subject),
      planElectionLimit: money("2500"), planEmployerLimit: money("200"), uniformCoverage: "full_election_and_employer",
      allocationPolicy: "prior_first_then_current/incurred_submitted_proof/v1", submitEndExclusive: civilDate(prior ? "2027-10-01" : "2028-10-01") }),
    election: original("election", { annualElection: money(prior ? options.election ?? "1000.30" : "1700.80"), employerContribution: money("0") }),
    law: original("law", { planYearId: year, electionLimit: money(prior ? "1200" : "1750"), employerLimit: money("200"),
      totalLimit: money(prior ? "1400" : "1950"), evidence: source("health_fsa_law", year) }),
    calendar: original("calendar", source("health_fsa_calendar", subject)),
    yearEnd: original("yearEnd", kind === "carryover" ? { kind, ...cap, nextEnrollment: { ...scope("2027"),
      period: period("2027"), enrolled: true, evidence: source("health_fsa_next_enrollment", fsaScopeId(scope("2027"))) } }
      : kind === "grace_period" ? { kind, incurredEndExclusive: civilDate("2027-08-01") } : { kind }),
    carryoverLaw: original("carryoverLaw", kind === "carryover" ? { ...cap, planYearId: year,
      evidence: source("health_fsa_carryover_law", subject) } : null),
    termination: prior && options.terminated ? original("termination", { kind: "terminated", incurredEndExclusive: civilDate("2027-06-01"),
      submitEndExclusive: civilDate("2027-06-20"), disposition: "forfeit_after_runout" }, stamp("2027-06-01"))
      : original("termination", { kind: "none" }),
    enrollment: original("enrollment", { coverage: dates, enrolledAtStart: true, members: ["employee", "child"].map(memberId => ({ memberId,
      coverage: dates, evidence: source("health_fsa_member", `${encodeURIComponent(subject)}/${encodeURIComponent(memberId)}`) })) }),
    history: original("history", { through: civilDate(observed.slice(0, 10)), evidence: source("health_fsa_complete_history", subject) }),
    claims: original("claims", claims),
    paid: original("paid", indexes.map(i => ({ ...bank(i), bankEventId: `debit/proof/${i}`,
      paymentRef: `payment/${i}`, payeeId: "provider", occurredAt: stamp(incurred) }))),
    reimbursed: original("reimbursed", options.status ? [] : indexes.map(i => ({ ...bank(i),
      bankEventId: `credit/proof/${i}`, settlementId: `deposit/${i}`, employerId: "employer", occurredAt: stamp(submitted) }))),
    payroll: original("payroll", []), closeout: original("closeout", null),
    transfers: original("transfers", { proposedTransferId: "transfer-once", competing: [], openingTransfer: null }),
  } };
}

const setup = (options: Options = {}, change?: (record: FsaYearOriginalInventory, read: number) => FsaYearOriginalInventory | undefined) => {
  const reads: FsaYearOriginalQuery[] = [];
  const adapter = registerFsaYearChainOriginalProvider({ publisherId: ref.publisherId, publishers, read: query => {
    reads.push(query);
    if (query.ref.chainId !== ref.chainId) return undefined;
    const record = inventory(query, options);
    return change ? change(record, reads.length) : record;
  } });
  return { adapter, reads };
};
const qualified = (result: ReturnType<ReturnType<typeof setup>["adapter"]["qualify"]>) => {
  expect(result).toMatchObject({ committed: false, postable: false, physicalSettlement: "incomplete", taxCoverage: "incomplete",
    payrollEffectCoverage: "incomplete", reimbursementSettlementCoverage: "incomplete", appliedCarryover: money("0") });
  if (result.kind !== "source_checked_fsa_year_chain") throw new Error(JSON.stringify(result));
  return result;
};
function changeRole<R extends FsaYearOriginalRole>(record: FsaYearOriginalInventory, role: R,
  update: (rows: readonly FsaYearOriginal<R>[]) => readonly FsaYearOriginal<R>[]): FsaYearOriginalInventory {
  return { ...record, roles: { ...record.roles, [role]: update(record.roles[role]) } };
}
function changeValue<R extends FsaYearOriginalRole>(record: FsaYearOriginalInventory, role: R,
  update: (value: FsaYearOriginalRoles[R]) => FsaYearOriginalRoles[R]): FsaYearOriginalInventory {
  return changeRole(record, role, rows => rows.map(row => row.status === "published" ? { ...row, value: update(row.value) } : row));
}

function ownerRequest(record: FsaYearOriginalInventory): FsaRequest {
  const value = <R extends FsaYearOriginalRole>(role: R): FsaYearOriginalRoles[R] => {
    const revision = record.roles[role][0];
    if (revision?.status !== "published") throw new Error(`Missing fixture ${role}`);
    return revision.value;
  };
  const { coverage, members } = value("enrollment");
  return { evaluatedAt: value("history").through, historyThrough: value("history").through,
    historyEvidence: value("history").evidence, receipts: value("claims"), payroll: value("payroll"), priorCarryover: null,
    plan: { ...record.scope, period: record.period, ...value("plan"), ...value("election"), coverage, members,
      law: value("law"), yearEnd: value("yearEnd"), termination: value("termination") } };
}

describe("original FSA year-chain qualification", () => {
  it.each([
    [{}, "80.07", "880.22", "960.29"],
    [{ cap: "0" }, "0", "960.29", "960.29"],
    [{ election: "60.04" }, "20.03", "0", "20.03"],
    [{ disposition: "forfeiture" }, "0", "960.29", "960.29"],
    [{ disposition: "grace_period" }, "0", "960.29", "960.29"],
    [{ terminated: true }, "0", "960.29", "960.29"],
    [{ status: "denied" }, "80.07", "920.23", "1000.30"],
  ] satisfies [Options, string, string, string][])("keeps exact-cent conditional results for %j", (options, carry, forfeit, remaining) => {
    const { adapter, reads } = setup(options);
    const result = qualified(adapter.qualify(ref, context));
    expect(result.coverage).toBe("conditional");
    expect(result.proposal).toMatchObject({ proposalCoverage: "complete", proposedCarryover: money(carry),
      proposedForfeiture: money(forfeit), closingEntitlement: money(remaining), priorGraceAvailable: money("0"),
      provenance: [{ planYearId: "2026", memberId: "child" }] });
    expect(result.proposal.diagnostics.map(d => d.diagnosticCode)).toEqual(["requires_149_authoritative_closeout"]);
    expect(reads.map(read => read.year)).toEqual(["prior", "successor", "prior", "successor"]);
    expect(reads.every(read => read.asOf === context.asOf && read.dataCutoff === context.dataCutoff)).toBe(true);
    expect(Object.isFrozen(result.sources.prior[0])).toBe(true);
  });

  it("preserves open grace availability and pending approval without issuing a closeout", () => {
    const earlier = { ...context, asOf: stamp("2027-07-17", "23:00:00"), dataCutoff: stamp("2027-07-17", "19:00:00") };
    const grace = qualified(setup({ disposition: "grace_period" }).adapter.qualify(ref, earlier));
    expect(grace.proposal).toMatchObject({ proposalCoverage: "incomplete", priorDisposition: "grace_period",
      priorGraceAvailable: money("960.29"), proposedForfeiture: money("0"), closingEntitlement: null });
    const pending = qualified(setup({ status: "pending" }).adapter.qualify(ref, context));
    expect(pending.coverage).toBe("incomplete");
    expect(pending.proposal.eligibility[0]).toMatchObject({ reimbursement: "pending" });
    expect(pending.proposal.diagnostics.map(d => d.diagnosticCode)).toContain("PRIOR_CLOSE_PENDING");
  });

  it("fails closed on missing originals, incomplete inventories, misbound publishers and stale queries", () => {
    expect(setup().adapter.qualify({ ...ref, chainId: "forged" }, context)).toMatchObject({ reason: "ORIGINAL_UNAVAILABLE" });
    expect(setup().adapter.qualify({ ...ref, publisherId: "forged" }, context)).toMatchObject({ reason: "ORIGINAL_INVALID" });
    const changes: ((record: FsaYearOriginalInventory) => FsaYearOriginalInventory)[] = [
      record => ({ ...record, complete: false }), record => changeRole(record, "payroll", () => []),
      record => changeRole(record, "law", rows => rows.map(row => ({ ...row, publisherId: "forged" }))),
      record => changeRole(record, "election", rows => rows.map(row => ({ ...row, scope: { ...row.scope, personId: "other" } }))),
      record => changeRole(record, "plan", rows => rows.map(row => ({ ...row, period: period("2025") }))),
      record => record.query.year === "prior" ? { ...record, query: { ...record.query, dataCutoff: stamp("2027-09-30") } } : record,
    ];
    for (const change of changes) expect(setup({}, change).adapter.qualify(ref, context)).toMatchObject({
      kind: "fsa_year_chain_original_incomplete", coverage: "incomplete", committed: false, postable: false });
  });

  it("separates later knowledge, withdrawal, conflicting revisions and source loss", () => {
    const revokedAt = stamp("2027-10-01", "20:00:00");
    const withdraw = (record: FsaYearOriginalInventory) => changeRole(record, "law", rows => {
      const previous = rows[0]!;
      return [...rows, { ...previous, status: "withdrawn", replaces: previous.revisionId,
        revisionId: "withdrawn", publishedAt: revokedAt, knownAt: revokedAt }];
    });
    const old = qualified(setup().adapter.qualify(ref, context));
    expect(setup({}, withdraw).adapter.replay(ref, context, old.pin)).toEqual(old);
    expect(setup({}, withdraw).adapter.qualify(ref, { ...context, dataCutoff: revokedAt })).toMatchObject({ reason: "ORIGINAL_WITHDRAWN" });
    expect(setup({}, record => changeRole(record, "law", rows => rows.map(row => ({ ...row, knownAt: revokedAt }))))
      .adapter.qualify(ref, context)).toMatchObject({ reason: "ORIGINAL_NOT_KNOWN" });
    expect(setup({}, record => changeRole(record, "law", rows => [...rows, { ...rows[0]!, revisionId: "competing" }]))
      .adapter.qualify(ref, context)).toMatchObject({ reason: "ORIGINAL_CONFLICT" });
    const lost = setup({}, (record, read) => read === 3 ? undefined : record);
    expect(lost.adapter.replay(ref, context, old.pin)).toMatchObject({ reason: "ORIGINAL_UNAVAILABLE" });
    expect(lost.reads).toHaveLength(4);
  });

  it("re-reads complete current inventories and binds replay to original identity and context", () => {
    const reissue = (record: FsaYearOriginalInventory) => changeRole(record, "plan", rows => rows.map(row => ({ ...row,
      revisionId: `${row.revisionId}/reissued` })));
    const first = qualified(setup().adapter.qualify(ref, context));
    const fresh = setup({}, reissue).adapter;
    const second = qualified(fresh.qualify(ref, context));
    expect(first.proposal).toEqual(second.proposal);
    expect(first.pin).not.toEqual(second.pin);
    expect(fresh.replay(ref, context, first.pin)).toMatchObject({ reason: "REPLAY_MISMATCH" });
    expect(fresh.replay(ref, { ...context, runId: "another-run" }, second.pin)).toMatchObject({ reason: "REPLAY_MISMATCH" });
    const racing = setup({}, (record, read) => read === 4 ? reissue(record) : record);
    expect(racing.adapter.qualify(ref, context)).toMatchObject({ reason: "ORIGINAL_CHANGED" });
    expect(setup().adapter.qualify(ref, { ...context, asOf: stamp("2027-10-02", "23:00:00") }))
      .toMatchObject({ reason: "ORIGINAL_INCOMPLETE", role: "history" });
  });

  it.each([["80.07", "complete"], ["80.08", "incomplete"]])("keeps a published $%s closeout uncommitted", (amount, coverage) => {
    const { adapter } = setup({}, record => {
      if (record.query.year !== "prior") return record;
      const successor = inventory({ ...record.query, year: "successor" });
      return changeValue(record, "closeout", () => ({ closeoutId: "close", transferId: "transfer-once", from: record.scope,
        to: successor.scope, amount: money(amount), settlementIds: ["deposit/0"],
        priorInputFingerprint: fsaYearChainFingerprint(ownerRequest(record)),
        successorInputFingerprint: fsaYearChainFingerprint(ownerRequest(successor)), evidence: source("health_fsa_closeout", "close") }));
    });
    const result = qualified(adapter.qualify(ref, context));
    expect(result.proposal).toMatchObject({ proposalCoverage: coverage, proposedCarryover: money(coverage === "complete" ? "80.07" : "0") });
    expect(result).toMatchObject({ appliedCarryover: money("0"), committed: false, postable: false });
    expect(result.proposal).not.toHaveProperty("externalCloseout");
  });

  it("rejects duplicate, wrong-party and unmatched bank evidence, overlapping transfers and wrong legal year", () => {
    const negatives: ((record: FsaYearOriginalInventory) => FsaYearOriginalInventory)[] = [
      record => changeValue(record, "paid", rows => [...rows, rows[0]!]),
      record => changeValue(record, "reimbursed", rows => [...rows, rows[0]!]),
      record => changeValue(record, "paid", rows => rows.map(row => ({ ...row, ownerId: "someone-else" }))),
      record => changeValue(record, "reimbursed", rows => rows.map(row => ({ ...row, memberId: "someone-else" }))),
      record => changeValue(record, "claims", rows => rows.map(row => ({ ...row, memberId: "uncovered" }))),
      record => changeValue(record, "paid", () => []), record => changeValue(record, "reimbursed", () => []),
      record => changeValue(record, "law", value => ({ ...value, planYearId: "2027" })),
      record => changeValue(record, "yearEnd", value => value.kind === "carryover" && value.nextEnrollment
        ? { ...value, nextEnrollment: { ...value.nextEnrollment, enrolled: false } } : value),
      record => changeValue(record, "carryoverLaw", value => value && ({ ...value, planYearId: "2027" })),
      record => changeValue(record, "transfers", value => ({ ...value, competing: [
        { transferId: "another-transfer", from: scope("2026"), to: scope("2027") }] })),
      record => changeValue(record, "election", value => ({ ...value, annualElection: money("1000.301") })),
      record => changeValue(record, "election", value => ({ ...value, annualElection: money("1000.30", Currency.of("EUR")) })),
    ];
    for (const change of negatives) {
      const { adapter } = setup({}, record => record.query.year === "prior" ? change(record) : record);
      expect(adapter.qualify(ref, context)).toMatchObject({ coverage: "incomplete", postable: false, appliedCarryover: money("0") });
    }
  });

  it("rejects a successor claim reusing a prior-year BANK original and a projected successor rule", () => {
    const copied = setup({}, record => {
      if (record.query.year !== "successor") return record;
      const published = inventory({ ...record.query, year: "prior" }).roles.paid[0]!;
      if (published.status !== "published") throw new Error("Missing fixture BANK original");
      const duplicate = claim(0, "2027-08-01", "2027-08-02");
      const withClaim = changeValue(record, "claims", () => [{ ...duplicate, ...record.scope,
        decision: { kind: "denied", eligibleAmount: money("0"), decidedAt: duplicate.submittedAt,
          evidence: source("health_fsa_adjudication", duplicate.proofId) }, reimbursement: { status: "not_adjudicated" } }]);
      return changeValue(withClaim, "paid", () => published.value.map(payment => ({ ...payment, occurredAt: stamp("2027-08-01") })));
    });
    expect(copied.adapter.qualify(ref, context)).toMatchObject({ reason: "HISTORY_CONFLICT", coverage: "incomplete" });
    const projected = setup({}, record => record.query.year === "successor"
      ? changeValue(record, "law", value => ({ ...value, evidence: { ...value.evidence, projectionStatus: "explicit_projected" } })) : record);
    expect(projected.adapter.qualify(ref, context)).toMatchObject({ coverage: "incomplete", appliedCarryover: money("0") });
  });

  it("retains proportional provenance for 1/12/24 claims with a fixed-size source catalog", () => {
    const results = [1, 12, 24].map(count => qualified(setup({ count }).adapter.qualify(ref, context)));
    expect(results.map(result => result.proposal.provenance.length)).toEqual([1, 12, 24]);
    expect(results.map(result => result.proposal.closingEntitlement)).toEqual([money("960.29"), money("520.18"), money("40.06")]);
    const sizes = results.map(result => JSON.stringify(result).length);
    expect(results.every(result => result.sources.prior.length === 15 && result.sources.successor.length === 15
      && !JSON.stringify(result).includes("payload payload"))).toBe(true);
    expect(sizes[2]! - sizes[1]!).toBeLessThan(4500);
    expect(sizes[2]! - sizes[1]!).toBeLessThan(2 * (sizes[1]! - sizes[0]!));
  });
});
