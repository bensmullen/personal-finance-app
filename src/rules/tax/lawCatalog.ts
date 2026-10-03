import { domainId } from "../../identity/index.js";
import { instant } from "../../time/index.js";
import { Ratio, RoundingPolicy, money } from "../../values/index.js";
import { createTaxCatalog } from "./catalog.js";
import { immutableTaxData } from "./definition.js";
import type { FilingStatus, IncomeTaxDefinition, TaxBracket, TaxCoreRule, TaxSource } from "./contracts.js";

/** Law data only. Algorithms and household facts are deliberately absent. */
const statuses: readonly FilingStatus[] = ["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"];
const cents = new RoundingPolicy(2, "half_up");
const source = (authority: string, url: string, reference: string): TaxSource => ({ authority, url, reference, verifiedOn: "2026-10-03" });
const brackets = (rows: readonly (readonly [string, string, string?])[]): readonly TaxBracket[] => rows.map(([lower, rate, baseTax]) => ({ lower: money(lower), rate: Ratio.parse(rate), ...(baseTax === undefined ? {} : { baseTax: money(baseTax) }) }));
const suppliedBase = (rows: readonly (readonly [string, string, string?])[], extra: Partial<IncomeTaxDefinition> = {}): IncomeTaxDefinition => ({
  basis: "explicit_taxable_base", ordinaryBrackets: brackets(rows), standardDeduction: money("0"), capitalTreatment: "ordinary", capitalLossDeductionLimit: money("0"), traditionalContributionDeduction: false, ...extra,
});
const make = (number: number, jurisdictionNumber: number, jurisdiction: string, filingStatus: FilingStatus | "all", year: number, sources: readonly TaxSource[], income: IncomeTaxDefinition | undefined, limitations: readonly string[] = []): TaxCoreRule => ({
  id: domainId("tax-rule", `83000000-0000-4000-8000-${String(number).padStart(12, "0")}`), kind: "tax_core",
  target: { targetType: "jurisdiction", targetId: domainId("jurisdiction", `84000000-0000-4000-8000-${String(jurisdictionNumber).padStart(12, "0")}`) },
  version: `${jurisdiction}:${year}:v1`, jurisdiction, filingStatus,
  effectiveFrom: instant(`${year}-01-01T00:00:00.000Z`), effectiveUntil: instant(`${year + 1}-01-01T00:00:00.000Z`),
  applicability: [{ fact: "residenceJurisdictions", includes: jurisdiction, present: true }], rounding: cents, ...(income === undefined ? {} : { income }),
  provenance: { type: "verified_law", sources, scope: "Income-tax liability before credits, from an explicitly supplied jurisdiction-specific legal taxable base", limitations: [
    "Legal base recognition, adjustments, deductions, exemptions, filing obligations and eligibility are supplied facts; federal taxable income is never substituted.",
    "Full-year resident cases only. Part-year/nonresident allocation, reciprocity, credits, AMT and other T1B components require separate coverage.",
    "Cent-valued liability; tax-return dollar presentation/line rounding is outside this calculation scope.", ...limitations,
  ] },
});

