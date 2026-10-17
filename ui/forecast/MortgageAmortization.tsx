"use client";
import * as React from "react";
import { liabilityBalanceCoordinates, mortgageBarCoordinates, mortgageWindowTotals, type LiabilityBalanceWindow, type MortgageWindow } from "../../src/application/mortgageChartData.js";
import { formatExactMoney } from "../entityPresentation.js";

export function LiabilityBalanceOutlook({ data, selectedStart, selectMonth }: {
  data: LiabilityBalanceWindow; selectedStart: string; selectMonth: (month: string) => void;
}) {
  const selected = data.rows.find(row => row.start === selectedStart) ?? data.rows[0]!;
  const coordinates = liabilityBalanceCoordinates(data.rows);
  return <section className="liability-balance-outlook" aria-label="Household liability balance outlook" data-evidence-state={data.status}>
    <h2>Household liability balance outlook</h2>
    <p>Reconciled household forecast · all modeled liabilities, including supported nonmortgage balances. Unsupported debt is not projected from mortgage paydown.</p>
    <p>Modeled opening balance at {data.opening.at.slice(0, 10)}: {data.opening.supported ? formatExactMoney(data.opening.amount, data.opening.currency) : "Unavailable · incomplete source coverage"}.</p>
    <label>Selected liability month<select aria-label="Selected liability month" value={selected.start} onChange={event => selectMonth(event.target.value)}>
      {data.rows.map(row => <option key={row.start} value={row.start}>{row.start.slice(0, 10)} → {row.end.slice(0, 10)} (exclusive)</option>)}
    </select></label>
    <figure aria-label="Modeled household liability balances">
      <figcaption>Ending liability balances · {data.rows[0]!.start.slice(0, 10)} to {data.rows.at(-1)!.end.slice(0, 10)} (exclusive)</figcaption>
      <div className="mortgage-columns">{data.rows.map((row, index) => <button key={row.start} type="button" className="mortgage-month" aria-pressed={row.start === selected.start}
        aria-label={`${row.start.slice(0, 7)}: ${row.supported ? `ending household liabilities ${formatExactMoney(row.amount, row.currency)}` : "liability forecast incomplete"}`} onClick={() => selectMonth(row.start)}>
        <span className="mortgage-column" aria-hidden="true"><span className="mortgage-series-1" style={{ height: `${coordinates[index]}%` }} /></span><span>{row.start.slice(5, 7)}{!row.supported && " ?"}</span>
      </button>)}</div>
      <p role="status">{selected.supported ? `Ending modeled household liabilities at ${selected.end.slice(0, 10)}: ${formatExactMoney(selected.amount, selected.currency)}.` : "Selected liability balance is incomplete; no supported balance bar is shown."}</p>
    </figure>
    {data.status === "incomplete" && <p>Partial source coverage · only supported committed periods are shown. Incomplete amounts are unavailable.</p>}
    <details><summary>Exact household liability balances</summary><div className="mortgage-table-scroll" tabIndex={0} role="region" aria-label="Exact household liability data">
      <table><caption>Reconciled modeled liabilities · period ends are exclusive</caption><thead><tr><th scope="col">Period</th><th scope="col">Ending liabilities</th><th scope="col">Source status</th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.start}><th scope="row">{row.start.slice(0, 10)} → {row.end.slice(0, 10)}</th><td>{row.supported ? formatExactMoney(row.amount, row.currency) : "Unavailable"}</td><td>{row.supported ? "Committed household forecast" : "Incomplete coverage"}</td></tr>)}</tbody>
      </table></div></details>
  </section>;
}

