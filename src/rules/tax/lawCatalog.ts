import { domainId } from "../../identity/index.js";
import { instant } from "../../time/index.js";
import { Ratio, RoundingPolicy, money } from "../../values/index.js";
import { createTaxCatalog } from "./catalog.js";
import { immutableTaxData } from "./definition.js";
import type { FilingStatus, IncomeTaxDefinition, TaxBracket, TaxCoreRule, TaxLawCoverageGap, TaxSource } from "./contracts.js";
import { federalBaseDeductionOnlyEligibilityKey, fullYearResidentEligibilityKey } from "./contracts.js";

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
  version: `${jurisdiction}:${year}:${year === 2025 ? "v2" : "v1"}`, jurisdiction, filingStatus,
  effectiveFrom: instant(`${year}-01-01T00:00:00.000Z`), effectiveUntil: instant(`${year + 1}-01-01T00:00:00.000Z`),
  applicability: [{ fact: "residenceJurisdictions", includes: jurisdiction, present: true }, { fact: "eligibility", key: fullYearResidentEligibilityKey(jurisdiction), equals: true }], rounding: cents, ...(income === undefined ? {} : { income }),
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
const njSource = source("New Jersey Division of Taxation", "https://www.nj.gov/treasury/taxation/pdf/current/njtaxratesch.pdf", "2020-and-after NJ Tax Rate Schedules, Tables A and B");
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
  make(30, 4, "US:CO", "all", 2025, [source("Colorado Department of Revenue", "https://tax.colorado.gov/sites/tax/files/documents/Individual_Income_Tax_Guide_January_2026.pdf", "Individual Income Tax Guide, January 2026: 2025 rate 4.4%; primary authority identified by Issue #65")], suppliedBase([["0", "0.044"]])),
  ...statuses.map((status, index) => make(40 + index, 5, "US:CA", status, 2025, [caSource, source("California Franchise Tax Board", "https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html", "Form 540 line 62: 1% Behavioral Health Services Tax on taxable income over $1,000,000")], suppliedBase(joint(status) ? caJoint : status === "head_of_household" ? caHead : caSingle, { minimumTaxableBase: money("100000.01"), additionalTaxes: [{ key: "behavioral_health", inputBase: "ca_total_taxable_income", composedFrom: [], brackets: brackets([["0", "0"], ["1000000", "0.01"]]) }] }), ["Tax tables at or below $100,000 are an explicit coverage gap. The surtax base must reconcile with Form 540 line 19."])),
  make(50, 6, "US:AZ", "all", 2025, [source("Arizona Department of Revenue", "https://azdor.gov/forms/individual-income-tax-highlights", "2025 highlights: 2.5% for all income levels and filing statuses")], suppliedBase([["0", "0.025"]])),
  make(60, 7, "US:GA", "all", 2025, [source("Georgia Department of Revenue", "https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download", "2025 IT-511 booklet: Form 500 line 16, 5.19% of line 15c")], suppliedBase([["0", "0.0519"]])),
  make(70, 8, "US:MA", "all", 2025, [source("Massachusetts Department of Revenue", "https://www.mass.gov/info-details/massachusetts-tax-rates", "2025: ordinary/long-gain rate 5%; short-gain rate 8.5%; additional 4% above $1,083,150")], suppliedBase([["0", "0.05"]], { additionalTaxes: [
    { key: "short_term_gains", inputBase: "ma_taxable_short_gains", brackets: brackets([["0", "0.085"]]) },
    { key: "income_surtax", inputBase: "ma_combined_taxable_income", composedFrom: ["ma_taxable_short_gains"], brackets: brackets([["0", "0"], ["1083150", "0.04"]]) },
  ] }), ["Ordinary base includes legally taxable ordinary income and ordinary long gains; short gains use a separate legal base. Collectibles and other specialized Part A cases are unsupported."]),
  make(201, 1, "US:PA", "all", 2026, [source("Pennsylvania Department of Revenue", "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/personal-income-tax.html", "Current personal income tax: 3.07% of eight separately classified legal income categories")], suppliedBase([["0", "0.0307"]]), ["PA exclusions and category-loss restrictions must already be reflected in the supplied base."]),
  ...statuses.map((status, index) => make(210 + index, 3, "US:NJ", status, 2026, [njSource, source("New Jersey Division of Taxation", "https://www.nj.gov/treasury/taxation/taxtables.shtml", "2020 and After schedules remain the published current schedules")], suppliedBase(joint(status) || status === "head_of_household" ? njJoint : njSingle, { minimumTaxableBase: money("20000") }), ["Cases below $20,000 legal taxable base require filing-threshold coverage before computing liability."])),
  make(250, 6, "US:AZ", "all", 2026, [source("Arizona Department of Revenue", "https://azdor.gov/sites/default/files/document/FORMS_INDIVIDUAL_2026_140iES.pdf", "2026 Form 140ES instructions: annual income tax rate 2.5%; legal taxable base supplied separately from estimated payments")], suppliedBase([["0", "0.025"]])),
  make(260, 7, "US:GA", "all", 2026, [source("Georgia Department of Revenue", "https://dor.georgia.gov/taxes/important-tax-updates", "2026 Income Tax Changes: flat rate reduced to 4.99%; GA deductions/exclusions supplied in the legal base")], suppliedBase([["0", "0.0499"]])),
  make(270, 8, "US:MA", "all", 2026, [source("Massachusetts Department of Revenue", "https://www.mass.gov/info-details/massachusetts-tax-rates", "Tax year 2026: ordinary/long gains 5%, short gains 8.5%, additional 4% above $1,107,750")], suppliedBase([["0", "0.05"]], { additionalTaxes: [
    { key: "short_term_gains", inputBase: "ma_taxable_short_gains", brackets: brackets([["0", "0.085"]]) },
    { key: "income_surtax", inputBase: "ma_combined_taxable_income", composedFrom: ["ma_taxable_short_gains"], brackets: brackets([["0", "0"], ["1107750", "0.04"]]) },
  ] }), ["Ordinary base includes ordinary income and ordinary long gains; short gains use a separate legal base. Collectibles and specialized Part A cases are unsupported."]),
]);

