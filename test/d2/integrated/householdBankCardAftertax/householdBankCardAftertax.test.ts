import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { applyD2SettlementAtomically, applyNativeHouseholdOriginalAtomically, createAuthoritativeState,
  d2SettlementPostingRegistration, requalifyD2SettlementReceiptHistory } from "../../../../src/state/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { compileHouseholdKernel, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import type { HouseholdOperationFacts } from "../../../../src/simulation/r3/domainOperations.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { qualifyCardBankSource } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import type { HouseholdBankOriginal } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { attachAftertaxPremiums } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { fixture as legacyCardFixture } from "../cardBank/scenario.js";
import { cardDocument, confirmation, context, control, fixture, ids, install, opening, payable, request, reset, source, sourceId } from "./scenario.js";

install();
beforeEach(reset);
const run = (options: Parameters<typeof fixture>[0] = {}) => {
  const f = fixture(options);
  for (const admitted of f.admissions) expect(admitted.diagnostics).toEqual([]);
  return runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" });
};
const receipt = () => {
  const q = qualifyCardBankSource(sourceId, context());
  if (q.status !== "qualified") throw new Error(q.reason);
  return q.receipt;
};
describe("#280 authentic issuer and elected aftertax premium household BANK debits", () => {
  it.each([{ card: true, premium: false }, { card: false, premium: true }, { card: true, premium: true }])("executes independent and combined routes %j", options => {
    const r = run(options);
    expect(r.status, JSON.stringify(r.diagnostics)).toBe("completed");
    const paid = money(options.card ? "200" : "0").plus(money(options.premium ? "300.37" : "0"));
    const expense = money(options.card ? "20" : "0").plus(money(options.premium ? "300.37" : "0"));
    expect(r.state.accounts[ids.bank]!.cash.equals(money("1000").minus(paid))).toBe(true);
    expect(r.periods.reduce((m, p) => m.plus(p.statements.expenses), money("0")).equals(expense)).toBe(true);
    expect(r.periods.every(p => p.statements.income.isZero())).toBe(true);
    const proofs = Object.values(r.state.d2PostedTransactions ?? {});
    expect(proofs).toHaveLength((options.card ? 2 : 0) + (options.premium ? 1 : 0));
    if (options.premium) {
      expect(proofs.find(p => p.registration.kind === "household_domain")!.registration.personId).toBe(ids.other);
      expect(r.state.liabilities[payable]!.balance.isZero()).toBe(true);
    }
    if (options.card) {
      const q = Object.values(r.state.d2SettlementReceipts!)[0]!;
      expect(q.schemaVersion).toBe("d2-shared/settlement-receipt/v2");
      expect(q.nativeHousehold!.original.cashRole).toBe("nonbank");
      expect(q.originalTransaction.legs.some(l => l.type === "cash")).toBe(false);
      expect(q.nativeHousehold!.settlement.context.personId).toBe(ids.person);
      expect(r.state.liabilities[ids.card]!.balance.equals(money("820"))).toBe(true);
    }
  });
  it("matches summary and detail without turning the subsidy into household cash or pretax payroll", () => {
    const f = fixture(), detail = runHouseholdKernel({ kernel: f.kernel, runContext: f.context, resultTier: "detail" }),
      summary = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(detail.status).toBe("completed");
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
    expect(Object.values(detail.state.d2PostedTransactions!).some(p => p.registration.kind === "payroll_health_deduction")).toBe(false);
    expect(detail.periods.flatMap(p => p.transactions).map(t => t.type)).toEqual([
      "issuer_card_charge", "funded_card_payment", "expense_recognition", "expense_settlement",
    ]);
    expect(canonicalSerialize(f.state)).toBe(canonicalSerialize(opening()));
  });
  it("preserves full unfunded recognition and the issuer charge without debiting cash", () => {
    const r = run({ cash: "10" });
    expect(r.status).toBe("completed");
    expect(r.state.accounts[ids.bank]!.cash.equals(money("10"))).toBe(true);
    expect(r.state.liabilities[ids.card]!.balance.equals(money("1020"))).toBe(true);
    expect(r.state.liabilities[payable]!.balance.equals(money("300.37"))).toBe(true);
    expect(r.state.identities.settlementIds).toEqual([]);
    expect(Object.values(r.state.d2PostedTransactions!)).toHaveLength(1);
  });
  it.each(["owner", "member", "account", "permission", "revoked", "future"])("rejects BANK %s for both routes", mode => {
    control.bank = d => ({ ...d, originals: d.originals.map<HouseholdBankOriginal>(o => mode === "owner" && o.kind === "account"
      ? { ...o, owner: { kind: "person", id: ids.person } } : mode === "member" && o.kind === "membership"
        ? { ...o, personId: ids.household } : mode === "account" && o.kind === "account" ? { ...o, bankAccountId: ids.card }
          : mode === "permission" && o.kind === "permission" ? { ...o, direction: "credit" }
            : mode === "revoked" && o.kind === "permission" ? { ...o, status: "revoked" }
              : mode === "future" ? { ...o, publishedAt: instant("2029-01-01T00:00:00.000Z"), knownAt: instant("2029-01-01T00:00:00.000Z") } : o) });
    const f = fixture();
    expect(f.admissions[0]!.admittedOperationIds).toEqual([]);
    expect(qualifyCardBankSource(sourceId, context()).status).toBe("incomplete");
    expect(canonicalSerialize(f.state)).toBe(canonicalSerialize(opening()));
  });
  it.each(["missing", "quote", "late", "payer", "plan"])("rejects changed or unavailable elected premium %s", mode => {
    control.premium = d => mode === "missing" ? undefined : mode === "late" ? { ...d, knownAt: instant("2026-04-01T00:00:00.000Z") }
      : mode === "payer" ? { ...d, confirmation: { ...d.confirmation, proposal: { ...d.confirmation.proposal, payerId: ids.person } } }
        : { ...d, request: { ...d.request, coverages: d.request.coverages.map(c => mode === "plan" ? { ...c, planId: "changed-plan" }
          : { ...c, quote: { ...c.quote, member: money("301") } }) } };
    const f = fixture({ card: false });
    expect(f.admissions[0]!.admittedOperationIds).toEqual([]);
    expect(f.admissions[0]!.kernel.executable.reconciledOpeningState).toEqual(f.state);
  });
  it("rejects a source race after premium admission with no committed recognition or debit", () => {
    const f = fixture({ card: false });
    expect(f.admissions[0]!.diagnostics).toEqual([]);
    control.premium = () => undefined;
    const r = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(r.status).toBe("incomplete");
    expect(canonicalSerialize(r.state)).toBe(canonicalSerialize(f.state));
  });
  it("rejects duplicate payroll premium evidence for the same plan/member/month", () => {
    const f = fixture({ card: false }), guard = f.kernel.executable.participants![0]!;
    const source = { householdId: ids.household, ownerId: ids.other, planId: "health-plan", coverageId: "elected-coverage",
      periodStart: instant("2026-02-01T00:00:00.000Z"), periodEnd: instant("2026-03-01T00:00:00.000Z") };
    // An intentionally minimal observed proof isolates the guard; the payroll
    // writer's independent financial/source acceptance belongs to its suite.
    const facts = { cash: { payrollWithholding: [{ healthDeduction: { source } }] } } as unknown as HouseholdOperationFacts;
    const descriptor = { id: "payroll", domain: "cash_flow", sequencingInstant: instant("2026-02-10T00:00:00.000Z"),
      dependsOn: [], resourceAccesses: [], traceRefs: [] };
    expect(() => guard.observe!(descriptor, facts, {})).toThrow("DUPLICATE_PREMIUM_PAYROLL_ROUTE");
    expect(canonicalSerialize(f.state)).toBe(canonicalSerialize(opening()));
  });
  it.each(["late", "issuer", "missing"])("rejects unavailable or changed card originals: %s", mode => {
    control.card = d => mode === "missing" ? undefined : mode === "late" ? { ...d, provenance: d.provenance.map(p => ({ ...p,
      knownAt: instant("2026-04-01T00:00:00.000Z") })) } : { ...d, payment: { ...d.payment, issuerId: "different-issuer" } };
    const f = fixture({ premium: false }), r = runHouseholdKernel({ kernel: f.kernel, runContext: f.context });
    expect(r.state.accounts[ids.bank]!.cash.equals(money("1000"))).toBe(true);
    expect(r.state.identities.postedTransactionIds).toHaveLength(0);
  });
  it("rejects an actual BANK owner mismatch before either writer can commit", () => {
    const r = receipt(), state = opening();
    state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, ownerId: ids.person };
    const before = canonicalSerialize(state);
    expect(() => applyNativeHouseholdOriginalAtomically(state, r.originalTransaction, d2SettlementPostingRegistration(r, "original"), context())).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });
  it("rejects a changed issuer and repeated transaction atomically, then treats exact paid replay as idempotent", () => {
    const r = receipt(), state = opening();
    applyNativeHouseholdOriginalAtomically(state, r.originalTransaction, { ...d2SettlementPostingRegistration(r, "original"), operationId: r.originalTransaction.id }, context());
    const before = canonicalSerialize(state);
    control.card = d => ({ ...d, version: "amended" });
    expect(() => applyD2SettlementAtomically(state, r, context())).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
    reset();
    expect(applyD2SettlementAtomically(state, r, context()).status).toBe("committed");
    const paid = canonicalSerialize(state);
    expect(applyD2SettlementAtomically(state, r, context()).status).toBe("already_committed");
    expect(canonicalSerialize(state)).toBe(paid);
    expect(() => applyNativeHouseholdOriginalAtomically(state, r.originalTransaction, d2SettlementPostingRegistration(r, "original"), context())).toThrow();
    expect(canonicalSerialize(state)).toBe(paid);
  });
  it("rejects an unbound household premium and preserves legacy Person receipt bytes", () => {
    const f = fixture({ card: false, premium: false }), c = context();
    const rejected = attachAftertaxPremiums({ kernel: f.kernel, request: request(), asOf: civilDate("2026-03-02"),
      confirmed: [confirmation()], representations: [] });
    expect(rejected.admittedOperationIds).toEqual([]);
    control.legacy = true;
    const legacy = receipt();
    expect(legacy.schemaVersion).toBe("d2-shared/settlement-receipt/v1");
    expect("nativeHousehold" in legacy).toBe(false);
    const old = legacyCardFixture(), result = runHouseholdKernel({ kernel: old.kernel, runContext: old.context });
    expect(result.status).toBe("completed");
    expect(result.state.d2SettlementReceipts![legacy.id]).toEqual(legacy);
    expect(c.asOf).toBe(old.context.asOf);
  });
  it("retains legacy premium journal bytes and exact reattachment without another expense", () => {
    const base = fixture({ card: false, premium: false }), state = opening();
    state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, ownerId: ids.other };
    const kernel = compileHouseholdKernel({ ...base.kernel.executable, reconciledOpeningState: state }, base.context.simulationStart);
    const legacy = attachAftertaxPremiums({ kernel, request: request(), asOf: civilDate("2026-03-02"), confirmed: [confirmation()], representations: [] });
    expect(legacy.diagnostics).toEqual([]);
    const legacyResult = runHouseholdKernel({ kernel: legacy.kernel, runContext: base.context, resultTier: "detail" }), modern = run({ card: false });
    expect(legacyResult.status).toBe("completed");
    expect(legacyResult.periods.flatMap(p => p.transactions)).toEqual(modern.periods.flatMap(p => p.transactions));
    expect(Object.values(legacyResult.state.d2PostedTransactions ?? {})).toHaveLength(0);
    const f = fixture({ card: false });
    const again = attachAftertaxPremiums({ kernel: f.kernel, request: request(), asOf: civilDate("2026-03-02"), runContext: f.context,
      confirmed: [{ ...confirmation(), householdExpenseSource: source() }], representations: [] });
    expect(again.diagnostics).toEqual([]);
    expect(again.kernel).toBe(f.kernel);
  });
  it("reauthenticates cold portable replay and rejects missing or changed sources", () => {
    const r = run(), artifact = createPortableHouseholdReplayArtifact(r);
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).not.toThrow();
    const dir = mkdtempSync(join(tmpdir(), "pfm-stage-e-")), path = join(dir, "payload.json");
    try {
      for (const mode of ["valid", "missing", "changed", "revoked"] as const) {
        writeFileSync(path, JSON.stringify({ artifact, selected: r.periods.at(-1)!.period, mode }));
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 15_000,
          env: { ...process.env, PFM_STAGE_E_PAYLOAD: path } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(mode === "valid" ? { state: canonicalSerialize(r.state) } : { rejected: true });
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    control.premium = () => undefined;
    expect(() => createAuthoritativeState(r.state)).toThrow();
    expect(() => requalifyD2SettlementReceiptHistory(r.state, context())).toThrow();
  }, 30_000);
  it("keeps 1/12/24 actual premium proofs compact and linear without copying original catalogs", () => {
    const sizes = [];
    for (const count of [1, 12, 24]) {
      reset();
      const r = run({ card: false, months: count + 1, cash: "10000" });
      expect(r.status, JSON.stringify(r.diagnostics)).toBe("completed");
      expect(Object.values(r.state.d2PostedTransactions!)).toHaveLength(count);
      const encoded = JSON.stringify(r.state.d2PostedTransactions);
      expect(encoded).not.toContain("coverages");
      expect(encoded).not.toContain("amountBasis");
      expect(encoded).not.toContain("effectiveUntil");
      expect(encoded).not.toContain("household-expense-original/v1");
      sizes.push(encoded.length);
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[1]! * 2.1);
  });
});
