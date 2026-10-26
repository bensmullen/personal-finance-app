import { civilDate, type CivilDate } from "../../../../time/index.js";
import { decimal, Money, RoundingPolicy, type Currency, type RoundingMode } from "../../../../values/index.js";

/** Private d2-shared/v1 proposal seam. No posting, capacity or tax-state writer. */
export interface IraSource {
  readonly sourceId: string;
  readonly sourcePublication: string;
  readonly personId: string;
  /** null means a person-wide return/inventory/rule fact. */
  readonly accountId: string | null;
  readonly taxYear: number;
  readonly asOf: CivilDate;
  readonly ruleSnapshotId: string;
  readonly verification: "verified" | "unverified";
  readonly projectionStatus: "observed" | "explicit_projected" | "unavailable";
}
export interface IraRules {
  readonly source: IraSource;
  readonly jurisdiction: string;
  readonly version: string;
  readonly ruleFamily: "form_8606";
  readonly effectivePeriod: { readonly start: CivilDate; readonly endExclusive: CivilDate };
  readonly filingStatus: string;
  /** Only this explicitly attested, restricted model is implemented. Other
   * Form-8606 line adjustments/ratio precision conventions are not inferred. */
  readonly model: "aggregate_basis_over_year_end_plus_distributions" | "unsupported";
  readonly ratio: "exact_capped_at_one";
  readonly annualRounding: RoundingMode;
  readonly allocation: "largest_remainder_operation_id";
}
export type IraFamily = "traditional_ira" | "sep_ira" | "simple_ira" | "roth_ira" | "workplace_plan";
/** Attribution only; yearChain additionally requires independent history authority. */
export interface IraOriginalReturnProvenance {
  readonly personId: string;
  readonly taxYear: number;
  readonly filingId: string;
  readonly filingVersion: string;
  readonly filingKind: "original" | "amended" | "unknown";
  readonly filingStatus: string;
  readonly filedAt: CivilDate;
  readonly publishedAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly revisesFilingId: string | null;
  readonly carryForwardBasis: Money;
  readonly source: IraSource;
  readonly legalSnapshot: IraRules;
}
export interface IraAccount {
  readonly accountId: string;
  readonly ownerId: string;
  readonly family: IraFamily;
  readonly source: IraSource;
  /** Required for EVERY eligible IRA, including closed/zero accounts. */
  readonly december31Value?: { readonly amount: Money; readonly at: CivilDate; readonly source: IraSource };
}
export interface IraConversionRequest {
  readonly operationId: string;
  /** Stable underlying transaction identity prevents renamed-request replay. */
  readonly transactionId: string;
  readonly personId: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly gross: Money;
  readonly kind: "ira_roth_conversion" | "regular_ira_contribution" | "direct_rollover" | "mega_backdoor" | "rmd";
  readonly source: IraSource;
  /** Permission attests this account's legal/plan eligibility at effectiveAt. */
  readonly authorization: {
    readonly permitted: "yes" | "no" | "unknown";
    readonly effectivePeriod: { readonly start: CivilDate; readonly endExclusive: CivilDate };
    readonly source: IraSource;
  };
}
export interface IraDistribution {
  readonly operationId: string;
  readonly transactionId: string;
  readonly sourceAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly gross: Money;
  readonly kind: "ira_roth_conversion" | "ordinary_distribution" | "rmd" | "direct_rollover" | "unsupported";
  readonly source: IraSource;
}
export interface IraYearInput {
  readonly personId: string;
  readonly taxYear: number;
  readonly currency: Currency;
  readonly knownAt: CivilDate;
  readonly asOf: CivilDate;
  readonly filingStatus: string;
  readonly stateJurisdiction: string | null;
  readonly rules?: IraRules;
  readonly accounts: readonly IraAccount[];
  readonly requests: readonly IraConversionRequest[];
  /** Requests reference this complete register, never add to it a second time. */
  readonly distributions: readonly IraDistribution[];
  readonly openingBasis?: {
    readonly amount: Money;
    readonly priorTaxYear: number;
    readonly returnStatus: "verified_return" | "verified_no_prior_basis" | "unknown";
    readonly source: IraSource;
    readonly originalReturn?: IraOriginalReturnProvenance;
  };
  readonly basisAdditions: readonly {
    readonly operationId: string;
    readonly transactionId: string;
    readonly accountId: string;
    readonly effectiveAt: CivilDate;
    readonly kind: "qualified_nondeductible_regular_contribution";
    readonly amount: Money;
    readonly source: IraSource;
  }[];
  readonly closeout?: {
    readonly source: IraSource;
    readonly originalReturn?: IraOriginalReturnProvenance;
    /** Includes closed accounts; attests all Traditional, SEP and SIMPLE IRAs. */
    readonly eligibleAccountIds: readonly string[];
    readonly distributionOperationIds: readonly string[];
    readonly basisAdditionOperationIds: readonly string[];
    readonly inventory: "complete" | "unknown";
    readonly distributions: "complete" | "unknown";
    readonly basisAdditions: "complete" | "unknown";
    readonly legalBasisModel: "supported_without_special_adjustments" | "unknown";
    readonly outstandingRollovers: "none" | "present" | "unknown";
    readonly otherAdjustments: "none" | "present" | "unknown";
  };
}
export interface IraDiagnostic {
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly personId: string;
  readonly taxYear: number;
  readonly affectedAccountId: string | null;
  readonly period: { readonly start: CivilDate; readonly endExclusive: CivilDate };
  readonly affectedOutput: "ira_conversion_tax_character";
  readonly coverage: "incomplete";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string | null;
  readonly traceRefs: readonly string[];
}
export interface IraCharacterProposal {
  readonly seam: "S3/S6";
  readonly committed: false;
  readonly postable: false;
  readonly operationId: string;
  readonly transactionId: string;
  readonly personId: string;
  readonly taxYear: number;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly effectiveAt: CivilDate;
  readonly jurisdiction: string;
  readonly lawVersion: string;
  readonly ruleSnapshotId: string;
  readonly incomeCharacter: "ira_roth_conversion";
  readonly gross: Money;
  readonly taxable: Money;
  readonly basisRecovered: Money;
  readonly traceRefs: readonly string[];
}
export interface IraBasisProposal {
  readonly seam: "S5";
  readonly committed: false;
  readonly postable: false;
  readonly personId: string;
  readonly taxYear: number;
  readonly ruleSnapshotId: string;
  readonly availableBasis: Money;
  readonly december31Value: Money;
  readonly annualDistributions: Money;
  readonly denominator: Money;
  readonly annualBasisRecovered: Money;
  readonly carryForwardBasis: Money;
  /** Includes ordinary distributions/RMDs to reconcile the full pool. */
  readonly allocations: readonly { readonly operationId: string; readonly gross: Money; readonly basisRecovered: Money; readonly taxable: Money }[];
  readonly traceRefs: readonly string[];
}
export interface IraYearEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  /** FINAL describes annual character only, never liability or posting. */
  readonly yearStatus: "FINAL" | "incomplete";
  readonly proposals: readonly IraCharacterProposal[];
  readonly basisProposals: readonly IraBasisProposal[];
  readonly diagnostics: readonly IraDiagnostic[];
  readonly accountYearCoverage: readonly {
    readonly accountId: string;
    readonly personId: string;
    readonly taxYear: number;
    readonly period: { readonly start: CivilDate; readonly endExclusive: CivilDate };
    readonly iraCharacter: "complete" | "incomplete";
    readonly federalTax: "incomplete";
    readonly stateTax: "incomplete";
    readonly funding: "incomplete";
    readonly postings: "not_applicable";
    readonly traceRefs: readonly string[];
  }[];
}