const nySource = source("New York State Department of Taxation and Finance", "https://www.tax.ny.gov/forms/current-forms/it/it201i.htm", "2025 IT-201-I: state and NYC tax rate schedules, method-selection limits");
const nySingle = [["0", "0.04", "0"], ["8500", "0.045", "340"], ["11700", "0.0525", "484"], ["13900", "0.055", "600"], ["80650", "0.06", "4271"], ["215400", "0.0685", "12356"], ["1077550", "0.0965", "71413"], ["5000000", "0.103", "449929"], ["25000000", "0.109", "2509929"]] as const;
const nyJoint = [["0", "0.04", "0"], ["17150", "0.045", "686"], ["23600", "0.0525", "976"], ["27900", "0.055", "1202"], ["161550", "0.06", "8553"], ["323200", "0.0685", "18252"], ["2155350", "0.0965", "143754"], ["5000000", "0.103", "418263"], ["25000000", "0.109", "2478263"]] as const;
const nyHead = [["0", "0.04", "0"], ["12800", "0.045", "512"], ["17650", "0.0525", "730"], ["20900", "0.055", "901"], ["107650", "0.06", "5672"], ["269300", "0.0685", "15371"], ["1616450", "0.0965", "107651"], ["5000000", "0.103", "434163"], ["25000000", "0.109", "2494163"]] as const;
const joint = (status: FilingStatus): boolean => status === "married_joint" || status === "qualifying_surviving_spouse";
const njSource = source("New Jersey Division of Taxation", "https://www.nj.gov/treasury/taxation/pdf/current/njtaxratesch.pdf", "2020-and-after NJ Tax Rate Schedules, Tables A and B; bounded here to 2025");
const njSingle = [["0", "0.014"], ["20000", "0.0175"], ["35000", "0.035"], ["40000", "0.05525"], ["75000", "0.0637"], ["500000", "0.0897"], ["1000000", "0.1075"]] as const;
// Published Table B's subtraction constants are not all cumulative marginal sums.
const njJoint = [["0", "0.014", "0"], ["20000", "0.0175", "280"], ["50000", "0.0245", "805"], ["70000", "0.035", "1295.5"], ["80000", "0.05525", "1645"], ["150000", "0.0637", "5512.5"], ["500000", "0.0897", "27807.5"], ["1000000", "0.1075", "72657.5"]] as const;
const caSource = source("California Franchise Tax Board", "https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf", "2025 Form 540 Tax Rate Schedules X, Y, Z; applicable only above $100,000");
const caSingle = [["0", "0.01", "0"], ["11079", "0.02", "110.79"], ["26264", "0.04", "414.49"], ["41452", "0.06", "1022.01"], ["57542", "0.08", "1987.41"], ["72724", "0.093", "3201.97"], ["371479", "0.103", "30986.19"], ["445771", "0.113", "38638.27"], ["742953", "0.123", "72219.84"]] as const;
const caJoint = [["0", "0.01", "0"], ["22158", "0.02", "221.58"], ["52528", "0.04", "828.98"], ["82904", "0.06", "2044.02"], ["115084", "0.08", "3974.82"], ["145448", "0.093", "6403.94"], ["742958", "0.103", "61972.37"], ["891542", "0.113", "77276.52"], ["1485906", "0.123", "144439.65"]] as const;
const caHead = [["0", "0.01", "0"], ["22173", "0.02", "221.73"], ["52530", "0.04", "828.87"], ["67716", "0.06", "1436.31"], ["83805", "0.08", "2401.65"], ["98990", "0.093", "3616.45"], ["505208", "0.103", "41394.72"], ["606251", "0.113", "51802.15"], ["1010417", "0.123", "97472.91"]] as const;

