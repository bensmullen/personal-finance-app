import { Money, Percentage, RoundingPolicy, canonicalOpeningState, createFundingPolicy, domainId, formatMoney, fundingPolicyId, money, runVerticalSlicePeriod, summarizeCashFlowClass, utcMonth, type VerticalSliceInput } from "./verticalSlice1.js";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const form = byId<HTMLFormElement>("scenario-form");
const errorBox = byId<HTMLDivElement>("error");
const summary = byId<HTMLDivElement>("summary");
const timeline = byId<HTMLOListElement>("timeline");
const transactions = byId<HTMLTableSectionElement>("transactions");

const currency = (value: Money): string =>
  formatMoney(value, RoundingPolicy.currency(value.currency.minorUnitScale, "half_up"))
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const numberValue = (name: string): string => {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input ${name}`);
  return input.value;
};

const render = (): void => {
  errorBox.hidden = true;
  try {
    const checkingAccountId = domainId("account", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const input: VerticalSliceInput = {
      householdId: domainId("household", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      ownerId: domainId("person", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      checkingAccountId,
      retirementAccountId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
      taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      monthlyGrossCompensation: money(numberValue("grossCompensation")),
      taxRate: Percentage.parse(numberValue("taxRate")).toRatio(),
      retirementContribution: money(numberValue("retirementContribution")),
      monthlyLivingExpense: money(numberValue("livingExpenses")),
      taxFundingPolicy: createFundingPolicy({
        id: fundingPolicyId("funding:tax:checking"),
        orderedSources: [{ kind: "cash_account", accountId: checkingAccountId }],
        allowPartial: false,
        insufficientFundsBehavior: "unfunded",
      }),
    };

    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    });

    const cards: Array<[string, Money, string]> = [
      ["Checking", result.outputs.checkingCash, "Spendable cash after this month"],
      ["Retirement", result.outputs.retirementCash, "Still part of household assets"],
      ["Tax payable", result.outputs.taxPayable, "Outstanding recognized tax obligation"],
      ["Net worth", result.statements.netWorth, "Assets minus liabilities"],
      ["Income", result.statements.income, "Recognized compensation"],
      ["Expenses", result.statements.expenses, "Tax + living expenses"],
      ["Net income", result.statements.netIncome, "Income minus recognized expenses"],
      ["Operating cash flow", result.statements.operatingCashFlow, "External operating cash movement"],
      ["Total assets", result.statements.assets, "Checking + retirement cash"],
    ];

    summary.innerHTML = cards.map(([label, value, detail]) => `
      <article class="metric">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${currency(value)}</div>
        <div class="metric-detail">${detail}</div>
      </article>
    `).join("");

    const timelineItems = [
      ["Compensation received", result.outputs.grossCompensation, "cash in"],
      ["Tax recognized and settled", result.outputs.taxExpense, "expense + cash out"],
      ["Retirement contribution", result.outputs.retirementContribution, "internal transfer"],
      ["Living expenses paid", result.outputs.livingExpenses, "cash out"],
    ];
    timeline.innerHTML = timelineItems.map(([label, amount, kind]) => `
      <li>
        <div><strong>${label}</strong><span>${kind}</span></div>
        <b>${currency(amount as Money)}</b>
      </li>
    `).join("");

    transactions.innerHTML = result.transactions.map((tx) => {
      const amount = tx.legs.find((leg) => leg.posting === "debit")!.amount;
      return `<tr><td>${tx.type.replaceAll("_", " ")}</td><td>${currency(amount)}</td><td>${summarizeCashFlowClass(tx).replaceAll("_", " ")}</td></tr>`;
    }).join("");
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
  }
};

form.addEventListener("input", render);
form.addEventListener("submit", (event) => { event.preventDefault(); render(); });
render();
