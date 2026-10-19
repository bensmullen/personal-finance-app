import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { createRight } from "../../../../src/semantics/claim.js";
import { recognitionId, settlementId } from "../../../../src/semantics/identity.js";
import { applyAccountingTransactionAtomically, applySsaMedicarePaymentAtomically, authoritativeStateChangesSince, cloneAuthoritativeState,
  createAuthoritativeState, createIndexedExecutionState, validateAuthoritativeState,
  type SsaMedicarePaymentRecord } from "../../../../src/state/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { money, Rate, rateConvention, USD } from "../../../../src/values/index.js";
import { coordinateSocialSecurity } from "../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import { attachSsaMedicare, createSsaMedicareParticipant, qualifySsaMedicarePayment, runSsaMedicare,
  type ConfirmedSsaMedicarePayment } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { applyHouseholdExecutionOverlay, exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow,
  runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { fixture, ids, input, payment, uuid } from "./scenario.js";

const execute = (q = payment(), f = fixture()) => runSsaMedicare({ kernel: f.kernel, input: input([q]), runContext: f.context });
const bound = (q = payment()) => qualifySsaMedicarePayment(q, ids.household, ids.person);
const reject = (q: ConfirmedSsaMedicarePayment, code?: string) => {
  const f = fixture(), before = canonicalSerialize(f.state);
  const result = execute(q, f);
  expect(result.status).toBe("incomplete");
  expect(result.periods).toEqual([]);
  expect(result.state).toEqual(f.state);
  expect(canonicalSerialize(f.state)).toBe(before);
  expect(result.state.ssaMedicarePayments).toBeUndefined();
  if (code) expect(result.diagnostics.map(d => d.code)).toContain(code);
};
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
// Expand only the replay wire's sharing tags, leaving all Money/type tags
// intact. This lets tests mutate sparse deltas without breaking references.
const unsharedWire = (encoded: string): unknown => {
  const definitions = new Map<number, unknown>();
  const expand = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(expand);
    const w = v as { kind?: string; value?: unknown };
    if (w.kind === "definition") {
      const [id, payload] = w.value as [number, unknown], result = expand(payload);
      definitions.set(id, result); return result;
    }
    if (w.kind === "reference") return definitions.get(w.value as number);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
  };
  // JSON makes each expanded reference independent for mutation.
  return JSON.parse(JSON.stringify(expand(JSON.parse(encoded))));
};
const wireEntries = (wire: unknown) => (wire as { value: [string, unknown][] }).value;
const wireField = (wire: unknown, key: string): unknown => wireEntries(wire).find(([k]) => k === key)![1];

