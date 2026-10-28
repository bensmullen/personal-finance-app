import { describe, expect, it } from "vitest";
import { money } from "../../../../../src/values/index.js";
import { civilDate as date } from "../../../../../src/time/index.js";
import { bindPensionOriginals, pensionOriginalDigest, type PensionOriginalInventory }
  from "../../../../../src/simulation/d2/retirement/benefits/pensionOriginalBinding/index.js";
import { at, book, ports, requestFor, type Book } from "./fixtures.js";

const bind = (b: Book, months = 2) => bindPensionOriginals(requestFor([b], months), ports([b]).providers);
const codes = (r: ReturnType<typeof bind>) => r.coverage.flatMap(c => c.diagnosticCodes);
const bankChange = (b: Book, change: Partial<Book["bank"]["payload"]["confirmations"][number]>, n = 0) => {
  b.bank = { ...b.bank, payload: { ...b.bank.payload, confirmations: b.bank.payload.confirmations.map((c, i) =>
    i === n ? { ...c, ...change } : c) } };
};

describe("#146 original pension provider boundary: synthetic S8 conditional evidence", () => {
  it("preserves independently authored 123456 cents and 61728 survivor cents", () => {
    const b = book(2, true), p = ports([b]), before = JSON.stringify(b);
    const r = bindPensionOriginals(requestFor([b]), p.providers);
    expect(codes(r)).toEqual([]);
    expect(r.intents.map(i => [i.actorId, i.grossAmount.amount.toString(), i.netAmount.amount.toString()]))
      .toEqual([["participant", "1234.56", "1234.56"], ["survivor", "617.28", "617.28"]]);
    expect(r.intents.map(i => [i.claimId, i.paymentId, i.receiptId, i.entitlementId, i.effectiveAt])).toEqual([
      ['["d2-quoted-benefit/v1","household","entitlement","participant","2026-01-15"]', "payment:0", "receipt:0", "entitlement", "2026-01-15"],
      ['["d2-quoted-benefit/v1","household","entitlement","survivor","2026-02-15"]', "payment:1", "receipt:1", "entitlement", "2026-02-15"],
    ]);
    expect(r.originals).toHaveLength(4);
    for (const i of r.intents) {
      expect(i).toMatchObject({ committed: false, postable: false, tax: "incomplete", bankSettlement: "incomplete" });
      expect(i.sourceRefs).toHaveLength(4);
      expect(i.sourceRefs.every(ref => r.originals.some(o => o.referenceId === ref))).toBe(true);
      for (const field of ["source", "cashDelta", "assetDelta", "taxable", "withholdingCredit", "installments", "award"])
        expect(i).not.toHaveProperty(field);
    }
    expect([...p.calls.values()]).toEqual([2, 2, 2, 2]);
    expect(Object.isFrozen(r.intents[0]!.sourceRefs)).toBe(true);
    expect(JSON.stringify(b)).toBe(before);
  });
  it.each(["plan", "bank", "legal", "history"] as const)("requires independent %s provider", role => {
    const b = book(), p = ports([b]);
    const r = bindPensionOriginals(requestFor([b]), p.providers.filter(p => p.role !== role));
    expect(r.intents).toEqual([]); expect(codes(r)).toContain("MISSING_PROVIDER");
  });
  it("does not accept a digest or unverified catalog as publisher authentication", () => {
    const b = book(), r = bindPensionOriginals(requestFor([b]), ports([b], h => ({ ...h, authentication: "unverified" })).providers);
    expect(r.intents).toEqual([]); expect(codes(r)).toContain("UNQUALIFIED_INVENTORY");
    expect(bindPensionOriginals(requestFor([b])).intents).toEqual([]);
  });
  it.each([
    ["wrong recipient", { recipientPersonId: "stranger" }, "WRONG_RECIPIENT"],
    ["nonzero withholding", { withholding: [{ jurisdiction: "US", amount: money("1.00") }] }, "UNSUPPORTED_WITHHOLDING"],
    ["unknown withholding", { withholding: [] }, "UNSUPPORTED_WITHHOLDING"],
    ["gross/net mismatch", { net: money("1234.55") }, "WRONG_AMOUNT"],
    ["wrong gross", { gross: money("1234.57") }, "WRONG_AMOUNT"],
  ] as const)("rejects %s independently of a matching digest", (_label, change, code) => {
    const b = book(); bankChange(b, change);
    const r = bind(b); expect(codes(r)).toContain(code);
    expect(r.intents.map(i => i.effectiveAt)).toEqual(["2026-02-15"]);
  });
  it("requires explicit withholding inventory rather than assuming omitted means zero", () => {
    const b = book(), { withholding: _w, ...c } = b.bank.payload.confirmations[0]!;
    b.bank = { ...b.bank, payload: { ...b.bank.payload, confirmations: [c, b.bank.payload.confirmations[1]!] } };
    expect(codes(bind(b))).toContain("UNSUPPORTED_WITHHOLDING");
  });
  it("binds actual worker, beneficiary, BANK publisher and legal owner", () => {
    const mutations: ((b: Book) => void)[] = [
      b => { b.plan = { ...b.plan, payload: { ...b.plan.payload, award: { ...b.plan.payload.award, workerRecordPersonId: "stranger" } } }; },
      b => { const a = b.plan.payload.award; b.plan = { ...b.plan, payload: { ...b.plan.payload, award: { ...a,
        election: { ...a.election!, beneficiaryId: "detached" } } } }; },
      b => { b.bank = { ...b.bank, payload: { ...b.bank.payload, signedBy: "wrong-publisher" } }; },
      b => { bankChange(b, { route: { ...b.bank.payload.confirmations[0]!.route, institutionId: "wrong-bank" } }); },
      b => { bankChange(b, { route: { ...b.bank.payload.confirmations[0]!.route, ownerPersonIds: ["stranger"] } }); },
      b => { b.legal = { ...b.legal, payload: { instructions: b.legal.payload.instructions.map(i => ({ ...i, workerRecordPersonId: "stranger" })) } }; },
    ];
    for (const mutate of mutations) { const b = book(); mutate(b); expect(bind(b).intents).toEqual([]); }
    const b = book(); bankChange(b, { route: { ...b.bank.payload.confirmations[0]!.route, kind: "unmapped" } });
    expect(codes(bind(b))).toContain("UNMAPPED_BANK_ROUTE");
  });
  it("refuses unsupported employee basis and formula taxation", () => {
    const b = book(); b.plan = { ...b.plan, payload: { ...b.plan.payload, employeeBasis: "unresolved" } };
    expect(bind(b).intents).toEqual([]); expect(codes(bind(b))).toContain("UNSUPPORTED_PENSION");
    b.plan = { ...b.plan, payload: { ...b.plan.payload, employeeBasis: "none", paymentMethod: "unsupported" } };
    expect(codes(bind(b))).toContain("UNSUPPORTED_PENSION");
  });
  it.each(["paymentId", "receiptId", "confirmationId", "fundingId"] as const)("rejects both reused %s occurrences", field => {
    const b = book(); bankChange(b, { [field]: b.bank.payload.confirmations[1]![field] });
    expect(bind(b).intents).toEqual([]); expect(codes(bind(b))).toContain("CONFLICTING_HISTORY");
  });
  it("requires earlier unpaid history even for a later display horizon", () => {
    const b = book(); b.history = { ...b.history, payload: { ...b.history.payload, installments: [] } };
    const request = requestFor([b]);
    const r = bindPensionOriginals({ ...request, horizon: { ...request.horizon, start: at(1, 1) } }, ports([b]).providers);
    expect(r.intents).toEqual([]); expect(codes(r)).toContain("CONFLICTING_HISTORY");
  });
  it("rejects contradictory history symmetrically, preserving unrelated persons", () => {
    const a = book(), b = book(2, false, ":B"), c = book(2, false, ":C");
    // A's history attempts to consume B's current receipt. A is invalid itself;
    // its conflicting inventory must still invalidate B, never first wins.
    const row = a.history.payload.installments[0]!;
    a.history = { ...a.history, payload: { ...a.history.payload, installments: [{ ...row, recipientPersonId: "wrong",
      status: "paid", paymentId: "other", receiptId: b.bank.payload.confirmations[0]!.receiptId }, a.history.payload.installments[1]!] } };
    const books = [a, b, c], req = requestFor(books), p = ports(books);
    const r = bindPensionOriginals(req, p.providers);
    expect(r.intents.map(i => i.actorId)).toEqual(["participant:C", "participant:C"]);
    expect(bindPensionOriginals({ ...req, claims: [...req.claims].reverse() }, [...p.providers].reverse())).toEqual(r);
  });
  it("accounts for earlier paid and exhausted installments without consuming a new one", () => {
    for (const status of ["paid", "exhausted"] as const) {
      const b = book(), rows = b.history.payload.installments;
      b.history = { ...b.history, payload: { ...b.history.payload, installments: [{ ...rows[0]!, status,
        paymentId: "payment:0", receiptId: "receipt:0" }, rows[1]!] } };
      expect(bind(b).intents.map(i => i.effectiveAt)).toEqual(["2026-02-15"]);
      expect(codes(bind(b))).toContain("REUSED_PAYMENT_IDENTITY");
    }
  });
  it("rejects exhausted current claims even with different historic receipt IDs", () => {
    const b = book(1); b.history = { ...b.history, payload: { ...b.history.payload, installments: [{
      ...b.history.payload.installments[0]!, status: "exhausted", paymentId: "old", receiptId: "old-receipt" }] } };
    expect(bind(b, 1).intents).toEqual([]); expect(codes(bind(b, 1))).toContain("EXHAUSTED_CLAIM");
  });
  it.each(["amended", "withdrawn", "superseding"] as const)("refuses later-known %s revisions", kind => {
    const b = book(); const p = ports([b], h => h.query.role !== "plan" ? h : { ...h, revisions: [{
      originalId: b.plan.originalId, revisionId: "revision", publishedAt: at(0), knownAt: at(4), kind }] });
    const r = bindPensionOriginals(requestFor([b]), p.providers);
    expect(r.intents).toEqual([]); expect(codes(r)).toContain("KNOWN_REVISION");
  });
  it("rejects replaced, withdrawn and competing originals including unpinned versions", () => {
    const b = book();
    const changes: ((h: PensionOriginalInventory) => PensionOriginalInventory)[] = [
      h => ({ ...h, originals: h.originals.map(o => ({ ...o, status: "withdrawn" })) }),
      h => ({ ...h, originals: h.originals.map(o => ({ ...o, kind: "amended", revisesOriginalId: "prior" })) }),
      h => ({ ...h, originals: [...h.originals, { ...h.originals[0]!, originalId: "other", version: "2" }] }),
    ];
    for (const change of changes) expect(bindPensionOriginals(requestFor([b]), ports([b], change).providers).intents).toEqual([]);
    const req = requestFor([b]);
    expect(bindPensionOriginals({ ...req, claims: [req.claims[0]!, req.claims[0]!] }, ports([b]).providers).intents).toEqual([]);
  });
  it("rejects delayed law, future-known BANK documents and source publications", () => {
    const b = book(); bankChange(b, { knownAt: at(0, 16) });
    expect(bind(b).intents).toEqual([]);
    const c = book(), a = c.plan.payload.award;
    c.plan = { ...c.plan, payload: { ...c.plan.payload, award: { ...a,
      election: { ...a.election!, source: { ...a.election!.source, asOf: at(0, 16) } } } } };
    expect(bind(c).intents).toEqual([]);
    const d = book(); d.legal = { ...d.legal, publishedAt: at(0, 16), knownAt: at(0, 16) };
    expect(bind(d).intents.map(i => i.effectiveAt)).toEqual(["2026-02-15"]);
  });
  it.each(["plan", "bank", "legal", "history"] as const)("discards a claim after %s second-read withdrawal", role => {
    const b = book(), p = ports([b], (h, count) => count === 2 && h.query.role === role ? {
      ...h, originals: h.originals.map(o => ({ ...o, status: "withdrawn" })) } : h);
    const r = bindPensionOriginals(requestFor([b]), p.providers);
    expect(r.intents).toEqual([]); expect(codes(r)).toContain("SOURCE_RACE");
    expect([...p.calls.values()]).toEqual([2, 2, 2, 2]);
  });
  it("witnesses full original amounts/history but tolerates evidence-set permutations", () => {
    const b = book(), original = pensionOriginalDigest(b.bank);
    b.bank = { ...b.bank, payload: { ...b.bank.payload, confirmations: [...b.bank.payload.confirmations].reverse() } };
    expect(pensionOriginalDigest(b.bank)).toBe(original);
    bankChange(b, { net: money("1.00") }); expect(pensionOriginalDigest(b.bank)).not.toBe(original);
    const c = book(), req = requestFor([c]);
    c.history = { ...c.history, payload: { ...c.history.payload, installments: c.history.payload.installments.slice(1) } };
    expect(codes(bindPensionOriginals(req, ports([c]).providers))).toContain("ORIGINAL_CHANGED");
  });
  it("preserves exact identities/cents across horizon extension and source ordering", () => {
    const b = book(12, true), p = ports([b]), request = requestFor([b], 1);
    const short = bindPensionOriginals(request, p.providers), long = bind(b, 12);
    expect(long.intents).toHaveLength(12); expect(short.intents).toHaveLength(1);
    expect(long.intents.find(i => i.effectiveAt === at(0))).toEqual(short.intents[0]);
    const reversed = { ...request, claims: request.claims.map(c => ({ ...c, pins: [...c.pins].reverse() })) };
    b.bank = { ...b.bank, payload: { ...b.bank.payload, confirmations: [...b.bank.payload.confirmations].reverse() } };
    b.legal = { ...b.legal, payload: { instructions: [...b.legal.payload.instructions].reverse() } };
    b.history = { ...b.history, payload: { ...b.history.payload, installments: [...b.history.payload.installments].reverse() } };
    expect(bindPensionOriginals(reversed, [...p.providers].reverse())).toEqual(short);
  });
  it("keeps 1/12/120 provider calls constant and serialized output linear", () => {
    const sizes: number[] = [];
    const fetchedSizes: number[] = [];
    for (const months of [1, 12, 120]) {
      const b = book(months), p = ports([b]), r = bindPensionOriginals(requestFor([b], months), p.providers);
      expect(codes(r)).toEqual([]); expect(r.intents).toHaveLength(months);
      expect([...p.calls.values()]).toEqual([2, 2, 2, 2]); expect(r.originals).toHaveLength(4);
      const fetchedSize = [...p.payloadBytes.values()].reduce((sum, size) => sum + size, 0);
      fetchedSizes.push(fetchedSize); expect(fetchedSize).toBeLessThan(6000 * months + 20000);
      const serialized = JSON.stringify(r); sizes.push(serialized.length);
      expect(serialized).not.toContain('"installments"'); expect(serialized).not.toContain('"coveredHorizon"');
      expect(serialized).not.toContain('"confirmations"');
      expect(serialized.length).toBeLessThan(7000 * months + 6000);
    }
    expect(sizes[2]!).toBeLessThan(sizes[1]! * 11);
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 12);
    expect(fetchedSizes[2]!).toBeLessThan(fetchedSizes[1]! * 11);
    expect(fetchedSizes[1]!).toBeLessThan(fetchedSizes[0]! * 12);
  });
  it("isolates a second-read source race to the affected entitlement", () => {
    const a = book(), b = book(2, false, ":B"), books = [a, b];
    const p = ports(books, (h, count) => count === 2 && h.query.role === "legal" &&
      h.query.entitlementId === a.plan.identity.entitlementId ? { ...h, originals: [] } : h);
    const r = bindPensionOriginals(requestFor(books), p.providers);
    expect(r.intents.map(i => i.actorId)).toEqual(["participant:B", "participant:B"]);
    expect(codes(r)).toContain("SOURCE_RACE");
  });
  it("rejects non-authoritative query echoes and incomplete inventories", () => {
    const b = book();
    for (const change of [
      (h: PensionOriginalInventory): PensionOriginalInventory => ({ ...h, completeness: "unknown" }),
      (h: PensionOriginalInventory): PensionOriginalInventory => ({ ...h, query: { ...h.query, householdId: "other" } }),
      (h: PensionOriginalInventory): PensionOriginalInventory => ({ ...h, completeThrough: date("2026-01-01") }),
    ]) expect(bindPensionOriginals(requestFor([b]), ports([b], change).providers).intents).toEqual([]);
  });
});
