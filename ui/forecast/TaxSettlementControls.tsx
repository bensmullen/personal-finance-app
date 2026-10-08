import { compileForecastTaxSettlements, type TaxForecastSettlementSetup } from "../../src/application/taxForecastSetup.js";
import { FieldShell, FinancialInput, FinancialSection, RepairSummary } from "../authoring/FieldShell.js";
import { financialField, fieldProblem } from "../authoring/fieldContract.js";

export function TaxSettlementControls({ accounts, jurisdictions, value, onChange, start, end }: { accounts: readonly { id: string; label: string }[]; jurisdictions: readonly string[]; value: TaxForecastSettlementSetup | undefined; onChange: (value: TaxForecastSettlementSetup) => void; start: string; end: string }) {
  const setup = value ?? { paymentAccountId: "", refundAccountId: "", conventions: [] };
  const conventions = jurisdictions.map((jurisdiction, index) => setup.conventions.find(item => item.jurisdiction === jurisdiction) ?? { jurisdiction, monthDay: "", priority: index, confirmed: false });
  const update = (jurisdiction: string, changes: Partial<TaxForecastSettlementSetup["conventions"][number]>) => onChange({ ...setup, conventions: conventions.map(item => item.jurisdiction === jurisdiction ? { ...item, ...changes } : item) });
  const options = accounts.map(account => ({ value: account.id, label: account.label }));
  const dateProblem = (item: TaxForecastSettlementSetup["conventions"][number]) => {
    const format = fieldProblem(financialField("taxDate"), item.monthDay, true);
    if (format || !setup.paymentAccountId || !setup.refundAccountId || fieldProblem(financialField("taxPriority"), item.priority, true)) return format;
    try { compileForecastTaxSettlements({ ...setup, conventions: [{ ...item, confirmed: true }] }, start, end); }
    catch { return "This payment date cannot be scheduled for the selected forecast years. Review the month/day and forecast period."; }
    return undefined;
  };
  const problems = conventions.flatMap(item => {
    const date = dateProblem(item);
    const priority = fieldProblem(financialField("taxPriority"), item.priority, true);
    return [...(date ? [{ target: `tax:${item.jurisdiction}:date`, message: `${taxLocation(item.jurisdiction)}: ${date}` }] : []), ...(priority ? [{ target: `tax:${item.jurisdiction}:priority`, message: priority }] : []), ...(!item.confirmed && !date && !priority ? [{ target: `tax:${item.jurisdiction}:confirm`, message: `${taxLocation(item.jurisdiction)}: confirm the forecast convention.` }] : [])];
  });
  return <section aria-label="Tax payments & refunds" data-tax-setup>
    <h3>Tax payments &amp; refunds</h3><p>Choose where modeled taxes are paid and refunded. Payment dates are forecast conventions.</p>
    <RepairSummary errors={problems} />
    <div className="guided-grid">
      <FinancialInput fieldKey="taxPayment" value={setup.paymentAccountId} required options={options} onChange={paymentAccountId => onChange({ ...setup, conventions, paymentAccountId })} error={setup.paymentAccountId && !accounts.some(item => item.id === setup.paymentAccountId) ? "Choose an available checking or savings account." : undefined} />
      <FinancialInput fieldKey="taxRefund" value={setup.refundAccountId} required options={options} onChange={refundAccountId => onChange({ ...setup, conventions, refundAccountId })} error={setup.refundAccountId && !accounts.some(item => item.id === setup.refundAccountId) ? "Choose an available checking or savings account." : undefined} />
    </div>
    {conventions.map(item => <FinancialSection key={item.jurisdiction} title={taxLocation(item.jurisdiction)} attention={!item.confirmed}>
      <FinancialInput fieldKey="taxDate" repairKey={`tax:${item.jurisdiction}:date`} value={item.monthDay} error={dateProblem(item)} required onChange={monthDay => update(item.jurisdiction, { monthDay, confirmed: false })} />
      <button type="button" onClick={() => update(item.jurisdiction, { monthDay: "04-15", confirmed: false })}>Suggest April 15 for {taxLocation(item.jurisdiction)}</button>
      <FinancialSection title="Same-day payment order">
        <FinancialInput fieldKey="taxPriority" repairKey={`tax:${item.jurisdiction}:priority`} value={String(item.priority)} required onChange={priority => update(item.jurisdiction, { priority: Number(priority), confirmed: false })} />
      </FinancialSection>
      <FieldShell fieldKey="taxConfirm" repairKey={`tax:${item.jurisdiction}:confirm`} error={!item.confirmed ? "Review and confirm this forecast date and payment order." : undefined}>
        <input type="checkbox" aria-label={`Confirm ${item.jurisdiction} forecast settlement convention`} checked={item.confirmed} disabled={!!dateProblem(item) || !!fieldProblem(financialField("taxPriority"), item.priority, true)} onChange={event => update(item.jurisdiction, { confirmed: event.target.checked })} />
      </FieldShell>
    </FinancialSection>)}
    <small>Unsupported state or local taxes remain partially modeled after setup.</small>
    <details><summary>Forecast payment assumptions</summary><p>Dates fall in the following year and may be outside the selected run window. They are not legal filing deadlines. Estimated payments require separate recorded amounts and dates.</p></details>
  </section>;
}
function taxLocation(value: string): string {
  return ({ "US:FEDERAL": "Federal income tax", "US:NY": "New York", "US:CO": "Colorado", "US:PA": "Pennsylvania", "US:CA": "California", "US:PA:PHILADELPHIA:WAGE": "Philadelphia wage tax", "US:CO:DENVER:OPT": "Denver occupational tax" } as Record<string, string>)[value] ?? value.replace(/^US:/, "").replaceAll(":", " · ");
}