const nycSingle = [["0", "0.03078", "0"], ["12000", "0.03762", "369"], ["25000", "0.03819", "858"], ["50000", "0.03876", "1813"]] as const;
const nycJoint = [["0", "0.03078", "0"], ["21600", "0.03762", "665"], ["45000", "0.03819", "1545"], ["90000", "0.03876", "3264"]] as const;
const nycHead = [["0", "0.03078", "0"], ["14400", "0.03762", "443"], ["30000", "0.03819", "1030"], ["60000", "0.03876", "2176"]] as const;
const denverSource = source("City and County of Denver Treasury", "https://www.denvergov.org/files/assets/public/v/2/finance/documents/treasury/tax-guides/taxguidetopic61_occupationalprivilegetaxes_1.pdf", "Tax Guide Topic 61: Employee OPT, $5.75/month at $500 Denver compensation; exemptions and multi-employer rules");
const philadelphiaSources = [
  source("City of Philadelphia Department of Revenue", "https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/wage-tax-employers/", "Wage Tax: resident compensation regardless of work location, nonresident Philadelphia compensation; employer withholding"),
  source("City of Philadelphia Department of Revenue", "https://www.phila.gov/services/payments-assistance-taxes/taxes/income-taxes/earnings-tax-employees/", "Earnings Tax is direct payment of the same compensation liability when Wage Tax was not withheld, not an additional liability"),
  source("City of Philadelphia Department of Revenue", "https://www.phila.gov/departments/department-of-revenue/forms-documents/regulations-rulings/tax-rate-history/", "July 1, 2026–June 30, 2027: resident 3.735%, nonresident 3.425%; primary authority and interval supplied by Issue #65"),
];
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
    // Preserve WAGE as the stable identity for the shared Wage/Earnings liability family.
    ...make(91 + index, 12, "US:PA:PHILADELPHIA:WAGE", "all", 2026, philadelphiaSources, suppliedBase([["0", resident ? "0.03735" : "0.03425"]])),
    version: "US:PA:PHILADELPHIA:WAGE:2026-07:v2",
    effectiveFrom: instant("2026-07-01T00:00:00.000Z"),
    effectiveUntil: instant("2027-07-01T00:00:00.000Z"),
    provenance: { type: "verified_law" as const, sources: philadelphiaSources, scope: "One Philadelphia earned-compensation liability, collected through Wage Tax withholding or direct employee Earnings Tax payments", limitations: [
      "WAGE names the single Wage/Earnings regime; never select or add a second Earnings liability.",
      "Caller supplies legally taxable compensation for the selected residence/work status and rate interval, including exclusions and nonresident outside-city work allocation.",
      "Withholding, direct payments and settlement credits are separate inputs and cannot change compensation liability.",
      "Cent liability only; changes of residence/work status must be characterized before selection. Other Philadelphia taxes are unsupported.",
    ] },
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

const irs2026Sources = [
  source("Internal Revenue Service", "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf", "Rev. Proc. 2025-32 section 4.01, 4.03, 4.14: 2026 ordinary brackets, capital-gain thresholds and base standard deduction"),
  source("Internal Revenue Service", "https://www.irs.gov/pub/irs-pdf/p15.pdf", "Publication 15 (2026): employee Social Security 6.2%, $184,500 wage base; Medicare 1.45%"),
  ...irsSources.slice(2),
  source("Internal Revenue Service", "https://www.irs.gov/newsroom/one-big-beautiful-bill-provisions", "2025–2028 senior, qualified tips, qualified overtime and qualified vehicle-loan-interest deductions require separate eligibility/base/phaseout mechanics"),
];