export const alphaStateTaxCatalog = createTaxCatalog([
  make(1, 1, "US:PA", "all", 2025, [source("Pennsylvania Department of Revenue", "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/personal-income-tax.html", "Personal income tax: 3.07%, eight separately classified income categories, no standard deduction")], suppliedBase([["0", "0.0307"]]), ["The caller must supply the sum of legally taxable PA income categories after PA-specific exclusions; category losses cannot be freely offset."]),
  ...statuses.map((status, index) => make(10 + index, 2, "US:NY", status, 2025, [nySource], suppliedBase(joint(status) ? nyJoint : status === "head_of_household" ? nyHead : nySingle, { minimumTaxableBase: money("65000"), maximumAdjustedGrossIncome: money("107650") }), ["Tax tables below $65,000 and NY recapture worksheets above $107,650 AGI are explicit coverage gaps."])),
  ...statuses.map((status, index) => make(20 + index, 3, "US:NJ", status, 2025, [njSource, source("New Jersey Division of Taxation", "https://www.nj.gov/treasury/taxation/taxtables.shtml", "2020-and-after schedules; schedules are allowed below $100,000 and mandatory at or above it")], suppliedBase(joint(status) || status === "head_of_household" ? njJoint : njSingle, { minimumTaxableBase: money("20000") }), ["Cases below $20,000 legal taxable base require filing-threshold coverage before computing liability."])),
  make(30, 4, "US:CO", "all", 2025, [source("Tax Foundation (secondary compilation of state tax law)", "https://taxfoundation.org/data/all/state/state-income-tax-rates/", "State Individual Income Tax Rates and Brackets, 2025: Colorado 4.40%; 2024 temporary reduction is not reused")], suppliedBase([["0", "0.044"]]), ["Colorado DOR pages were unavailable during sourcing; this rate is verified against the dated secondary compilation. Reverify against DOR before broadening coverage."]),
  ...statuses.map((status, index) => make(40 + index, 5, "US:CA", status, 2025, [caSource, source("California Franchise Tax Board", "https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html", "Form 540 line 62: 1% Behavioral Health Services Tax on taxable income over $1,000,000")], suppliedBase(joint(status) ? caJoint : status === "head_of_household" ? caHead : caSingle, { minimumTaxableBase: money("100000.01"), additionalTaxes: [{ key: "behavioral_health", inputBase: "ca_total_taxable_income", composedFrom: [], brackets: brackets([["0", "0"], ["1000000", "0.01"]]) }] }), ["Tax tables at or below $100,000 are an explicit coverage gap. The surtax base must reconcile with Form 540 line 19."])),
  make(50, 6, "US:AZ", "all", 2025, [source("Arizona Department of Revenue", "https://azdor.gov/forms/individual-income-tax-highlights", "2025 highlights: 2.5% for all income levels and filing statuses")], suppliedBase([["0", "0.025"]])),
  make(60, 7, "US:GA", "all", 2025, [source("Georgia Department of Revenue", "https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download", "2025 IT-511 booklet: Form 500 line 16, 5.19% of line 15c")], suppliedBase([["0", "0.0519"]])),
  make(70, 8, "US:MA", "all", 2025, [source("Massachusetts Department of Revenue", "https://www.mass.gov/info-details/massachusetts-tax-rates", "2025: ordinary/long-gain rate 5%; short-gain rate 8.5%; additional 4% above $1,083,150")], suppliedBase([["0", "0.05"]], { additionalTaxes: [
    { key: "short_term_gains", inputBase: "ma_taxable_short_gains", brackets: brackets([["0", "0.085"]]) },
    { key: "income_surtax", inputBase: "ma_combined_taxable_income", composedFrom: ["ma_taxable_short_gains"], brackets: brackets([["0", "0"], ["1083150", "0.04"]]) },
  ] }), ["Ordinary base includes legally taxable ordinary income and ordinary long gains; short gains use a separate legal base. Collectibles and other specialized Part A cases are unsupported."]),
]);

