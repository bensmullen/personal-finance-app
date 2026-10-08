import type { TaxForecastSettlementSetup } from "../../src/application/taxForecastSetup.js";

export function TaxSettlementControls({ accounts, jurisdictions, value, onChange }: { accounts: readonly { id: string; label: string }[]; jurisdictions: readonly string[]; value: TaxForecastSettlementSetup | undefined; onChange: (value: TaxForecastSettlementSetup) => void }) {
  const setup = value ?? { paymentAccountId: "", refundAccountId: "", conventions: [] };
  const conventions = jurisdictions.map((jurisdiction, index) => setup.conventions.find(item => item.jurisdiction === jurisdiction) ?? { jurisdiction, monthDay: "", priority: index, confirmed: false });
  const update = (jurisdiction: string, changes: Partial<TaxForecastSettlementSetup["conventions"][number]>) => onChange({ ...setup, conventions: conventions.map(item => item.jurisdiction === jurisdiction ? { ...item, ...changes } : item) });
  return <section aria-label="Tax payments & refunds">
    <h3>Tax payments &amp; refunds</h3>
    <p>These session choices schedule modeled tax balances and refunds. Choose a month/day in the following year for each jurisdiction. This is your forecast convention; it is not a legal filing deadline. Estimated payments require separately authored amounts and dates.</p>
    {(["paymentAccountId", "refundAccountId"] as const).map(field => <label key={field}>{field === "paymentAccountId" ? "Tax payment account" : "Tax refund account"}<select aria-label={field === "paymentAccountId" ? "Tax payment account" : "Tax refund account"} value={setup[field]} onChange={event => onChange({ ...setup, conventions, [field]: event.target.value })}><option value="">Choose checking or savings</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>)}
    {conventions.map(item => <fieldset key={item.jurisdiction}><legend>{item.jurisdiction}</legend>
      <label>Following-year settlement month/day<input aria-label={`${item.jurisdiction} settlement month/day`} placeholder="MM-DD" value={item.monthDay} onChange={event => update(item.jurisdiction, { monthDay: event.target.value, confirmed: false })} /></label>
      <button type="button" onClick={() => update(item.jurisdiction, { monthDay: "04-15", confirmed: false })}>Suggest April 15 for {item.jurisdiction}</button>
      <label>Same-date tax payment order<input aria-label={`${item.jurisdiction} tax payment order`} type="number" min="0" value={item.priority} onChange={event => update(item.jurisdiction, { priority: Number(event.target.value), confirmed: false })} /></label>
      <label><input type="checkbox" aria-label={`Confirm ${item.jurisdiction} forecast settlement convention`} checked={item.confirmed} onChange={event => update(item.jurisdiction, { confirmed: event.target.checked })} />I confirm this forecast settlement date and payment order (lower numbers first).</label>
    </fieldset>)}
    <p>Settlements for modeled years remain scheduled even when their dates fall after the simulation window. Unsupported state/local liability remains partially modeled after setup.</p>
  </section>;
}
