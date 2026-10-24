import { validatePersonalDraft, type PersonalDraft } from "./personalMvp.js";
import type { PersonalHouseholdSessionExecutionConfiguration } from "./householdProjection.js";
import { currentPlan } from "./forecastSetup.js";
import { objects, utcDate } from "./compiler/shared.js";
import { durablePayrollWithholding } from "./compiler/payrollWithholding.js";
import { mortgageRemainingSchedule } from "./compiler/liabilities.js";
import { resolveAnnualFinancialFact } from "./financialFacts.js";

export type ReadinessClass = "known_canonical" | "losslessly_derived" | "editable_suggestion_needs_acceptance" | "user_decision_required" | "unsupported";
export interface ReadinessField {
  readonly key: string;
  readonly classification: ReadinessClass;
  readonly value?: string;
  readonly reason: string;
  readonly sources: readonly string[];
  readonly scope: string;
  readonly asOf: string;
  readonly owner: "people" | "income" | "debt" | "plan";
  readonly options: readonly { id: string; label: string }[];
}

/** Calendar arithmetic only. Feb-29 birthdays use Feb-28 in a non-leap year. */
export function birthdayAtAge(dob: string, age: number): string | undefined {
  if (!utcDate(dob) || !Number.isSafeInteger(age) || age < 0) return undefined;
  const year = Number(dob.slice(0, 4)) + age;
  if (year > 9998) return undefined;
  const requested = `${String(year).padStart(4, "0")}${dob.slice(4)}`;
  return utcDate(requested) ? requested : dob.endsWith("-02-29") ? `${year}-02-28` : undefined;
}

