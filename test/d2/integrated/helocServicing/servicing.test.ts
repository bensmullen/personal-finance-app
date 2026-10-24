import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { applyAccountingTransactionAtomically, applyD2HelocOriginalAtomically, applyD2SettlementAtomically,
  createAuthoritativeState, requalifyD2SettlementReceiptHistory } from "../../../../src/state/index.js";
import { money, USD, Currency } from "../../../../src/values/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { applyHouseholdExecutionOverlay, exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow,
  runHouseholdKernel, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { proposeHeloc, type HelocRequest } from "../../../../src/simulation/d2/debt/heloc/index.js";
import { proposeHelocPhaseServicing } from "../../../../src/simulation/d2/debt/heloc/phaseServicing.js";
import { createHelocDrawParticipant } from "../../../../src/simulation/d2/integration/helocDraws/index.js";
import { createHelocServicingParticipant, qualifyHelocServicingSource, type HelocServiceDocument, type HelocBankDebit }
  from "../../../../src/simulation/d2/integration/helocServicing/index.js";
import { documents, fixture, ids, opening, publish, publisher, registerPublisher, zeroCharge, balloon, withProvenance, secondLine } from "./scenario.js";

registerPublisher();
beforeEach(() => publish());
const run = (f = fixture()) => runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" });
const qualified = (id = "month:0") => {
  const q = qualifyHelocServicingSource(id, fixture().context);
  if (q.status !== "qualified") throw new Error(q.reason);
  return q;
};
describe("#149 original physical HELOC amortizing/balloon servicing", () => {
  it.each([false, true])("posts literal financed January and posted-history February (computed=%s)", computed => {
    publish(documents(2, false, computed));
    const f = fixture(), result = run(f);
    expect(result.periods).toHaveLength(3);
    expect(result.periods.map(p => p.cash.amount.toString())).toEqual(["500", "394.9", "290.76"]);
    expect(result.periods.map(p => p.liabilities.amount.toString())).toEqual(["1000", "900", "800"]);
    expect(result.periods.map(p => p.netWorth.amount.toString())).toEqual(["-500", "-505.1", "-509.24"]);
    expect(result.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    expect(result.state.identities.postedTransactionIds).toHaveLength(4);
    const txs = result.periods.flatMap(p => p.transactions);
    expect(txs.flatMap(t => t.legs).filter(l => l.type === "expense").map(l => l.amount.amount.toString())).toEqual(["5.1", "4.14"]);
    expect(txs.flatMap(t => t.legs).some(l => l.type === "income" || l.type === "tax")).toBe(false);
    expect(result.outputCapabilities?.helocTax?.status).toBe("incomplete");
    expect(result.outputCapabilities?.helocFutureServicing?.status).toBe("incomplete");
    expect(canonicalSerialize(f.state)).toBe(canonicalSerialize(opening()));
    const summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(result.state));
    expect(summary.periods.map(p => p.statements)).toEqual(result.periods.map(p => p.statements));
  });
  it("uses one authentic principal-only journal, no invented expense/payable", () => {
    publish([zeroCharge()]);
    const result = run(fixture(2, opening(), ["month:0"]));
    expect(result.state.accounts[ids.bank]!.cash.equals(money("400"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("900"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toHaveLength(1);
    expect(result.periods.flatMap(p => p.transactions).flatMap(t => t.legs).some(l => l.type === "expense")).toBe(false);
    const q = qualified(), before = canonicalSerialize(result.state);
    expect(q.receipt.originalProof).toBe("principal_only");
    expect(applyD2SettlementAtomically(result.state, q.receipt, fixture().context).status).toBe("already_committed");
    expect(canonicalSerialize(result.state)).toBe(before);
  });
  it("pays a separately verified final balloon and supported service fee in full", () => {
    publish([balloon()]);
    const result = run(fixture(2, opening("2000"), ["month:0"]));
    expect(result.state.accounts[ids.bank]!.cash.equals(money("992.90"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.isZero()).toBe(true);
    expect(result.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    expect(result.periods[1]!.netWorth.equals(money("992.90"))).toBe(true);
    expect(result.periods[1]!.transactions.flatMap(t => t.legs).filter(l => l.type === "expense")[0]!.amount.equals(money("7.10"))).toBe(true);
  });
  it("pairs an already recognized canonical charge and replays it without double expense", () => {
    publish(documents(1));
    const q = qualified(), f = fixture(2, opening(), ["month:0"]);
    applyD2HelocOriginalAtomically(f.state, q.receipt, f.context);
    const result = run(fixture(2, f.state, ["month:0"]));
    expect(result.state.accounts[ids.bank]!.cash.equals(money("394.90"))).toBe(true);
    expect(result.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    expect(result.periods.flatMap(p => p.transactions).some(t => t.legs.some(l => l.type === "expense"))).toBe(false);
    expect(result.state.identities.postedTransactionIds).toHaveLength(2);
  });
  it("rolls back the entire period when BANK is short by one cent", () => {
    const docs = documents(1), d = docs[0]!;
    publish([{ ...d, bank: { ...d.bank, bankCashBefore: money("105.09") } }]);
    const f = fixture(2, opening("105.09"), ["month:0"]), result = run(f);
    expect(result.periods).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("105.09"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("1000"))).toBe(true);
    expect(result.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
    expect(result.state.d2SettlementReceipts).toBeUndefined();
  });
  it("keeps January committed when the later installment fails", () => {
    const docs = documents();
    docs[1] = { ...docs[1]!, bank: { ...docs[1]!.bank, bankCashBefore: money("104.13") } };
    publish(docs);
    const result = run();
    expect(result.periods).toHaveLength(2);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("394.90"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("900"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toHaveLength(2);
  });
});

describe("independent issuer/BANK admission and exact original history", () => {
  it("documents the out-of-scope B1 gate: an actually posted draw shares its operation/posting ID", () => {
    const original = documents(1, false, true)[0]!, r = original.issuer.request;
    const period = { start: civilDate("2025-12-01"), endExclusive: civilDate("2026-01-01") };
    const draw: HelocRequest = { ...r.line, period, evaluatedAsOf: civilDate("2025-12-31"), openingPrincipal: money("900"),
      rate: { ...r.line.rate!, priorResetAt: period.start }, interest: { ...r.line.interest, dueAt: period.endExclusive },
      events: [{ operationId: "actual-original-draw", authorizationId: "original-draw-authorization", kind: "draw",
        effectiveAt: civilDate("2025-12-15"), sequence: 0, actorId: ids.person, bankAccountId: ids.bank,
        authorized: true, amount: money("100"), source: r.line.source, funding: null }] };
    const proposed = proposeHeloc(draw);
    expect(proposed.coverage).toBe("complete");
    const quote = { request: draw, proposal: proposed.proposals[0]!, openingBankCash: money("400"),
      bankCashBeforeDraw: { "actual-original-draw": money("400") },
      bank: { classification: "BANK" as const, accountId: ids.bank, householdId: ids.household, personId: ids.person, evidence: r.line.source } };
    const participant = createHelocDrawParticipant({ householdId: ids.household, personId: ids.person, quotes: [quote] });
    const context = { ...fixture().context, simulationStart: instant("2025-12-01T00:00:00.000Z"), simulationEnd: instant("2026-01-01T00:00:00.000Z") };
    const candidate = { state: opening("400", "900"), primitiveState: createPrimitiveRuntimeStateStore(), runtime: {} };
    const prepared = participant.prepare(context, { start: context.simulationStart, end: context.simulationEnd }, candidate);
    expect(prepared.operations).toHaveLength(1);
    const executed = prepared.operations[0]!.execute(candidate, new Map());
    expect(executed.state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
    expect(executed.state.liabilities[ids.principal]!.balance.equals(money("1000"))).toBe(true);
    const postingId = executed.state.identities.postedTransactionIds[0]!;
    expect(postingId).toBe(draw.events[0]!.operationId);
    const request = { ...r, checkpoint: { ...r.checkpoint, originalPrincipal: money("900"), history: [{
      postingId, operationId: draw.events[0]!.operationId, authorizationId: draw.events[0]!.authorizationId,
      claimId: "original-draw-history-claim", fundingId: "original-draw-history-funding", effectiveAt: draw.events[0]!.effectiveAt,
      sequence: 0, kind: "draw" as const, principal: money("100"), interest: money("0"), cash: money("100"),
      source: r.line.source, evidenceKind: "canonical_posting" as const }] } };
    const conditional = proposeHelocPhaseServicing(request);
    expect(conditional.proposals).toHaveLength(0);
    expect(conditional.diagnostics.map(d => d.diagnosticCode)).toEqual(["DUPLICATE_CLAIM"]);
    publish([{ ...original, issuer: withProvenance({ ...original.issuer, request, priorDraws: [quote] }) }]);
    expect(qualifyHelocServicingSource("month:0", fixture().context)).toMatchObject({ status: "incomplete", diagnosticSeam: "S7" });
  });
  const badIssuer: [string, (d: HelocServiceDocument) => HelocServiceDocument][] = [
    ["unfunded scheduled proposal", d => ({ ...d, request: { ...d.request, payment: { ...d.request.payment, status: "scheduled", authorization: null, funding: null } } })],
    ["forged settled flag", d => ({ ...d, request: { ...d.request, payment: { ...d.request.payment, status: "settled", observed: null } } })],
    ["backdated complete issuer statement", d => { const t = d.request.terms!, q = t.issuerQuote!; return withProvenance({ ...d,
      request: { ...d.request, terms: { ...t, issuerQuote: { ...q, source: { ...q.source, publishedAt: d.request.line.source.publishedAt, asOf: d.request.line.source.asOf } } } } }); }],
    ["missing publisher witness", d => ({ ...d, provenance: [] })],
    ["stale checkpoint", d => ({ ...d, request: { ...d.request, checkpoint: { ...d.request.checkpoint, closingPrincipal: money("999") } } })],
    ["unsupported fee nature", d => ({ ...d, feeNature: "documented_service_expense" })],
    ["missing computed index/rate", d => { const { issuerQuote: _q, ...t } = d.request.terms!; return withProvenance({ ...d,
      request: { ...d.request, terms: { ...t, method: "b1_daily_simple", allocation: null } } }); }],
    ["unsupported final payoff", d => ({ ...d, request: { ...d.request, terms: { ...d.request.terms!, finalQuote: null } } })],
  ];
  it.each(badIssuer)("rejects %s without posting", (name, change) => {
    const original = name === "unsupported final payoff" ? balloon() : documents(1)[0]!;
    publish([{ ...original, issuer: change(original.issuer) }]);
    expect(qualifyHelocServicingSource("month:0", fixture().context).status).toBe("incomplete");
    const result = run(fixture(2, opening(), ["month:0"]));
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("1000"))).toBe(true);
  });
  const badBank: [string, (b: HelocBankDebit) => HelocBankDebit][] = [
    ["authorized only", b => ({ ...b, status: "authorized" })],
    ["wrong owner", b => ({ ...b, personId: domainId("person", "149c0000-0000-4000-8000-000000000099") })],
    ["wrong sponsor", b => ({ ...b, issuerId: "another-issuer" })],
    ["wrong original liability", b => ({ ...b, liabilityId: ids.charges })],
    ["wrong debit date", b => ({ ...b, effectiveAt: instant("2026-02-02T00:00:00.000Z") })],
    ["wrong amount", b => ({ ...b, amount: money("105.09") })],
    ["wrong funding", b => ({ ...b, fundingId: "another-funding" })],
    ["late publication", b => ({ ...b, publishedAt: instant("2026-02-02T00:00:00.000Z"), knownAt: instant("2026-02-02T00:00:00.000Z") })],
    ["future paid assertion published before debit", b => ({ ...b, publishedAt: b.authorizedAt, knownAt: b.authorizedAt })],
    ["wrong currency", b => ({ ...b, amount: money("105.10", Currency.of("EUR")) })],
  ];
  it.each(badBank)("rejects independently retrieved BANK %s", (_name, change) => {
    const d = documents(1)[0]!;
    publish([{ ...d, bank: change(d.bank) }]);
    expect(qualifyHelocServicingSource("month:0", fixture().context).status).toBe("incomplete");
    expect(run(fixture(2, opening(), ["month:0"])).state.identities.postedTransactionIds).toHaveLength(0);
  });
  it("does not authenticate a paid text flag when the BANK publisher vanishes", () => {
    publisher.bank = () => undefined;
    expect(qualifyHelocServicingSource("month:0", fixture().context)).toMatchObject({ status: "incomplete", diagnosticSeam: "S7", reason: "source_unavailable" });
    expect(run().state.identities.postedTransactionIds).toHaveLength(0);
  });
  it("rejects self-consistent but unposted principal history and omitted posted January", () => {
    const docs = documents(), second = docs[1]!;
    publish([second]);
    expect(run(fixture(3, opening("394.90", "900"), ["month:1"])).state.identities.postedTransactionIds).toHaveLength(0);
    publish(docs);
    const jan = qualified().receipt, state = opening();
    applyD2SettlementAtomically(state, jan, fixture().context);
    const r = second.issuer.request;
    publish([{ ...second, issuer: withProvenance({ ...second.issuer, request: { ...r,
      checkpoint: { ...r.checkpoint, originalPrincipal: money("900"), history: [] } } }) }]);
    const result = run(fixture(3, state, ["month:1"]));
    expect(result.state.identities.postedTransactionIds).toHaveLength(2);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("394.90"))).toBe(true);
  });
  it("rejects reused approvals, renamed same-line installments and duplicate source IDs", () => {
    const d = documents(1)[0]!, r = d.issuer.request, b = d.bank;
    const renamed = { issuer: { ...d.issuer, sourceId: "renamed", bankDebitId: "renamed-debit", request: { ...r,
      payment: { ...r.payment, operationId: "renamed-operation" } } }, bank: { ...b, id: "renamed-debit", operationId: "renamed-operation" } };
    publish([d, renamed]);
    expect(run(fixture(2, opening(), ["month:0", "renamed"])).state.identities.postedTransactionIds).toHaveLength(0);
    expect(() => createHelocServicingParticipant({ sourceIds: ["month:0", "month:0"] })).toThrow();
  });
  it("requalifies issuer and BANK during execution, leaving no partial charge", () => {
    const d = documents(1)[0]!;
    let calls = 0;
    publisher.issuer = () => d.issuer;
    publisher.bank = () => ++calls < 3 ? d.bank : undefined;
    const result = run(fixture(2, opening(), ["month:0"]));
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
    expect(result.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
  });
});

describe("actual household scheduler and portable source requalification", () => {
  it.each([false, true])("requires source-approved order for two lines sharing BANK (ordered=%s)", ordered => {
    const first = documents(1)[0]!, second = secondLine();
    publish([{ ...first, bank: { ...first.bank, ...(ordered ? { executionOrder: { sequenceId: "bank-order", position: 0 } } : {}) } },
      { ...second, bank: { ...second.bank, bankCashBefore: money("394.90"), ...(ordered ? { executionOrder: { sequenceId: "bank-order", position: 1 } } : {}) } }]);
    const state = opening(), principal = domainId("liability", second.bank.liabilityId), charges = domainId("liability", second.issuer.chargeLiabilityId!);
    state.liabilities[principal] = { id: principal, balance: money("1000") };
    state.liabilities[charges] = { id: charges, balance: money("0") };
    const result = run(fixture(2, state, [first.issuer.sourceId, second.issuer.sourceId]));
    expect(result.state.identities.postedTransactionIds).toHaveLength(ordered ? 4 : 0);
    expect(result.state.accounts[ids.bank]!.cash.equals(money(ordered ? "289.80" : "500"))).toBe(true);
    if (!ordered) expect(result.diagnostics.some(d => d.code === "HOUSEHOLD_CONTENTION_UNRESOLVED")).toBe(true);
  });
  it.each(["aaa_other", "zzz_other"])("rolls back same-day BANK contention independent of participant order (%s)", id => {
    const f = fixture(2, opening(), ["month:0"]);
    const other: HouseholdKernelParticipant = { id, version: "1", economicInputs: {}, prepare: (_context, period) => ({ id,
      operations: instant("2026-02-01T00:00:00.000Z") < period.start || instant("2026-02-01T00:00:00.000Z") >= period.end ? [] : [{
        descriptor: { id, domain: "cash_flow", operationClass: "cash_expense_settlement", sequencingInstant: instant("2026-02-01T00:00:00.000Z"),
          dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }], traceRefs: [] },
        execute: candidate => {
          const tx = createAccountingTransaction({ id: accountingTransactionId(id), type: "other_expense", date: instant("2026-02-01T00:00:00.000Z"),
            legs: [createAccountingLeg({ type: "expense", posting: "debit", amount: money("400") }),
              createAccountingLeg({ type: "cash", posting: "credit", accountId: ids.bank, amount: money("400"), cashFlowClass: "operating" })] });
          applyAccountingTransactionAtomically(candidate.state, tx);
          return { ...candidate, facts: { transactions: [tx] } };
        },
      }] }) };
    const kernel = applyHouseholdExecutionOverlay(f.kernel, { participants: [...f.kernel.executable.participants!, other] });
    const result = run({ ...f, kernel });
    expect(result.periods).toHaveLength(1);
    expect(result.state.identities.postedTransactionIds).toHaveLength(0);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("500"))).toBe(true);
  });
  it("preserves thirteen funded installments, split replay and cold process checkpoints without duplicate journals", () => {
    const docs = documents(13, true); publish(docs);
    const f = fixture(15, opening(), docs.map(d => d.issuer.sourceId));
    const result = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(result.periods).toHaveLength(15);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("357"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("870"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toHaveLength(26);
    expect(exportHouseholdReplayCheckpoints(result).some(c => c.state.d2SettlementReceipts !== undefined)).toBe(true);
    const artifact = createPortableHouseholdReplayArtifact(result), restored = restorePortableHouseholdReplayArtifact(artifact);
    for (const index of [1, 7, 13, 14]) {
      const selected = result.periods[index]!.period;
      const full = replayHouseholdForecastWindow(result, selected), cold = replayHouseholdForecastWindow(restored, selected);
      expect(canonicalSerialize(cold.state)).toBe(canonicalSerialize(full.state));
      expect(canonicalSerialize(cold.periods)).toBe(canonicalSerialize(full.periods));
    }
    const directory = mkdtempSync(join(tmpdir(), "pfm-heloc-service-")), path = join(directory, "payload.json");
    try {
      for (const sources of [true, false]) {
        const selected = result.periods[13]!.period, expected = replayHouseholdForecastWindow(result, selected);
        writeFileSync(path, JSON.stringify({ artifact, selected, sources }), "utf8");
        const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { env: { ...process.env, PFM_HELOC_SERVICE_PAYLOAD: path }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
        expect(worker.status, worker.stderr).toBe(0);
        expect(JSON.parse(worker.stdout)).toEqual(sources ? { state: canonicalSerialize(expected.state), periods: canonicalSerialize(expected.periods) } : { rejected: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
    // Publisher originals/history are never copied into participant config or receipts.
    expect(artifact.encoded).not.toContain("Synthetic complete original statement");
    const receipts = Object.values(result.state.d2SettlementReceipts!);
    expect(receipts.every(r => r.kind === "heloc_phase_service" && r.source.originalInputDigest.length === 64)).toBe(true);
    const one = canonicalSerialize(receipts.slice(0, 1)).length;
    expect(canonicalSerialize(receipts).length).toBeLessThan(one * 15);
    expect(canonicalSerialize(f.kernel.executable.participants![0]!.economicInputs).length).toBeLessThan(250);
    const first = docs[0]!;
    publisher.issuer = id => id === first.issuer.sourceId ? { ...first.issuer, version: "changed/v2" } : docs.find(d => d.issuer.sourceId === id)?.issuer;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
    publish(docs); publisher.bank = () => undefined;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
    publish(docs);
    for (const [from, to] of [["heloc_service", "forged_service"], ["bank-approval:month:0", "forged-approval"], ["posted-history:1", "forged-history"]]) {
      const encoded = artifact.encoded.replace(from!, to!);
      expect(encoded).not.toBe(artifact.encoded);
      // Recompute transport integrity: semantic rejection must not rely on SHA
      // or the artifact integrity fingerprint authenticating a publisher.
      expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded,
        integrity: createInputFingerprint({ runContext: f.context, openingState: encoded }) })).toThrow();
    }
    const state = createAuthoritativeState(result.state);
    requalifyD2SettlementReceiptHistory(state, f.context);
    const before = canonicalSerialize(state);
    for (const r of receipts) expect(applyD2SettlementAtomically(state, r, f.context).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(before);
  });
});