const nycSingle = [["0", "0.03078", "0"], ["12000", "0.03762", "369"], ["25000", "0.03819", "858"], ["50000", "0.03876", "1813"]] as const;
const nycJoint = [["0", "0.03078", "0"], ["21600", "0.03762", "665"], ["45000", "0.03819", "1545"], ["90000", "0.03876", "3264"]] as const;
const nycHead = [["0", "0.03078", "0"], ["14400", "0.03762", "443"], ["30000", "0.03819", "1030"], ["60000", "0.03876", "2176"]] as const;
const denverSource = source("City and County of Denver Treasury", "https://www.denvergov.org/files/assets/public/v/2/finance/documents/treasury/tax-guides/taxguidetopic61_occupationalprivilegetaxes_1.pdf", "Tax Guide Topic 61: Employee OPT, $5.75/month at $500 Denver compensation; exemptions and multi-employer rules");
export const alphaLocalTaxCatalog = createTaxCatalog([
  ...statuses.map((status, index) => make(80 + index, 9, "US:NY:NYC", status, 2025, [nySource], suppliedBase(joint(status) ? nycJoint : status === "head_of_household" ? nycHead : nycSingle, { minimumTaxableBase: money("65000") }), ["NYC resident income tax only; work in NYC without NYC residency is insufficient. Tax tables below $65,000 and credits require separate coverage."])),
  {
    ...make(90, 10, "US:CO:DENVER:OPT", "all", 2026, [denverSource], undefined),
    effectiveFrom: instant("2026-04-01T00:00:00.000Z"),
    applicability: [{ fact: "workJurisdictions", includes: "US:CO:DENVER", present: true }, { fact: "eligibility", key: "denver_employee_opt_eligible", equals: true }],
    periodicEmployeeTax: { amount: money("5.75"), wageThreshold: money("500"), unit: "calendar_month" },
    provenance: { type: "verified_law", sources: [denverSource], scope: "One eligible employee's monthly OPT using Denver-sourced compensation, once across employers", limitations: ["Work-location applies; residence alone never establishes liability.", "Caller must establish statutory exemption/majority-hours eligibility and reconcile multi-employer compensation before calculation; business OPT is unsupported."] },
  },
  ...([true, false] as const).map((resident, index) => ({
    ...make(91 + index, 12, "US:PA:PHILADELPHIA:WAGE", "all", 2026, [
      source("University of Pennsylvania Division of Finance (employer payroll authority)", "https://finance.upenn.edu/payroll-taxes/individual-tax-rates-and-forms/tax-rates/", "2026 Tax Rates: Philadelphia resident 3.735%, nonresident 3.425%, effective July 1, 2026"),
      source("University of Pennsylvania Division of Finance", "https://finance.upenn.edu/payroll-taxes/individual-tax-rates-and-forms/philadelphia-city-wage-tax-refunds/", "Philadelphia residents taxable regardless of work location; nonresident required work outside city is eligible for refund"),
    ], suppliedBase([["0", resident ? "0.03735" : "0.03425"]]), ["City rate-notice pages were unavailable; rates are verified against the dated employer payroll reference. Earnings Tax requires its own source-verified catalog coverage."]),
    effectiveFrom: instant("2026-07-01T00:00:00.000Z"),
    applicability: [
      { fact: "residenceJurisdictions" as const, includes: "US:PA:PHILADELPHIA", present: resident },
      ...(resident ? [] : [{ fact: "workJurisdictions" as const, includes: "US:PA:PHILADELPHIA", present: true }]),
    ],
  })),
]);