/** Explicitly selected adults only; a missing/older anchor never invents a horizon. */
export function age90Horizon(model: PersonalDraft, personIds: readonly string[], start: string, targetAge = 90) {
  if (!utcDate(start) || !personIds.length || new Set(personIds).size !== personIds.length) return undefined;
  const people = objects(model, "Person");
  const targets = personIds.map(id => {
    const person = people.find(item => item.person_id === id);
    const dob = typeof person?.date_of_birth === "string" ? person.date_of_birth : "";
    const date = birthdayAtAge(dob, targetAge), adultAt = birthdayAtAge(dob, 18);
    const member = objects(model, "Household").some(household => household.household_id === person?.household_id && Array.isArray(household.members) && household.members.includes(id));
    return member && date && date > start && adultAt && adultAt <= start ? { personId: id, name: `${String(person?.first_name ?? "")} ${String(person?.last_name ?? "")}`.trim(), birthday: date } : undefined;
  });
  if (targets.some(target => !target)) return undefined;
  const known = targets.filter((target): target is NonNullable<typeof target> => target !== undefined);
  const through = known.map(target => target.birthday).sort().at(-1)!;
  // Monthly engine windows are half-open. Include the birthday's entire month.
  const year = Number(through.slice(0, 4)), month = Number(through.slice(5, 7));
  const end = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`;
  return { through, end, targets: known };
}

export function retirementProposals(model: PersonalDraft, asOf: string) {
  const plan = currentPlan(model);
  return objects(model, "Person").flatMap(person => {
    if (person.employment_status === "retired") return [];
    const incomes = objects(model, "Income").filter(income => income.owner_id === person.person_id && income.income_type === "salary" &&
      typeof income.start_date === "string" && income.start_date <= asOf && (income.end_date == null || String(income.end_date) > asOf));
    const date = typeof person.date_of_birth === "string" ? birthdayAtAge(person.date_of_birth, 65) : undefined;
    const saved = incomes.some(income => income.related_event_id != null || income.end_date != null) || objects(model, "Event").some(event => event.event_type === "retirement" && event.enabled === true && event.scenario_id === plan?.scenario_id && incomes.some(income => income.related_event_id === event.event_id));
    return incomes.length && date && date > asOf && !saved ? [{ personId: String(person.person_id), name: String(person.first_name ?? "Person"), date, incomeIds: incomes.map(income => String(income.income_id)) }] : [];
  });
}

/** Pure guidance: source facts and accepted choices are never written on read. */
export function resolveForecastReadiness(model: PersonalDraft, asOf: string, accepted?: PersonalHouseholdSessionExecutionConfiguration): readonly ReadinessField[] {
  const rows: ReadinessField[] = [];
  const people = objects(model, "Person").filter(person => objects(model, "Household").some(household => household.household_id === person.household_id && Array.isArray(household.members) && household.members.includes(person.person_id!)));
  const banks = objects(model, "Account").filter(account => ["checking", "savings", "cash"].includes(String(account.account_type)) && people.some(person => person.person_id === account.owner_id || person.household_id === account.owner_id));
  const bankOptions = banks.map(bank => ({ id: String(bank.account_id), label: String(bank.name ?? "Bank account") })).sort((a, b) => a.id.localeCompare(b.id));
  const personOptions = people.map(person => ({ id: String(person.person_id), label: `${String(person.first_name ?? "")} ${String(person.last_name ?? "")}`.trim() || "Person (name not recorded)" })).sort((a, b) => a.id.localeCompare(b.id));
  const add = (key: string, owner: ReadinessField["owner"], classification: ReadinessClass, reason: string, sources: string[], value?: string, options: ReadinessField["options"] = []) => rows.push({ key, owner, classification, reason, sources: [...sources].sort(), scope: model.modelId, asOf, options, ...(value === undefined ? {} : { value }) });
  const choice = (key: string, owner: ReadinessField["owner"], value: string | undefined, options: ReadinessField["options"]) => {
    const valid = options.some(option => option.id === value);
    if (value && !valid) {
      add(key, owner, "user_decision_required", "The accepted source is unavailable or incompatible in this household scope. Resolve the conflict explicitly; the saved choice is preserved.", [`accepted:${key}:${value}`], value, options);
      return;
    }
    add(key, owner, valid ? "known_canonical" : options.length === 1 ? "editable_suggestion_needs_acceptance" : "user_decision_required",
      valid ? "Explicit accepted execution choice for this household." : options.length === 1 ? `${options[0]!.label} is available; explicit acceptance is required.` : "Choose a named source; none is authorized by its position in the list.",
      valid ? [`accepted:${key}:${value}`] : options.map(option => option.id), valid ? value : options.length === 1 ? options[0]!.id : undefined, options);
  };
  let payroll: ReturnType<typeof durablePayrollWithholding> = [];
  try { payroll = durablePayrollWithholding(model); }
  catch (error) { add("payroll", "income", "unsupported", error instanceof Error ? error.message : "Conflicting paycheck evidence", ["PrimitiveInstance:payroll-withholding/v1"]); }
  const destinations = [...new Set(payroll.map(election => String(election.depositAccountId)))];
  if (!accepted?.cashFlowExecutionAccountId && destinations.length === 1 && objects(model, "Income").every(income => payroll.some(election => election.incomeId === income.income_id)) && banks.some(bank => bank.account_id === destinations[0])) add("cashAccount", "income", "losslessly_derived", "Receiving account explicitly authorized by durable payroll evidence.", payroll.map(election => election.id), destinations[0], bankOptions);
  else choice("cashAccount", "income", accepted?.cashFlowExecutionAccountId, bankOptions);
  choice("investmentOwner", "plan", accepted?.investmentExecutionOwnerId, personOptions);
  choice("debtOwner", "debt", accepted?.liabilityExecutionOwnerId, personOptions);
  const plan = currentPlan(model);
  add("planEnd", "plan", typeof plan?.end_date === "string" ? "known_canonical" : "user_decision_required", "Saved Current Plan dates take precedence over starter proposals.", plan ? [String(plan.scenario_id)] : [], typeof plan?.end_date === "string" ? plan.end_date : undefined);
  const issues = validatePersonalDraft(model);
  for (const [type, idField, owner, fields] of [
    ["Account", "account_id", "income", ["owner_id", "currency", "opening_date", "opening_balance"]],
    ["Income", "income_id", "income", ["owner_id", "amount", "frequency", "start_date", "gross_or_net"]],
    ["Expense", "expense_id", "income", ["owner_id", "amount", "frequency", "start_date", "payment_account_id"]],
    ["Investment", "investment_id", "plan", ["account_id", "quantity", "price", "market_value"]],
    ["Liability", "liability_id", "debt", ["owner_id", "principal", "current_balance", "interest_rate", "origination_date", "maturity_date", "payment_frequency"]],
  ] as const) for (const record of objects(model, type)) for (const field of fields) {
    const id = String(record[idField]), value = record[field];
    const problems = issues.filter(issue => issue.objectType === type && issue.objectId === id && issue.field === field);
    const known = value !== undefined && value !== null && problems.length === 0;
    add(`${type}:${id}:${field}`, owner, known ? "known_canonical" : "user_decision_required", problems.length ? problems.map(problem => problem.message).join(" ") : known ? "Recorded canonical fact; its existing unit, identity and date scope are preserved." : "Record the missing source fact in its existing owner.", [`${type}:${id}:${field}`], value == null ? undefined : String(value));
  }
  for (const person of people) {
    const dob = typeof person.date_of_birth === "string" ? person.date_of_birth : "";
    if (utcDate(dob) && utcDate(asOf) && dob <= asOf) {
      const age = Number(asOf.slice(0, 4)) - Number(dob.slice(0, 4)) - Number(asOf.slice(5) < dob.slice(5));
      add(`age:${person.person_id}`, "people", "losslessly_derived", "Calculated from the sourced birth date at this reference date.", [`Person:${person.person_id}:date_of_birth`], String(age));
    } else add(`age:${person.person_id}`, "people", "user_decision_required", "Record a valid birth date; no age is assumed.", [String(person.person_id)]);
    const filing = resolveAnnualFinancialFact(model, "filingStatus", { personId: String(person.person_id), householdId: String(person.household_id), taxYear: Number(asOf.slice(0, 4)) }, asOf);
    add(`filing:${person.person_id}`, "people", filing.value === undefined || filing.status === "true_conflict" ? "user_decision_required" : "known_canonical", filing.reason ?? "Annual filing facts apply only to their sourced year and household.", filing.sources.map(source => source.id), filing.value === undefined ? undefined : String(filing.value));
    const firstYear = Number(asOf.slice(0, 4)), end = String(plan?.end_date ?? "");
    for (let year = firstYear + 1; year <= 9998 && `${year}-01-01` < end; year++) {
      const annual = resolveAnnualFinancialFact(model, "filingStatus", { personId: String(person.person_id), householdId: String(person.household_id), taxYear: year }, asOf);
      add(`filing:${person.person_id}:${year}`, "people", annual.value === undefined || annual.status === "true_conflict" ? "user_decision_required" : "known_canonical", annual.reason ?? `Filing status must be established for ${year}; the opening year's status is not copied.`, annual.sources.map(source => source.id), annual.value === undefined ? undefined : String(annual.value));
    }
  }
  for (const loan of objects(model, "Liability").filter(item => item.liability_type === "mortgage")) {
    const id = String(loan.liability_id), profile = accepted?.liabilityExecutionProfiles.find(item => item.liabilityId === id);
    const first = profile?.paymentAnchor ?? "";
    const schedule = typeof loan.maturity_date === "string" ? mortgageRemainingSchedule(first, loan.maturity_date, asOf) : undefined;
    const conflict = schedule && (first <= String(loan.origination_date) || profile && profile.totalPayments !== schedule.total);
    add(`mortgage:${id}:schedule`, "debt", conflict ? "user_decision_required" : schedule ? "losslessly_derived" : "user_decision_required",
      conflict ? "First-payment, original count and maturity evidence disagree." : schedule ? `${schedule.remaining} remaining of ${schedule.total} original monthly payments; next ${schedule.next ?? "none"}.` : "What is the first contractual payment date? Confirm it in Debt.",
      [`Liability:${id}:maturity_date`, profile ? `accepted:mortgage:${id}` : `required:mortgage:${id}:firstPayment`], schedule && !conflict ? String(schedule.total) : undefined);
    choice(`mortgage:${id}:funding`, "debt", profile?.fundingAccountId, bankOptions);
  }
  return Object.freeze(rows.sort((a, b) => a.key.localeCompare(b.key)));
}
