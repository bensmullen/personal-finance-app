import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { forecastDiagnosticMessage, type DisplayDiagnostic } from "../entityPresentation.js";

/** Execution blockers precede scoped tax limitations in compact global status. */
export function primaryForecastDiagnostic<T extends DisplayDiagnostic & { readonly severity?: string }>(diagnostics: readonly T[]): T | undefined {
  return diagnostics.find(item => item.code === "MORTGAGE_REFINANCE_UNSUPPORTED")
    ?? diagnostics.find(item => item.entityType !== "tax_capability" && item.severity === "error")
    // A partly executable forecast still needs a first-class, repairable source
    // warning ahead of non-actionable, generic tax capability qualifications.
    ?? diagnostics.find(item => item.entityType === "tax_capability" && item.category === "payroll_source_unsupported")
    ?? diagnostics.find(item => item.severity === "error")
    ?? diagnostics[0];
}

/** Normal diagnostics have a bounded problem and an honest next action. */
export function diagnosticSummary(diagnostic: DisplayDiagnostic, model?: PersonalDraft) {
  const explanation = forecastDiagnosticMessage(diagnostic, model);
  const sentences = explanation.split(/(?<=[.!?])\s+/);
  const code = diagnostic.code ?? "";
  if (code === "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED") return {
    problem: `${sentences[0]} Volatility belongs to future probabilistic forecasting.`,
    remedy: sentences.find(sentence => sentence.startsWith("Under "))!, explanation };
  if (code === "RULE_INPUT_INVALID" && /Contribution facts do not cover|CONTRIBUTION_LAW_YEAR_UNAVAILABLE/.test(diagnostic.message ?? "")) return {
    problem: "The forecast reached the end of supported contribution-year coverage.",
    remedy: "Confirm supported future contribution facts and projected law, or end the simulation before that boundary.", explanation };
  if (/HORIZON|MONTHS_MISMATCH/.test(code)) return {
    problem: "The plan and simulation dates do not form a supported monthly window.",
    remedy: "Choose month-start simulation dates within Current Plan's dates.", explanation };
  if (diagnostic.entityType === "tax_capability") {
    const category = diagnostic.category ?? "";
    if (category === "payment_funding" || category === "settlement_timing") return { problem: "Tax payments and refunds need forecast setup.", remedy: "Choose their cash accounts and confirm settlement dates in Forecast setup.", explanation };
    if (category === "payroll_source_unsupported") return { problem: "This salary schedule or net-only source is not modeled in the monthly forecast.", remedy: "Review the recorded Frequency or Gross or net in Money → Income. Preserve actual source facts; unsupported salary and withholding were not executed.", explanation };
    if (category === "contribution_annual_facts") return { problem: `Future contribution eligibility is not established for ${diagnostic.taxYear ?? "this year"}.`, remedy: "Review this year's income, employer plan, tax or health-coverage facts in their named source editor.", explanation };
    if (category.startsWith("filing_status")) return { problem: category === "filing_status_conflict" ? `Recorded filing statuses disagree for ${diagnostic.taxYear ?? "this year"}.` : `Household filing status is missing for ${diagnostic.taxYear ?? "this year"}.`, remedy: "Confirm the annual household status in Household & People; earlier years do not establish later years.", explanation };
    if (category === "projected_current_law") return { problem: sentences[0]!, remedy: "Review the projected current-law basis before relying on future tax totals.", explanation };
    return { problem: sentences[0]!, remedy: /filing_status|residence_jurisdiction_periods|work_service_jurisdiction_allocations/.test(category)
      ? "Import the missing or corrected dated tax facts; this editor cannot author them."
      : "Use the supported earlier results; this tax coverage limit cannot be repaired in the current editor.", explanation };
  }
  // Known product mappings provide domain language; unknown machine messages do
  // not become primary copy merely because they were emitted by execution.
  const safeProblem = sentences[0] && !/\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(sentences[0]) ? sentences[0] : "A required financial input could not be used by this forecast.";
  const action = sentences.slice(1).find(sentence => /^(Under |In |Import |Choose |Review |For supported |They cannot |There is no )/.test(sentence));
  return { problem: safeProblem, remedy: action ?? (code.includes("UNSUPPORTED")
    ? "Preserve your recorded facts; this calculation requires a supported model or a future capability."
    : diagnostic.fieldPath ? "Review the affected field below and update the forecast after correcting it." : "Review the affected records below; retry after correcting supported inputs or import a corrected model."), explanation };
}