const irsSources = [
  source("Internal Revenue Service", "https://www.irs.gov/pub/irs-drop/rp-23-34.pdf", "Rev. Proc. 2023-34 section 3.01, 3.03, 3.15: 2024 ordinary brackets, preferential thresholds and standard deduction"),
  source("Internal Revenue Service", "https://www.irs.gov/pub/irs-prior/p15--2024.pdf", "2024 Publication 15: employee Social Security 6.2%, $168,600 wage base; Medicare 1.45%"),
  source("Internal Revenue Service", "https://www.irs.gov/taxtopics/tc560", "Additional Medicare Tax: 0.9%, filing-status thresholds; liability differs from employer withholding"),
  source("Internal Revenue Service", "https://www.irs.gov/individuals/net-investment-income-tax", "NIIT effective January 1, 2013: 3.8%, filing-status thresholds; explicit NII/MAGI inputs"),
  source("Internal Revenue Service", "https://www.irs.gov/taxtopics/tc409", "Capital gains and losses: netting by character; $3,000 net loss deduction ($1,500 married separately)"),
];
const ordinaryRates = ["0.1", "0.12", "0.22", "0.24", "0.32", "0.35", "0.37"];
export const federal2024TaxCatalog = createTaxCatalog(statuses.map((status, index) => {
  const thresholds = joint(status) ? ["0", "23200", "94300", "201050", "383900", "487450", "731200"]
    : status === "head_of_household" ? ["0", "16550", "63100", "100500", "191950", "243700", "609350"]
    : ["0", "11600", "47150", "100525", "191950", "243725", status === "married_separate" ? "365600" : "609350"];
  const niitThreshold = joint(status) ? "250000" : status === "married_separate" ? "125000" : "200000";
  const medicareThreshold = status === "married_joint" ? "250000" : status === "married_separate" ? "125000" : "200000";
  const preferred = joint(status) ? ["94050", "583750"] : status === "head_of_household" ? ["63000", "551350"] : status === "married_separate" ? ["47025", "291850"] : ["47025", "518900"];
  const rule = make(100 + index, 11, "US:FEDERAL", status, 2024, irsSources, {
    basis: "recognized_income", ordinaryBrackets: thresholds.map((lower, i) => ({ lower: money(lower), rate: Ratio.parse(ordinaryRates[i]!) })),
    standardDeduction: money(joint(status) ? "29200" : status === "head_of_household" ? "21900" : "14600"), capitalTreatment: "preferential",
    preferentialBrackets: brackets([["0", "0"], [preferred[0]!, "0.15"], [preferred[1]!, "0.2"]]),
    capitalLossDeductionLimit: money(status === "married_separate" ? "1500" : "3000"), traditionalContributionDeduction: true,
  });
  return { ...rule,
    applicability: [],
    payroll: [
      { key: "social_security", rate: Ratio.parse("0.062"), basis: "per_employee" as const, threshold: money("0"), wageBase: money("168600") },
      { key: "medicare", rate: Ratio.parse("0.0145"), basis: "per_employee" as const, threshold: money("0") },
      { key: "additional_medicare", rate: Ratio.parse("0.009"), basis: "combined_wages" as const, threshold: money(medicareThreshold) },
    ], niit: { rate: Ratio.parse("0.038"), threshold: money(niitThreshold) },
    provenance: { type: "verified_law" as const, sources: irsSources, scope: "2024 common-household ordinary/preferential income and employee payroll/NIIT liability", limitations: [
      "Base standard deduction only; age/blindness additions, dependent deductions, deduction eligibility, exemptions and adjustments must be supplied or capability-gated.",
      "Traditional contribution deduction eligibility and distribution basis recovery, and Roth taxable portions are explicit characterized facts; penalties/conversions and complex retirement cases are unsupported.",
      "Ordinary net realized capital gains/losses only; collectibles, unrecaptured section 1250, qualified small business stock and specialized gains are unsupported.",
      "Tax-table/dollar return presentation, credits, AMT, self-employment, RMD cohort/divisor data and T1B components require separate coverage.",
    ] },
  };
}));

/** Explicit gaps, never filled with rates from another municipality/year/jurisdiction. */
export const taxLawCoverageGaps = immutableTaxData([
  { jurisdiction: "US:PA:LOCAL:EIT", reason: "Municipality/PSD-specific authoritative rates and residence/work precedence must be sourced for each admitted location; no generic PA-local rate exists." },
  { jurisdiction: "US:PA:LOCAL:LST", reason: "Work-municipality/PSD-specific rates, exemptions and employer allocation must be sourced for each admitted location." },
  { jurisdiction: "US:PA:PHILADELPHIA:EARNINGS", reason: "Wage Tax is sourced for July–December 2026; Earnings Tax and other effective periods need separate source-verified coverage." },
  { jurisdiction: "US:NY", reason: "Tax tables below $65,000 taxable income and AGI recapture above $107,650 are not yet covered." },
  { jurisdiction: "US:NY:NYC", reason: "Tax tables below $65,000, credits and part-year allocation are not yet covered." },
  { jurisdiction: "US:CA", reason: "Tax tables at/below $100,000 and credits are not yet covered." },
  { jurisdiction: "US:FEDERAL:RMD", reason: "RMD algorithms accept explicit effective-dated eligibility/divisor data; verified birth-cohort and distribution-table coverage is not yet supplied." },
]);