const eligible = (a: IraAccount): boolean => ["traditional_ira", "sep_ira", "simple_ira"].includes(a.family);
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
class Incomplete extends Error {
  constructor(readonly code: string, readonly path: string, readonly account: string | null, readonly source?: IraSource) { super(code); }
}

/** One person/tax year, all-or-none, read-only. Re-evaluation replaces the prior
 * proposal keyed by person/year/snapshot; it never increments committed basis.
 * Unsupported legal models stop before numeric character leaves this seam. */
export function evaluateIraConversionYear(input: IraYearInput): IraYearEvaluation {
  const diagnostics: IraDiagnostic[] = [];
  const refs = new Set<string>();
  const year = input.taxYear;
  const period = { start: `${year}-01-01` as CivilDate, endExclusive: `${year + 1}-01-01` as CivilDate };
  const closeDate = `${year}-12-31` as CivilDate;
  const need = (ok: boolean, code: string, path: string, account: string | null = null, source?: IraSource): void => {
    if (!ok) throw new Incomplete(code, path, account, source);
  };
  const date = (d: CivilDate, path: string): void => {
    try { civilDate(d); } catch { throw new Incomplete("INVALID_DATE", path, null); }
  };
  const inYear = (d: CivilDate, path: string): void => {
    date(d, path); need(d >= period.start && d < period.endExclusive, "OUTSIDE_TAX_YEAR", path);
  };
  const exact = (m: Money, path: string): void => {
    need(m.currency.equals(input.currency), "CURRENCY_MISMATCH", path);
    need(!m.isNegative() && m.amount.fitsScale(input.currency.minorUnitScale), "INVALID_EXACT_MONEY", path);
  };
  const source = (s: IraSource, path: string, account: string | null, factYear = year,
    snapshotId = input.rules?.source.ruleSnapshotId): void => {
    need(Boolean(s), "MISSING_SOURCE", path, account);
    need([s.sourceId, s.sourcePublication, s.ruleSnapshotId].every(text), "MISSING_SOURCE_IDENTITY", path, account, s);
    refs.add(s.sourceId);
    need(s.personId === input.personId && s.accountId === account && s.taxYear === factYear, "SOURCE_SCOPE_MISMATCH", path, account, s);
    date(s.asOf, path);
    need(s.verification === "verified" && s.projectionStatus === "observed" && s.asOf <= input.knownAt && s.asOf <= input.asOf,
      "UNVERIFIED_PROJECTED_OR_FUTURE_SOURCE", path, account, s);
    need(s.ruleSnapshotId === snapshotId, "MIXED_RULE_SNAPSHOT", path, account, s);
  };
  const original = (p: IraOriginalReturnProvenance, s: IraSource, factYear: number, amount: Money, path: string): void => {
    const rule = p.legalSnapshot;
    need(Boolean(rule), "MISSING_ORIGINAL_RETURN_RULE", path);
    source(p.source, path, null, factYear, rule.source.ruleSnapshotId);
    source(rule.source, `${path}.legalSnapshot`, null, factYear, rule.source.ruleSnapshotId);
    for (const d of [p.filedAt, p.publishedAt, p.knownAt, rule.effectivePeriod.start, rule.effectivePeriod.endExclusive]) date(d, path);
    exact(p.carryForwardBasis, path);
    need(p.personId === input.personId && p.taxYear === factYear && [p.filingId, p.filingVersion, p.filingStatus].every(text) &&
      p.filingKind === "original" && p.revisesFilingId === null && p.carryForwardBasis.equals(amount) &&
      p.filedAt >= `${factYear + 1}-01-01` && p.filedAt <= p.publishedAt && p.publishedAt <= p.knownAt &&
      p.knownAt <= input.knownAt && p.publishedAt <= input.asOf && p.source.asOf >= p.publishedAt &&
      p.source.sourceId === s.sourceId && p.source.sourcePublication === s.sourcePublication &&
      p.source.asOf === s.asOf && p.source.ruleSnapshotId === s.ruleSnapshotId &&
      rule.source.asOf <= p.filedAt && rule.filingStatus === p.filingStatus &&
      rule.effectivePeriod.start <= `${factYear}-01-01` && rule.effectivePeriod.endExclusive >= `${factYear + 1}-01-01` &&
      [rule.jurisdiction, rule.version].every(text) && rule.ruleFamily === "form_8606" &&
      rule.model === "aggregate_basis_over_year_end_plus_distributions" && rule.ratio === "exact_capped_at_one" &&
      rule.allocation === "largest_remainder_operation_id" && ["half_up", "half_even", "toward_zero"].includes(rule.annualRounding),
      "UNQUALIFIED_ORIGINAL_RETURN", path, null, s);
    if (factYear === year) {
      const current = input.rules!;
      need(rule.source.sourceId === current.source.sourceId && rule.source.sourcePublication === current.source.sourcePublication &&
        rule.source.asOf === current.source.asOf && rule.source.ruleSnapshotId === current.source.ruleSnapshotId &&
        rule.jurisdiction === current.jurisdiction && rule.version === current.version && rule.filingStatus === current.filingStatus &&
        rule.effectivePeriod.start === current.effectivePeriod.start && rule.effectivePeriod.endExclusive === current.effectivePeriod.endExclusive &&
        rule.annualRounding === current.annualRounding, "CONFLICTING_ORIGINAL_RETURN_RULE", path, null, s);
    }
  };
  const matchIds = (attested: readonly string[], actual: readonly string[], path: string): void => {
    need(new Set(attested).size === attested.length && attested.length === actual.length && actual.every(id => attested.includes(id)),
      "INCOMPLETE_OR_CONFLICTING_CLOSEOUT_REGISTER", path);
  };
  let proposals: IraCharacterProposal[] = [], basisProposals: IraBasisProposal[] = [];
  try {
    need(text(input.personId) && Number.isSafeInteger(year) && year >= 1000 && year < 9999, "INVALID_PERSON_OR_YEAR", "year");
    date(input.knownAt, "knownAt"); date(input.asOf, "asOf");
    need(input.asOf <= input.knownAt, "ASOF_AFTER_KNOWN_AT", "asOf");
    need(input.accounts.length <= 512 && input.distributions.length <= 10000 && input.requests.length <= 512 && input.basisAdditions.length <= 512,
      "INPUT_LIMIT", "year");
    const rules = input.rules;
    if (!rules) throw new Incomplete("MISSING_EFFECTIVE_FORM_8606_RULE", "rules", null);
    source(rules.source, "rules", null);
    need([rules.jurisdiction, rules.version, rules.filingStatus].every(text) && rules.filingStatus === input.filingStatus,
      "MISSING_OR_MISMATCHED_FILING_CONTEXT", "rules", null, rules.source);
    date(rules.effectivePeriod.start, "rules.effectivePeriod"); date(rules.effectivePeriod.endExclusive, "rules.effectivePeriod");
    need(rules.effectivePeriod.start <= period.start && rules.effectivePeriod.endExclusive >= period.endExclusive,
      "UNCOVERED_RULE_PERIOD", "rules", null, rules.source);
    need(rules.ruleFamily === "form_8606" && rules.model === "aggregate_basis_over_year_end_plus_distributions" &&
      rules.ratio === "exact_capped_at_one" && rules.allocation === "largest_remainder_operation_id" &&
      ["half_up", "half_even", "toward_zero"].includes(rules.annualRounding), "UNSUPPORTED_FORM_8606_CONVENTION", "rules", null, rules.source);
    need(new Set(input.accounts.map(a => a.accountId)).size === input.accounts.length, "DUPLICATE_ACCOUNT", "accounts");
    const accounts = [...input.accounts].sort((a, b) => compareId(a.accountId, b.accountId));
    for (const a of accounts) {
      need(text(a.accountId) && a.ownerId === input.personId, "ACCOUNT_OWNER_MISMATCH", `accounts.${a.accountId}`, a.accountId, a.source);
      source(a.source, `accounts.${a.accountId}`, a.accountId);
      need(["traditional_ira", "sep_ira", "simple_ira", "roth_ira", "workplace_plan"].includes(a.family), "UNSUPPORTED_ACCOUNT_FAMILY", `accounts.${a.accountId}`, a.accountId, a.source);
    }
    const operations = [...input.distributions, ...input.basisAdditions];
    need(operations.every(o => text(o.operationId) && text(o.transactionId)) &&
      new Set(operations.map(o => o.operationId)).size === operations.length && new Set(operations.map(o => o.transactionId)).size === operations.length,
      "DUPLICATE_OR_MISSING_ANNUAL_OPERATION", "distributions/basisAdditions");
    need(input.requests.every(r => text(r.operationId) && text(r.transactionId)) &&
      new Set(input.requests.map(r => r.operationId)).size === input.requests.length && new Set(input.requests.map(r => r.transactionId)).size === input.requests.length,
      "DUPLICATE_OR_MISSING_REQUEST", "requests");
    const account = (id: string, path: string): IraAccount => {
      const a = accounts.find(a => a.accountId === id);
      need(Boolean(a), "MISSING_ACCOUNT", path, id);
      return a!;
    };
    for (const r of [...input.requests].sort((a, b) => compareId(a.operationId, b.operationId))) {
      const path = `requests.${r.operationId}`;
      source(r.source, path, r.sourceAccountId); inYear(r.effectiveAt, path); exact(r.gross, path);
      need(r.source.asOf >= r.effectiveAt, "OBSERVATION_PRECEDES_OPERATION", path, r.sourceAccountId, r.source);
      need(r.personId === input.personId, "REQUEST_OWNER_MISMATCH", path, r.sourceAccountId, r.source);
      need(r.kind === "ira_roth_conversion", r.kind === "rmd" ? "RMD_NOT_CONVERTIBLE" : "NOT_AN_IRA_CONVERSION", path, r.sourceAccountId, r.source);
      need(eligible(account(r.sourceAccountId, path)) && account(r.destinationAccountId, path).family === "roth_ira" &&
        r.sourceAccountId !== r.destinationAccountId, "IMPROPER_CONVERSION_ACCOUNTS", path, r.sourceAccountId, r.source);
      source(r.authorization.source, `${path}.authorization`, r.sourceAccountId);
      need(r.authorization.permitted === "yes", "CONVERSION_AUTHORIZATION_MISSING_OR_DENIED", path, r.sourceAccountId, r.authorization.source);
      date(r.authorization.effectivePeriod.start, `${path}.authorization`);
      date(r.authorization.effectivePeriod.endExclusive, `${path}.authorization`);
      need(r.effectiveAt >= r.authorization.effectivePeriod.start && r.effectiveAt < r.authorization.effectivePeriod.endExclusive,
        "OUTSIDE_CONVERSION_AUTHORIZATION_PERIOD", path, r.sourceAccountId, r.authorization.source);
      need(r.gross.isPositive(), "NONPOSITIVE_CONVERSION", path, r.sourceAccountId, r.source);
      const d = input.distributions.find(d => d.operationId === r.operationId);
      need(Boolean(d) && d!.transactionId === r.transactionId && d!.sourceAccountId === r.sourceAccountId && d!.effectiveAt === r.effectiveAt &&
        d!.kind === "ira_roth_conversion" && d!.gross.equals(r.gross), "CONVERSION_REGISTER_MISMATCH", path, r.sourceAccountId, r.source);
    }
    const close = input.closeout;
    if (!close) throw new Incomplete("MISSING_TAX_YEAR_CLOSEOUT", "closeout", null);
    source(close.source, "closeout", null);
    need(input.asOf >= period.endExclusive && close.source.asOf >= period.endExclusive, "TAX_YEAR_NOT_CLOSED", "closeout", null, close.source);
    need(close.inventory === "complete" && close.distributions === "complete" && close.basisAdditions === "complete",
      "INCOMPLETE_YEAR_INVENTORY_OR_ACTIVITY", "closeout", null, close.source);
    need(close.legalBasisModel === "supported_without_special_adjustments", "UNPROVEN_LEGAL_BASIS_MODEL", "closeout", null, close.source);
    need(close.outstandingRollovers === "none", "UNSUPPORTED_OR_UNKNOWN_YEAR_END_ROLLOVERS", "closeout.outstandingRollovers", null, close.source);
    need(close.otherAdjustments === "none", "UNSUPPORTED_OR_UNKNOWN_BASIS_ADJUSTMENTS", "closeout.otherAdjustments", null, close.source);
    matchIds(close.eligibleAccountIds, accounts.filter(eligible).map(a => a.accountId), "closeout.eligibleAccountIds");
    matchIds(close.distributionOperationIds, input.distributions.map(d => d.operationId), "closeout.distributionOperationIds");
    matchIds(close.basisAdditionOperationIds, input.basisAdditions.map(b => b.operationId), "closeout.basisAdditionOperationIds");
    const opening = input.openingBasis;
    if (!opening) throw new Incomplete("MISSING_PRIOR_RETURN_BASIS", "openingBasis", null);
    // Legacy annual callers retain the reconciliation-snapshot convention.
    // Explicit original filings MUST supply their own prior-year legal snapshot.
    if (opening.originalReturn) original(opening.originalReturn, opening.source, year - 1, opening.amount, "openingBasis.originalReturn");
    source(opening.source, "openingBasis", null, year - 1,
      opening.originalReturn ? opening.originalReturn.legalSnapshot.source.ruleSnapshotId : rules.source.ruleSnapshotId);
    exact(opening.amount, "openingBasis");
    need(opening.priorTaxYear === year - 1 && opening.returnStatus !== "unknown" && opening.source.asOf >= period.start &&
      (opening.returnStatus !== "verified_no_prior_basis" || opening.amount.isZero()), "UNQUALIFIED_PRIOR_RETURN_BASIS", "openingBasis", null, opening.source);
    let availableBasis = opening.amount, december31Value = Money.zero(input.currency), total = Money.zero(input.currency);
    for (const a of accounts.filter(eligible)) {
      const path = `accounts.${a.accountId}.december31Value`, value = a.december31Value;
      if (!value) throw new Incomplete("MISSING_DECEMBER31_VALUE", path, a.accountId, a.source);
      source(value.source, path, a.accountId); exact(value.amount, path);
      need(value.at === closeDate && value.source.asOf >= closeDate, "STALE_OR_WRONG_YEAR_END_VALUE", path, a.accountId, value.source);
      december31Value = december31Value.plus(value.amount);
    }
    for (const b of [...input.basisAdditions].sort((a, b) => compareId(a.operationId, b.operationId))) {
      const path = `basisAdditions.${b.operationId}`;
      source(b.source, path, b.accountId); inYear(b.effectiveAt, path); exact(b.amount, path);
      need(b.source.asOf >= b.effectiveAt, "OBSERVATION_PRECEDES_OPERATION", path, b.accountId, b.source);
      need(eligible(account(b.accountId, path)) && b.kind === "qualified_nondeductible_regular_contribution", "UNSUPPORTED_BASIS_ADDITION", path, b.accountId, b.source);
      availableBasis = availableBasis.plus(b.amount);
    }
    const distributions = [...input.distributions].sort((a, b) => compareId(a.operationId, b.operationId));
    for (const d of distributions) {
      const path = `distributions.${d.operationId}`;
      source(d.source, path, d.sourceAccountId); inYear(d.effectiveAt, path); exact(d.gross, path);
      need(d.source.asOf >= d.effectiveAt, "OBSERVATION_PRECEDES_OPERATION", path, d.sourceAccountId, d.source);
      need(eligible(account(d.sourceAccountId, path)), "IMPROPER_DISTRIBUTION_ACCOUNT", path, d.sourceAccountId, d.source);
      need(["ira_roth_conversion", "ordinary_distribution", "rmd"].includes(d.kind), "UNSUPPORTED_DISTRIBUTION_CLASS", path, d.sourceAccountId, d.source);
      need(d.kind !== "ira_roth_conversion" || input.requests.some(r => r.operationId === d.operationId), "MISSING_CONVERSION_REQUEST", path, d.sourceAccountId, d.source);
      total = total.plus(d.gross);
    }
    const denominator = december31Value.plus(total);
    need(denominator.isPositive(), "ZERO_DENOMINATOR_UNPROVEN_MODEL", "annualDenominator", null, close.source);
    const cappedBasis = availableBasis.compare(denominator) > 0 ? denominator : availableBasis;
    // One annual rounding, never a rounded per-account or per-request ratio.
    const recovered = new Money(cappedBasis.amount.times(total.amount).dividedBy(denominator.amount,
      new RoundingPolicy(input.currency.minorUnitScale, rules.annualRounding)), input.currency);
    const allocations = distributions.map(d => {
      const numerator = d.gross.amount.times(recovered.amount);
      const amount = total.isZero() ? Money.zero(input.currency) : new Money(numerator.dividedBy(total.amount,
        new RoundingPolicy(input.currency.minorUnitScale, "toward_zero")), input.currency);
      return { operationId: d.operationId, gross: d.gross, basisRecovered: amount,
        remainder: numerator.minus(amount.amount.times(total.amount)) };
    });
    const sum = allocations.reduce((s, a) => s.plus(a.basisRecovered), Money.zero(input.currency));
    let residual = recovered.minus(sum);
    const unit = new Money(decimal("1").dividedBy(decimal(`1${"0".repeat(input.currency.minorUnitScale)}`),
      new RoundingPolicy(input.currency.minorUnitScale, "toward_zero")), input.currency);
    const ranked = [...allocations].sort((a, b) => -a.remainder.compare(b.remainder) || compareId(a.operationId, b.operationId));
    for (const a of ranked) {
      if (residual.isZero()) break;
      a.basisRecovered = a.basisRecovered.plus(unit); residual = residual.minus(unit);
    }
    need(residual.isZero() && recovered.compare(availableBasis) <= 0 && allocations.every(a => a.basisRecovered.compare(a.gross) <= 0),
      "UNSUPPORTED_ROUNDING_RECONCILIATION", "annualBasis", null, rules.source);
    if (close.originalReturn) {
      original(close.originalReturn, close.source, year, availableBasis.minus(recovered), "closeout.originalReturn");
      need(close.originalReturn.filingStatus === input.filingStatus, "MISSING_OR_MISMATCHED_FILING_CONTEXT", "closeout.originalReturn");
    }
    const traceRefs = [...refs].sort();
    basisProposals = [{ seam: "S5", committed: false, postable: false, personId: input.personId, taxYear: year,
      ruleSnapshotId: rules.source.ruleSnapshotId, availableBasis, december31Value, annualDistributions: total, denominator,
      annualBasisRecovered: recovered, carryForwardBasis: availableBasis.minus(recovered),
      allocations: allocations.map(a => ({ operationId: a.operationId, gross: a.gross, basisRecovered: a.basisRecovered, taxable: a.gross.minus(a.basisRecovered) })), traceRefs }];
    proposals = [...input.requests].sort((a, b) => compareId(a.operationId, b.operationId)).map(r => {
      const a = allocations.find(a => a.operationId === r.operationId)!;
      return { seam: "S3/S6", committed: false, postable: false, operationId: r.operationId, transactionId: r.transactionId,
        personId: input.personId, taxYear: year, sourceAccountId: r.sourceAccountId, destinationAccountId: r.destinationAccountId,
        effectiveAt: r.effectiveAt, jurisdiction: rules.jurisdiction, lawVersion: rules.version, ruleSnapshotId: rules.source.ruleSnapshotId,
        incomeCharacter: "ira_roth_conversion", gross: r.gross, taxable: r.gross.minus(a.basisRecovered), basisRecovered: a.basisRecovered, traceRefs };
    });
  } catch (e) {
    if (!(e instanceof Incomplete)) throw e;
    diagnostics.push({ diagnosticCode: e.code, sourceEntityPath: e.path, personId: input.personId, taxYear: year,
      affectedAccountId: e.account, period: { ...period }, affectedOutput: "ira_conversion_tax_character", coverage: "incomplete", missingFacts: [e.path],
      ruleSnapshotId: e.source?.ruleSnapshotId ?? input.rules?.source.ruleSnapshotId ?? null,
      traceRefs: [...new Set([...refs, ...(e.source ? [e.source.sourceId] : [])])].sort() });
  }
  const complete = diagnostics.length === 0;
  return { contract: "d2-shared/v1", committed: false, yearStatus: complete ? "FINAL" : "incomplete", proposals, basisProposals, diagnostics,
    accountYearCoverage: [...new Set(input.accounts.map(a => a.accountId))].sort().map(accountId => ({ accountId,
      personId: input.personId, taxYear: year, period: { ...period }, iraCharacter: complete ? "complete" : "incomplete",
      federalTax: "incomplete", stateTax: "incomplete", funding: "incomplete", postings: "not_applicable", traceRefs: [...refs].sort() })) };
}