describe("#149 opt-in atomic same-event SSA/Medicare household settlement", () => {
  it("posts gross 1500, premium expense 200 and actual BANK 1300 with three independent cleared claims", () => {
    const q = payment(), f = fixture(), opening = canonicalSerialize(f.state), result = execute(q, f);
    expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
    const p = result.periods[0]!;
    expect([p.cash, p.netWorth, p.statements.income, p.statements.expenses, p.statements.operatingCashFlow].map(m => m.amount.toString()))
      .toEqual(["3300", "3300", "1500", "200", "1300"]);
    expect(p.transactions).toHaveLength(1);
    expect(p.transactions[0]!.legs.map(l => [l.posting, l.type, l.amount.amount.toString()])).toEqual([
      ["debit", "cash", "1300"], ["debit", "expense", "200"], ["credit", "income", "1500"],
    ]);
    const receipt = Object.values(result.state.ssaMedicarePayments!)[0]!;
    expect(receipt.version).toBe("ssa-medicare-payment/v1");
    expect(receipt.transaction).toEqual(p.transactions[0]);
    expect(receipt.netBank.equals(money("1300"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toEqual([receipt.transaction.id]);
    expect(result.state.identities.recognitionIds).toHaveLength(3);
    expect(result.state.identities.settlementIds).toHaveLength(3);
    const claims = Object.values(result.state.obligations);
    expect(claims).toHaveLength(3);
    expect(claims.every(c => c.outstandingAmount.isZero() && c.settlementIds.length === 1)).toBe(true);
    expect(result.state.obligations[q.payable.rightClaimId]!.originalAmount.equals(money("1500"))).toBe(true);
    expect(result.state.obligations[q.payable.rightClaimId]!.settlementIds).toEqual([q.rightSettlementId]);
    for (const r of q.deductions) expect(result.state.obligations[r.terms.obligationId]!.settlementIds).toEqual([r.draft.id]);
    expect(receipt.recognitions.map(r => r.amount.amount.toString())).toEqual(["1500", "80", "120"]);
    expect(receipt.payable.taxWithholding.amount.isZero()).toBe(true);
    expect(p.transactions.flatMap(t => t.legs).some(l => l.type === "tax")).toBe(false);
    expect(result.status).toBe("incomplete");
    expect(result.outputCapabilities?.netWorth?.status).toBe("incomplete");
    expect(result.outputCapabilities?.ssaMedicareExecution?.status).toBe("complete");
    expect(result.outputCapabilities?.verifiedZeroSsaWithholding?.status).toBe("complete");
    expect(canonicalSerialize(f.state)).toBe(opening);
  });

  it("is deterministic under reversed Part requests and absent unless explicitly attached", () => {
    const q = payment(), reversed = { ...q, deductions: [...q.deductions].reverse() };
    const a = execute(q), b = execute(reversed);
    expect(a.periods).toEqual(b.periods); expect(a.state).toEqual(b.state);
    const f = fixture(), plain = runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" });
    expect(plain.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(plain.state.ssaMedicarePayments).toBeUndefined();
    expect(plain.periods.flatMap(p => p.transactions)).toEqual([]);
    const prepared = createSsaMedicareParticipant(input()).prepare(f.context, a.periods[0]!.period, { state: f.state, primitiveState: {} });
    expect(prepared.operations.every(o => o.descriptor.sequencingInstant >= q.payable.paymentAt)).toBe(true);
    expect(prepared.operations.find(o => o.descriptor.operationClass === "cash_flow:ssa_medicare")!.descriptor.resourceAccesses)
      .toEqual([{ kind: "account_cash", accountId: ids.bank, mode: "produce" }]);
  });

  it("consumes source-owned nonzero B/D IRMAA exactly once in each premium", () => {
    const q = payment();
    const c2 = { ...q.c2, premiums: { ...q.c2.premiums, coverages: q.c2.premiums.coverages.map(c => ({ ...c,
      quote: { ...c.quote, gross: money(c.medicare!.premiumFor === "part_b" ? "70" : "100"),
        member: money(c.medicare!.premiumFor === "part_b" ? "70" : "100") } })) },
      irmaa: { ...q.c2.irmaa, rules: q.c2.irmaa.rules.map(r => ({ ...r, tables: r.tables.map(t => ({ ...t,
        tiers: t.tiers.map(v => ({ ...v, partBMonthly: money("10"), partDMonthly: money("20") })) })) })) } };
    const result = execute({ ...q, c2, deductions: q.deductions.map(r => ({ ...r, terms: { ...r.terms, premium: {
      ...r.terms.premium, base: money(r.terms.premium.part === "part_b" ? "70" : "100"),
      irmaa: money(r.terms.premium.part === "part_b" ? "10" : "20"),
    } } })) });
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]!.statements.expenses.equals(money("200"))).toBe(true);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
  });

  it("preserves receipts through cold/indexed clones and suppresses exact completed payments", () => {
    const q = payment(), first = execute(q), restored = createAuthoritativeState(first.state);
    for (const state of [restored, cloneAuthoritativeState(restored), cloneAuthoritativeState(createIndexedExecutionState(restored))]) {
      expect(state).toEqual(first.state);
      validateAuthoritativeState(state);
      const result = execute(q, fixture(1, state));
      expect(result.periods).toHaveLength(1);
      expect(result.periods[0]!.transactions).toEqual([]);
      expect(result.state).toEqual(first.state);
    }
    const opening = createIndexedExecutionState(fixture().state), next = cloneAuthoritativeState(opening);
    applySsaMedicarePaymentAtomically(next, bound(q));
    const delta = authoritativeStateChangesSince(next, opening, same) as { ssaMedicarePayments: { present: boolean; changes: readonly unknown[] } };
    expect(delta.ssaMedicarePayments.present).toBe(true);
    expect(delta.ssaMedicarePayments.changes).toHaveLength(1);
    expect(authoritativeStateChangesSince(opening, opening, same)).not.toHaveProperty("ssaMedicarePayments");
    const before = canonicalSerialize(next);
    expect(() => applySsaMedicarePaymentAtomically(next, bound(q))).toThrow();
    expect(canonicalSerialize(next)).toBe(before);
    for (const changed of [{ ...q, bankCashBefore: money("2001") }, { ...q, rightSettlementId: "changed" }]) {
      const result = execute(changed, fixture(1, restored));
      expect(result.periods).toEqual([]); expect(result.state).toEqual(restored);
    }
  });

  it("executes two months exactly once without intermediate gross deposits or premium BANK debits", () => {
    const f = fixture(2), payments = [payment(), payment("2026-07", money("3300"))];
    const kernel = attachSsaMedicare(f.kernel, input(payments));
    const out = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(out.periods).toHaveLength(2);
    expect(out.periods.map(p => p.cash.amount.toString())).toEqual(["3300", "4600"]);
    expect(Object.values(out.state.ssaMedicarePayments!)).toHaveLength(2);
    expect(out.state.identities.settlementIds).toHaveLength(6);
    expect(out.periods.flatMap(p => p.transactions).flatMap(t => t.legs).filter(l => l.type === "cash").map(l => l.amount.amount.toString()))
      .toEqual(["1300", "1300"]);
  });

  it.each([13, 24])("agrees in detail, summary, sparse transport and a fresh process across %s payment months", months => {
    const f = fixture(months, undefined, "2026-01");
    let cash = money("2000");
    const payments = Array.from({ length: months }, (_, n) => {
      const month = `${2026 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
      const q = payment(month, cash); cash = cash.plus(money("1300")); return q;
    });
    const kernel = attachSsaMedicare(f.kernel, input(payments));
    const summary = runHouseholdKernel({ kernel, runContext: f.context });
    const detail = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(months);
    expect(summary.state).toEqual(detail.state);
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.state.accounts[ids.bank]!.cash.equals(cash)).toBe(true);
    expect(Object.keys(summary.state.ssaMedicarePayments!)).toHaveLength(months);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const transported = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(exportHouseholdReplayCheckpoints(transported)).toEqual(exportHouseholdReplayCheckpoints(summary));
    const selected = detail.periods.at(-1)!.period;
    const replay = replayHouseholdForecastWindow(transported, selected);
    expect(replay.periods).toEqual(detail.periods.slice(-1));
    expect(replay.state).toEqual(detail.state);
    const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
      fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
      input: JSON.stringify({ artifact, selected }), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    expect(worker.status, worker.stderr).toBe(0);
    expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(replay.state), periods: canonicalSerialize(replay.periods) });
  }, 60_000);

  it("omits the BANK leg when verified full deductions exhaust gross", () => {
    const q = payment();
    const a1 = { ...q.a1, recipients: q.a1.recipients.map(r => ({ ...r, quotes: r.quotes.map(v => ({ ...v,
      award: { ...v.award, quote: { ...v.award.quote!, grossAmount: money("200") } } })) })) };
    const award = coordinateSocialSecurity(a1).proposals[0]!;
    const result = execute({ ...q, a1, award, c2: { ...q.c2, awards: [award.quotedAward] },
      payable: { ...q.payable, grossPayable: money("200") } });
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(result.periods[0]!.transactions[0]!.legs.map(l => [l.posting, l.type, l.amount.amount.toString()]))
      .toEqual([["debit", "expense", "200"], ["credit", "income", "200"]]);
    expect(Object.values(result.state.obligations).every(c => c.outstandingAmount.isZero())).toBe(true);
  });

  it("keeps source-confirmed zero Part A as coverage without a zero claim or posting", () => {
    const q = payment(), elected = ["part_a", "part_b", "part_d"] as const, base = q.c2.premiums.coverages[0]!;
    const zero = { ...base, id: "coverage:part_a", planId: "plan:part_a", recipientId: "provider:part_a",
      eligibility: base.eligibility.map(e => ({ ...e, planId: "plan:part_a" })),
      medicare: { ...base.medicare!, elected, premiumFor: "part_a" as const },
      quote: { ...base.quote, quoteId: "zero-quote", gross: money("0"), employer: money("0"), member: money("0") } };
    const c2 = { ...q.c2, premiums: { ...q.c2.premiums,
      coverages: [...q.c2.premiums.coverages.map(c => ({ ...c, medicare: { ...c.medicare!, elected } })), zero],
      coordination: q.c2.premiums.coordination.map(c => ({ ...c, coverageIds: [...c.coverageIds, zero.id] })) },
      irmaa: { ...q.c2.irmaa, enrollments: q.c2.irmaa.enrollments.map(e => ({ ...e, elected })) },
      inventories: q.c2.inventories.map(i => ({ ...i, parts: i.parts.map(p => p.part === "part_a"
        ? { ...p, status: "elected" as const, coverageId: zero.id } : p) })),
      deductionTerms: [...q.c2.deductionTerms, { ...q.c2.deductionTerms[0]!, part: "part_a" as const,
        coverageId: zero.id, recipientId: zero.recipientId, permittedAmount: money("0") }] };
    const result = execute({ ...q, c2 });
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    expect(Object.values(result.state.obligations)).toHaveLength(3);
    expect(result.periods[0]!.transactions).toHaveLength(1);
  });

  it.each(["199", "79", "0"])("rejects actual requalified gross %s when full positive premiums cannot be settled", gross => {
    const q = payment();
    const a1 = { ...q.a1, recipients: q.a1.recipients.map(r => ({ ...r, quotes: r.quotes.map(v => ({ ...v,
      award: { ...v.award, quote: { ...v.award.quote!, grossAmount: money(gross) } } })) })) };
    const award = coordinateSocialSecurity(a1).proposals[0]!;
    reject({ ...q, a1, award, c2: { ...q.c2, awards: [award.quotedAward] }, payable: { ...q.payable, grossPayable: money(gross) } });
  });

  it("round-trips old v1/v2 and pre-SSA v3 checkpoints with exact optional absence", () => {
    const f = fixture(13), original = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    const artifact = createPortableHouseholdReplayArtifact(original);
    for (const version of ["household-replay/v1", "household-replay/v2", "household-replay/v3"] as const) {
      const restored = restorePortableHouseholdReplayArtifact({ ...artifact, version });
      expect(restored.replay.kernel.executable.reconciledOpeningState).not.toHaveProperty("ssaMedicarePayments");
      expect(replayHouseholdForecastWindow(restored, original.periods.at(-1)!.period).state).not.toHaveProperty("ssaMedicarePayments");
    }
    const wire = unsharedWire(artifact.encoded);
    const checkpoints = (wireField(wire, "checkpoints") as { value: unknown[] }).value;
    for (const checkpoint of checkpoints) {
      const records = wireField(checkpoint, "records") as { value: [string, unknown][] };
      records.value = records.value.filter(([key]) => key !== "ssaMedicarePayments");
    }
    const encoded = JSON.stringify(wire), integrity = createInputFingerprint({ runContext: f.context, openingState: encoded });
    const oldV3 = restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity });
    expect(exportHouseholdReplayCheckpoints(oldV3)).toEqual(exportHouseholdReplayCheckpoints(original));
  });

  it("fails closed for identity, source, withholding, route and incomplete premium evidence", () => {
    const q = payment(), p = q.payable;
    for (const patch of [{ householdId: "wrong" }, { recipientId: uuid(50) }, { workerRecordId: uuid(50) },
      { awardId: "wrong" }, { entitlementId: "wrong" }, { grossPayable: money("1499") },
      { source: { ...p.source, status: "unknown" as const } }, { source: { ...p.source, version: "changed" } },
      { taxWithholding: { ...p.taxWithholding, amount: money("1") } },
      { taxWithholding: { ...p.taxWithholding, source: { ...p.taxWithholding.source, knownAt: instant("2026-06-16T00:00:00.000Z") } } }])
      reject({ ...q, payable: { ...p, ...patch } });
    reject({ ...q, payable: { ...p, taxWithholding: undefined } } as unknown as ConfirmedSsaMedicarePayment);
    reject({ ...q, deductions: q.deductions.slice(0, 1) });
    reject({ ...q, deductions: [q.deductions[0]!, q.deductions[0]!] });
    reject({ ...q, c2: { ...q.c2, irmaa: { ...q.c2.irmaa, histories: [] } } });
    reject({ ...q, c2: { ...q.c2, premiums: { ...q.c2.premiums, coverages: [] } } });
    reject({ ...q, c2: { ...q.c2, deductionTerms: [] } });
    reject({ ...q, bank: { ...q.bank, personId: uuid(50) } });
    reject({ ...q, bank: { ...q.bank, accountId: domainId("account", uuid(50)) } });
    reject({ ...q, bankCashBefore: money("1999") });
    reject({ ...q, bank: { ...q.bank, evidence: { ...q.bank.evidence, knownAt: instant("2026-06-10T00:00:00.000Z") } } }, "SSA_SOURCE_NOT_ADMITTED");
    reject({ ...q, c2: { ...q.c2, premiums: { ...q.c2.premiums, coverages: q.c2.premiums.coverages.map(c => ({ ...c,
      route: { kind: "aftertax_bank", payerId: ids.person, sourceAccountId: ids.bank, evidence: c.route.evidence } })) } } });
    reject({ ...q, a1: { ...q.a1, recipients: q.a1.recipients.map(r => ({ ...r, determinations: [] })) } });
    reject({ ...q, deductions: q.deductions.map(r => ({ ...r, terms: { ...r.terms, amount: money("0") } })) });
    reject({ ...q, deductions: q.deductions.map(r => ({ ...r, terms: { ...r.terms,
      premium: { ...r.terms.premium, part: "advantage" } } })) }, "SSA_MEDICARE_UNSUPPORTED_COVERAGE");
    reject({ ...q, c2: { ...q.c2, deductionTerms: q.c2.deductionTerms.map(t => ({ ...t,
      source: { ...t.source, asOf: civilDate("2026-06-16") } })) } });
    reject({ ...q, c2: { ...q.c2, premiums: { ...q.c2.premiums, coverages: q.c2.premiums.coverages.map(c => ({ ...c,
      quote: { ...c.quote, source: { ...c.quote.source, projectionStatus: "unavailable" } } })) } } });
  });

  it("rolls back all candidate state for duplicate identities, preaccrual, partial SSA right, and overgross", () => {
    const q = payment(), base = bound(q);
    for (const patch of [
      { rightSettlementId: base.requests[0]!.draft.id },
      { requests: base.requests.map(r => ({ ...r, draft: { ...r.draft, id: base.requests[0]!.draft.id } })) },
      { requests: base.requests.map(r => ({ ...r, terms: { ...r.terms, receiptId: "duplicate" } })) },
      { requests: base.requests.map(r => ({ ...r, terms: { ...r.terms, authorizationId: "duplicate" } })) },
      { right: createRight({ ...base.right, outstandingAmount: money("1499"), settlementIds: [settlementId("prior-partial")] }) },
      { right: createRight({ ...base.right, recognizedAt: instant("2026-06-01T00:00:00.000Z") }) },
      { payable: { ...base.payable, grossPayable: money("100") } },
      { requests: base.requests.map(r => ({ ...r, claim: { ...r.claim, originatingRecognitionId: recognitionId("duplicate") } })) },
      { sourceInputs: { complete: true } },
    ]) {
      const state = fixture().state, before = canonicalSerialize(state);
      expect(() => applySsaMedicarePaymentAtomically(state, { ...base, ...patch })).toThrow();
      expect(canonicalSerialize(state)).toBe(before);
    }
    for (const priorClaim of [base.right, base.requests[0]!.claim]) {
      const f = fixture(), state = createAuthoritativeState({ ...f.state, obligations: { [priorClaim.id]: priorClaim } });
      const before = canonicalSerialize(state);
      expect(() => applySsaMedicarePaymentAtomically(state, base)).toThrow();
      expect(canonicalSerialize(state)).toBe(before);
    }
    const state = createAuthoritativeState({ ...fixture().state, identities: {
      postedTransactionIds: [accountingTransactionId(`ssa-medicare:${q.payable.paymentId}`)],
    } });
    const before = canonicalSerialize(state);
    expect(() => applySsaMedicarePaymentAtomically(state, base)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });

  it("rejects forged histories and tampered journal, amount, source, consumption and claim evidence", () => {
    const out = execute(), entry = Object.values(out.state.ssaMedicarePayments!)[0]!;
    for (const patch of [{ netBank: money("1301") }, { version: "unknown" },
      { transaction: { ...entry.transaction, id: accountingTransactionId("unposted") } },
      { sourceInputs: { ...(entry.sourceInputs as object), bankCashBefore: money("0") } },
      { rightSettlementId: entry.requests[0]!.draft.id },
      { requests: entry.requests.slice(0, 1) }]) {
      expect(() => createAuthoritativeState({ ...out.state,
        ssaMedicarePayments: { [entry.id]: { ...entry, ...patch } as SsaMedicarePaymentRecord } })).toThrow();
    }
    const empty = fixture().state;
    expect(() => createAuthoritativeState({ ...empty, ssaMedicarePayments: { [entry.id]: entry } })).toThrow();
    expect(() => createAuthoritativeState({ ...out.state, identities: { ...out.state.identities, postedTransactionIds: [] } })).toThrow();
    expect(() => createAuthoritativeState({ ...out.state, identities: { ...out.state.identities, externalIdempotencyKeys: [] } })).toThrow();
  });

  it("rejects unresolved BANK contention without modifying authoritative cash or claims", () => {
    const f = fixture(), participant = createSsaMedicareParticipant(input()), before = canonicalSerialize(f.state);
    expect(() => participant.prepare(f.context, { start: f.context.simulationStart, end: f.context.simulationEnd },
      { state: f.state, primitiveState: {} }, [{ id: "other", domain: "cash_flow", sequencingInstant: payment().payable.paymentAt,
        dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }], traceRefs: [] }])).toThrow();
    expect(canonicalSerialize(f.state)).toBe(before);
    const peer = { id: "unproven-peer", version: "v1", economicInputs: {}, prepare: () => ({ id: "unproven-peer", operations: [{
      descriptor: { id: "peer", domain: "cash_flow", sequencingInstant: payment().payable.paymentAt, dependsOn: [],
        resourceAccesses: [{ kind: "account_cash" as const, accountId: ids.bank, mode: "produce" as const }], traceRefs: [] },
      execute: (candidate: { state: typeof f.state; primitiveState: {} }) => {
        const state = cloneAuthoritativeState(candidate.state);
        applyAccountingTransactionAtomically(state, createAccountingTransaction({ id: accountingTransactionId("peer"), type: "peer_income",
          date: payment().payable.paymentAt, legs: [createAccountingLeg({ type: "cash", posting: "debit", amount: money("10"), accountId: ids.bank, cashFlowClass: "operating" }),
            createAccountingLeg({ type: "income", posting: "credit", amount: money("10") })] }));
        return { ...candidate, state, facts: {} };
      },
    }] }) };
    const kernel = applyHouseholdExecutionOverlay(attachSsaMedicare(f.kernel, input()), { participants: [participant, peer] });
    const result = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(f.state);
    expect(result.diagnostics.map(d => d.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
  });

  it("rejects overlapping generic income even when it has another source and payment day", () => {
    const f = fixture(), start = f.context.simulationStart;
    const kernel = applyHouseholdExecutionOverlay(f.kernel, { cashFlowInput: { householdId: ids.household, ownerId: ids.person,
      cashAccountId: ids.bank, expensePayableLiabilityId: domainId("liability", uuid(90)), baseCurrency: USD, expenses: [], events: [],
      incomes: [{ id: domainId("income", uuid(91)), ownerId: ids.person, baseMonthlyAmount: money("1500"), start,
        recurrence: { kind: "utc_monthly", anchor: start, invalidDayPolicy: "skip" }, depositAccountId: ids.bank,
        growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: start,
        primitiveIds: { growth: domainId("primitive-instance", uuid(92)), recurrence: domainId("primitive-instance", uuid(93)) } }] } });
    expect(() => attachSsaMedicare(kernel, input())).toThrow();
    expect(f.state.ssaMedicarePayments).toBeUndefined();
  });

  it("rejects changed portable artifacts before any replay", () => {
    const f = fixture(13), summary = runHouseholdKernel({ kernel: attachSsaMedicare(f.kernel, input()), runContext: f.context });
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded: artifact.encoded.replace("ssa-medicare-payment/v1", "ssa-medicare-payment/v9") })).toThrow();
    // Recompute change-detection integrity to exercise semantic checkpoint validation.
    const encoded = artifact.encoded.replace("ssa-medicare-payment/v1", "ssa-medicare-payment/v9");
    const integrity = createInputFingerprint({ runContext: f.context, openingState: encoded });
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow();
    for (const mutate of [
      (change: unknown) => { wireEntries(change).find(([key]) => key === "present")![1] = false; },
      (change: unknown) => { (wireField(change, "remove") as { value: unknown[] }).value = ["missing-receipt"]; },
      (change: unknown) => { (wireField(change, "set") as { value: [string, unknown][] }).value[0]![0] = "wrong-key"; },
    ]) {
      const wire = unsharedWire(artifact.encoded);
      const checkpoint = (wireField(wire, "checkpoints") as { value: unknown[] }).value[0]!;
      const change = wireField(wireField(checkpoint, "records"), "ssaMedicarePayments");
      mutate(change);
      const changed = JSON.stringify(wire);
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded: changed,
        integrity: createInputFingerprint({ runContext: f.context, openingState: changed }) })).toThrow();
    }
  });
});