/** Base-deduction-only cases require an affirmative caller-supplied capability decision. */
export const federal2026TaxCatalog = createTaxCatalog(statuses.map((status, index) => {
  const historical = federal2024TaxCatalog.find((rule) => rule.filingStatus === status)!;
  const thresholds = joint(status) ? ["0", "24800", "100800", "211400", "403550", "512450", "768700"]
    : status === "head_of_household" ? ["0", "17700", "67450", "105700", "201750", "256200", "640600"]
    : ["0", "12400", "50400", "105700", "201775", "256225", status === "married_separate" ? "384350" : "640600"];
  const preferred = joint(status) ? ["98900", "613700"] : status === "head_of_household" ? ["66200", "579600"]
    : status === "married_separate" ? ["49450", "306850"] : ["49450", "545500"];
  return {
    ...historical,
    id: domainId("tax-rule", `83000000-0000-4000-8000-${String(300 + index).padStart(12, "0")}`),
    version: "US:FEDERAL:2026:v1",
    effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"),
    applicability: [{ fact: "eligibility" as const, key: federalBaseDeductionOnlyEligibilityKey, equals: true }],
    income: {
      ...historical.income!,
      ordinaryBrackets: thresholds.map((lower, i) => ({ lower: money(lower), rate: Ratio.parse(ordinaryRates[i]!) })),
      standardDeduction: money(joint(status) ? "32200" : status === "head_of_household" ? "24150" : "16100"),
      preferentialBrackets: brackets([["0", "0"], [preferred[0]!, "0.15"], [preferred[1]!, "0.2"]]),
    },
    payroll: historical.payroll!.map((component) => component.key === "social_security" ? { ...component, wageBase: money("184500") } : component),
    provenance: { type: "verified_law" as const, sources: irs2026Sources, scope: "2026 common-household ordinary/preferential income and employee payroll/NIIT liability for explicitly eligible base-deduction-only cases", limitations: [
      "Selection requires federal_base_deduction_only=true: base standard deduction is not exhaustive for affected senior, tips, overtime, vehicle-interest, age/blindness, dependent or itemized cases; these are capability-gated, not approximated.",
      "Traditional deductions and taxable retirement distribution portions remain explicitly characterized legal facts.",
      "Only ordinary net realized capital gains/losses; specialized gains, credits, AMT, self-employment, RMD law data and T1B components require separate coverage.",
      "Tax tables and dollar return presentation/line rounding require separate coverage.",
    ] },
  };
}));

/** Historical and current federal rules coexist without extrapolation or fallback. */
export const federalTaxCatalog = createTaxCatalog([...federal2024TaxCatalog, ...federal2026TaxCatalog]);

/** Explicit gaps, never filled with rates from another municipality/year/jurisdiction. */
export const taxLawCoverageGaps = immutableTaxData<readonly TaxLawCoverageGap[]>([
  { jurisdiction: "US:NY", taxYear: 2026, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), reason: "Current published IT-201-I establishes 2025 final liability methods, not final 2026 tables/intercepts and recapture coverage. 2025 schedules are not reused as 2026 law.", sources: [nySource] },
  { jurisdiction: "US:NY:NYC", taxYear: 2026, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), reason: "Current IT-201-I resident liability method/table coverage is for 2025; final 2026 NYC method coverage remains explicit rather than silently reusing 2025.", sources: [nySource] },
  { jurisdiction: "US:CA", taxYear: 2026, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), reason: "2026 Form 540-ES still directs estimates to the 2025 tax table. That payment-estimation method is not a final 2026 liability schedule; final 2026 tables/intercepts require coverage.", sources: [source("California Franchise Tax Board", "https://www.ftb.ca.gov/forms/2026/2026-540-es-instructions.html", "2026 estimated-tax worksheet line 4 uses the 2025 tax table")] },
  { jurisdiction: "US:CO", taxYear: 2026, effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2027-01-01T00:00:00.000Z"), reason: "Final 2026 annual rate including any temporary reduction is not yet source-verified in this catalog; the January 2026 guide establishes 2025, not a final 2026 determination." },
  { jurisdiction: "US:FEDERAL", taxYear: 2026, reason: "Senior, qualified tips, overtime and vehicle-loan-interest deductions and age/blindness/dependent/itemized mechanics are unsupported. federal_base_deduction_only must explicitly establish these do not affect the case." },
  { jurisdiction: "US:PA:LOCAL:EIT", reason: "Municipality/PSD-specific authoritative rates and residence/work precedence must be sourced for each admitted location; no generic PA-local rate exists." },
  { jurisdiction: "US:PA:LOCAL:LST", reason: "Work-municipality/PSD-specific rates, exemptions and employer allocation must be sourced for each admitted location." },
  { jurisdiction: "US:PA:PHILADELPHIA:WAGE", reason: "Wage and Earnings Tax share one liability. Compensation intervals outside July 1, 2026–June 30, 2027 require another source-backed rate version." },
  { jurisdiction: "US:NY", reason: "Tax tables below $65,000 taxable income and AGI recapture above $107,650 are not yet covered." },
  { jurisdiction: "US:NY:NYC", reason: "Tax tables below $65,000, credits and part-year allocation are not yet covered." },
  { jurisdiction: "US:CA", reason: "Tax tables at/below $100,000 and credits are not yet covered." },
  { jurisdiction: "US:FEDERAL:RMD", reason: "RMD algorithms accept explicit effective-dated eligibility/divisor data; verified birth-cohort and distribution-table coverage is not yet supplied." },
]);
