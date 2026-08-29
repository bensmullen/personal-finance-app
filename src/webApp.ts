import { canonicalOpeningState, dollars, money, month, runVerticalSlicePeriod, type VerticalSliceInput } from "./verticalSlice1.js";

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

const currency = (value: bigint): string => dollars(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const numberValue = (name: string): string => {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input ${name}`);
  return input.value;
};

const render = (): void => {
  errorBox.hidden = true;
  try {
    const taxPercent = Number(numberValue("taxRate"));
    if (!Number.isFinite(taxPercent)) throw new Error("Tax rate must be a number");

    const input: VerticalSliceInput = {
      householdId: "demo-household",
      ownerId: "demo-person",
      checkingAccountId: "demo-checking",
      retirementAccountId: "demo-retirement",
      taxLiabilityId: "demo-tax-payable",
      monthlyGrossCompensation: money(numberValue("grossCompensation")),
      taxRateBasisPoints: Math.round(taxPercent * 100),
      retirementContribution: money(numberValue("retirementContribution")),
      monthlyLivingExpense: money(numberValue("livingExpenses")),
    };

    const result = runVerticalSlicePeriod({
      period: month(2026, 1),
      input,
      openingState: canonicalOpeningState(input),
    });

    const cards: Array<[string, bigint, string]> = [
      ["Checking", result.outputs.checkingCash, "Spendable cash after this month"],
      ["Retirement", result.outputs.retirementCash, "Still part of household assets"],
      ["Tax payable", result.outputs.taxPayable, "Outstanding recognized tax obligation"],
      ["Net worth", result.statements.netWorth, "Assets minus liabilities"],
      ["Income", result.statements.income, "Recognized compensation"],
      ["Expenses", result.statements.expenses, "Tax + living expenses"],
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
        <b>${currency(amount as bigint)}</b>
      </li>
    `).join("");

    transactions.innerHTML = result.transactions.map((tx) => {
      const amount = tx.legs.find((leg) => leg.posting === "debit")?.amount ?? 0n;
      return `<tr><td>${tx.type.replaceAll("_", " ")}</td><td>${currency(amount)}</td><td>${tx.cashFlowClass.replaceAll("_", " ")}</td></tr>`;
    }).join("");
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
  }
};

form.addEventListener("input", render);
form.addEventListener("submit", (event) => { event.preventDefault(); render(); });
render();