export function MortgageAmortization({ window, selectedStart, selectMonth, loanName }: {
  window: MortgageWindow; selectedStart: string; selectMonth: (month: string) => void; loanName: string;
}) {
  const selected = window.rows.find(row => row.start === selectedStart) ?? window.rows[0]!;
  const totals = mortgageWindowTotals(window, selected.start), coordinates = mortgageBarCoordinates(window.rows);
  const amount = (value: string) => formatExactMoney(value, selected.currency);
  const series = ["Interest paid", "Scheduled principal paid", "Extra principal paid"];
  return <section className="mortgage-amortization" aria-label="Mortgage amortization" data-evidence-state={window.status}>
    <h2>{loanName} · mortgage paydown</h2>
    <p>Modeled cash paid · {selected.currency}. Principal repays debt; interest is expense.</p>
    <label>Selected mortgage month<select aria-label="Selected mortgage month" value={selected.start} onChange={event => selectMonth(event.target.value)}>
      {window.rows.map(row => <option key={row.start} value={row.start}>{row.start.slice(0, 10)} → {row.end.slice(0, 10)} (exclusive)</option>)}
    </select></label>
    <figure aria-label={`${loanName} monthly cash paid`}>
      <figcaption>Cash actually paid in the modeled forecast · {window.start.slice(0, 10)} to {window.end.slice(0, 10)} (exclusive)</figcaption>
      <ul className="mortgage-legend" aria-label="Mortgage cash paid legend">{series.map((label, index) => <li key={label}><span className={`mortgage-series-${index}`} aria-hidden="true" />{label}</li>)}</ul>
      <div className="mortgage-columns">{window.rows.map((row, index) => <button key={row.start} type="button" className="mortgage-month" aria-pressed={row.start === selected.start}
        aria-label={`${row.start.slice(0, 7)}: interest paid ${formatExactMoney(row.interestPaid, row.currency)}, scheduled principal paid ${formatExactMoney(row.scheduledPrincipalPaid, row.currency)}, extra principal paid ${formatExactMoney(row.extraPrincipalPaid, row.currency)}`}
        onClick={() => selectMonth(row.start)}>
        <span className="mortgage-column" aria-hidden="true">{coordinates[index]!.map((height, category) => <span key={category} className={`mortgage-series-${category}`} style={{ height: `${height}%` }} />)}</span>
        <span>{row.start.slice(5, 7)}</span>
      </button>)}</div>
      <p className="mortgage-readout" role="status">{selected.start.slice(0, 7)} · Interest paid {amount(selected.interestPaid)} · Scheduled principal paid {amount(selected.scheduledPrincipalPaid)} · Extra principal paid {amount(selected.extraPrincipalPaid)}</p>
    </figure>
    <dl className="mortgage-summary">
      <dt>Opening loan principal</dt><dd>{amount(selected.openingPrincipal)}</dd>
      <dt>Ending modeled loan principal</dt><dd>{amount(selected.endingPrincipal)}</dd>
      <dt>Scheduled funding</dt><dd>{selected.funding.replaceAll("_", " ")}</dd>
      <dt>Extra funding</dt><dd>{selected.extraFunding.replaceAll("_", " ")}</dd>
    </dl>
    {selected.interestPaid === "0" && selected.scheduledPrincipalPaid === "0" && selected.extraPrincipalPaid === "0" && <p>No cash payment posted in this month. Accrued interest and amounts due are not paid amounts.</p>}
    {!selected.reconciled && <p role="status">Partial principal coverage · a payoff, replacement or unmatched principal movement prevents a paid-only principal reconciliation. Totals across this boundary are unavailable.</p>}
    {totals ? <p>{totals.fromForecastStart ? "Cumulative paid from forecast start" : "Window-to-date paid"} · {totals.start.slice(0, 10)} to {totals.end.slice(0, 10)} (exclusive): interest {amount(totals.interest)}; principal {amount(totals.principal)}.{!totals.fromForecastStart && " Full forecast cumulative amounts are unavailable for this window."}</p>
      : <p>Cumulative paid amounts unavailable: principal or contiguous period coverage could not be reconciled.</p>}
    <p>Escrow, property taxes, insurance and refinance costs are separate. Loan paydown alone does not establish future home equity.</p>
    <details><summary>Exact mortgage payments &amp; sources</summary>
      <div className="mortgage-table-scroll" tabIndex={0} role="region" aria-label="Exact mortgage payment data">
        <table><caption>{loanName} · {selected.currency} · modeled months [start, end)</caption>
          <thead><tr>{["Period (end exclusive)", "Opening principal", ...series, "Ending principal", "Scheduled due (not paid)", "Interest accrued (not paid)", "Funding"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{window.rows.map(row => <tr key={row.start}><th scope="row">{row.start.slice(0, 10)} → {row.end.slice(0, 10)}</th>
            {[row.openingPrincipal, row.interestPaid, row.scheduledPrincipalPaid, row.extraPrincipalPaid, row.endingPrincipal, row.scheduledDue, row.interestAccrued].map((value, index) => <td key={index}>{formatExactMoney(value, row.currency)}</td>)}
            <td>{row.funding.replaceAll("_", " ")} / {row.extraFunding.replaceAll("_", " ")}</td></tr>)}</tbody>
        </table>
      </div>
      <details><summary>Posted transaction evidence</summary>{window.rows.map(row => <div key={row.start}><h3>{row.start.slice(0, 7)}</h3><p>Loan identity: {window.loanId}. Principal source: {window.liabilityId}. Forecast fingerprint: {window.fingerprint}.</p>
        <p>Funding accounts: {row.accountIds.join(", ") || "No cash posting"}</p><ul>{row.sourceIds.map(id => <li key={id}>{id}</li>)}</ul></div>)}</details>
    </details>
  </section>;
}
