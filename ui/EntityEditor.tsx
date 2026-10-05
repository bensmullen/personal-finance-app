"use client";

import { useEffect, useRef, useState } from "react";
import { addPersonalObject, deletePersonalObject, patchPersonalObject, type getPersonalEditorMetadata, type JsonObject, type PersonalDraft, type PersonalObjectType } from "../src/application/personalMvp.js";
import { objectEntries, objectId, objectLabel, entitySummary, referenceLabel, referenceTargets, formatExactMoney, formatRate, isCashFlowPaymentAccount, belongsToNetWorthSection, linkedReturnAssumption, type NetWorthSection } from "./entityPresentation.js";

const randomId = () => crypto.randomUUID();
interface EditorField {
  readonly type: string;
  readonly required: boolean;
  readonly derived: boolean;
  readonly mutable: boolean;
  readonly default: unknown;
  readonly ref?: string;
  readonly enumValues?: readonly string[];
}
const EXPERT_FIELDS = new Set([
  "expected_return", "volatility", "stochastic", "valuation_method", "rate_type",
  "tax_treatment", "liquidity_class", "scenario_id", "parent_scenario_id", "timestep", "simulation_count", "seed",
  "distribution", "distribution_type", "correlation_group",
]);
const internalReference = (field: EditorField) => field.type === "object" || Boolean(field.ref && referenceTargets(field.ref).length === 0);
const FIELD_HELP: Record<string, string> = {
  amount: "Amount per occurrence, using the frequency selected here.",
  opening_balance: "Internal account cash at the opening position, excluding holdings valued separately. Changing this does not represent a new deposit or withdrawal.",
  acquisition_cost: "Recorded acquisition cost. Valuation depends on the supported model.",
  principal: "Original borrowed amount, distinct from the remaining balance.",
  current_balance: "Remaining debt at the model's opening position.",
  extra_payment: "Optional extra principal payment in addition to required debt service.",
  interest_rate: "Decimal rate: 0.0525 means 5.25%. Supported fixed monthly debt uses a nominal annual rate.",
  expected_return: "Direct Expected return is not supported by the deterministic forecast. Use the existing linked return assumption under Plan → Assumptions, or Plan → What If? → Change investment returns.",
  volatility: "Volatility belongs to future probabilistic forecasting and is not supported by the current deterministic forecast.",
  stochastic: "Stored scenario setting; this view runs deterministic forecasts only.",
  quantity: "Number of investment units; this is not a money amount.",
  end_date: "Exclusive end: this item applies before this date.",
  start_date: "Inclusive start: this item applies from this date.",
  tax_treatment: "Recorded classification; this does not imply supported tax calculations.",
  value: "Use the unit specified for this assumption.",
};
const TITLES: Record<PersonalObjectType, string> = {
  Household: "Households",
  Person: "People",
  Account: "Accounts",
  Income: "Income",
  Expense: "Spending",
  Asset: "Property & other assets",
  Liability: "Debt",
  Investment: "Investments",
  Assumption: "Assumptions",
  Scenario: "Plans & what-ifs",
};
const FIELD_LABELS: Record<string, string> = {
  price: "Price",
  market_value: "Market value",
  payment_frequency: "Payment frequency",
  source: "Source / name",
  owner_id: "Owner",
  income_type: "Income type",
  amount: "Amount",
  frequency: "Frequency",
  start_date: "Start",
  end_date: "End",
  category: "Description / category",
  essentiality: "Essential or discretionary",
  payment_account_id: "Funding account",
  name: "Name",
  account_type: "Account type",
  institution: "Institution",
  opening_balance: "Balance",
  currency: "Currency",
  liquidity_class: "Liquidity",
  tax_treatment: "Tax treatment",
  asset_type: "Asset type",
  acquisition_date: "Acquisition date",
  acquisition_cost: "Acquisition cost",
  valuation_method: "Valuation method",
  principal: "Original principal",
  current_balance: "Current balance",
  interest_rate: "Interest rate",
  rate_type: "Rate type",
  extra_payment: "Extra payment",
  origination_date: "Origination",
  maturity_date: "Maturity",
  collateral_id: "Collateral",
  investment_type: "Investment type",
  symbol: "Symbol",
  quantity: "Quantity",
  expected_return: "Expected return",
  first_name: "First name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  residence_jurisdiction: "Residence jurisdiction",
  household_type: "Household type",
  formation_date: "Formation date",
  primary_jurisdiction: "Primary jurisdiction",
  value: "Value",
  unit: "Unit",
  description: "Description",
  household_id: "Household",
  account_id: "Investment account",
  growth_model_id: "Growth model",
  amortization_model_id: "Debt repayment model",
  fee_rule_id: "Fee rule",
  contribution_model_id: "Contribution model",
  return_model_id: "Return model",
  rebalancing_rule_id: "Rebalancing rule",
  related_event_id: "Linked life event",
  distribution_parameters: "Distribution parameters",
  volatility: "Volatility",
};
const RETIREMENT_LIMITATION = "Recurring retirement contributions are not currently authorable through this editor. Do not model a contribution as Spending paid to a retirement account. Supported investment operations must be explicitly configured; this is a pre-alpha capability limitation.";
const PRIMARY_FIELDS: Record<PersonalObjectType, readonly string[]> = {
  Household: [
    "name",
    "household_type",
    "formation_date",
    "primary_jurisdiction",
  ],
  Person: [
    "first_name",
    "last_name",
    "date_of_birth",
    "residence_jurisdiction",
    "household_id",
  ],
  Account: [
    "name",
    "account_type",
    "owner_id",
    "institution",
    "opening_balance",
    "currency",
    "liquidity_class",
    "tax_treatment",
    "opening_date",
  ],
  Income: [
    "source",
    "owner_id",
    "income_type",
    "amount",
    "frequency",
    "start_date",
    "end_date",
  ],
  Expense: [
    "category",
    "owner_id",
    "amount",
    "frequency",
    "start_date",
    "end_date",
    "essentiality",
    "payment_account_id",
  ],
  Asset: [
    "name",
    "asset_type",
    "owner_id",
    "acquisition_cost",
    "acquisition_date",
    "valuation_method",
    "liquidity_class",
  ],
  Liability: [
    "name",
    "liability_type",
    "owner_id",
    "current_balance",
    "principal",
    "interest_rate",
    "rate_type",
    "payment_frequency",
    "extra_payment",
    "origination_date",
    "maturity_date",
    "collateral_id",
  ],
  Investment: [
    "investment_type",
    "account_id",
    "symbol",
    "quantity",
    "expected_return",
    "tax_treatment",
  ],
  Assumption: [
    "name",
    "category",
    "value",
    "unit",
    "start_date",
    "end_date",
    "scenario_id",
  ],
  Scenario: [
    "name",
    "description",
    "start_date",
    "end_date",
    "enabled",
    "stochastic",
  ],
};

export function EditorHub({
  types,
  draft,
  setDraft,
  metadata,
  setNotice,
  currency,
  section,
  selectedScenarioId,
}: {
  types: readonly PersonalObjectType[];
  draft: PersonalDraft;
  setDraft: (draft: PersonalDraft) => void;
  metadata: ReturnType<typeof getPersonalEditorMetadata>;
  setNotice: (message: string) => void;
  currency: string;
  section?: NetWorthSection;
  selectedScenarioId?: string;
}) {
  return (
    <>
      {section === "Investments & retirement" && <p role="note">Investment holdings are assets too. Account wrappers and their holdings appear together here because they have different forecast behavior from cash and property. An account contains its holdings; these lists are not amounts to add together.</p>}
      {types.map((type) => (
        <ObjectEditor
          key={type}
          type={type}
          draft={draft}
          setDraft={setDraft}
          metadata={metadata}
          setNotice={setNotice}
          currency={currency}
          section={section}
          selectedScenarioId={selectedScenarioId}
        />
      ))}
    </>
  );
}
function ProjectedReturn({ investment, draft, setDraft, selectedScenarioId }: {
  investment: JsonObject; draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; selectedScenarioId?: string;
}) {
  const assumption = linkedReturnAssumption(draft, investment, selectedScenarioId);
  const [rate, setRate] = useState(String(assumption?.value ?? ""));
  useEffect(() => { setRate(String(assumption?.value ?? "")); }, [assumption?.assumption_id, assumption?.value]);
  const negative = /^-(\d+)(?:\.(\d+))?$/.exec(rate);
  const belowTotalLoss = negative && negative[1] !== "0" && (negative[1] !== "1" || /[1-9]/.test(negative[2] ?? ""));
  const valid = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate) && !belowTotalLoss;
  if (!assumption) return <p role="note">Projected annual return is unavailable: this investment has no supported linked deterministic return assumption in the current plan. Plan → Assumptions can edit existing assumptions; creating the executable relationship is not supported here. Import a model with a supported linked return model to establish it.</p>;
  return <section aria-label={`Projected return for ${objectLabel("Investment", investment)}`}>
    <label>Projected annual return
      <input aria-label="Projected annual return" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
    </label>
    <p>Effective annual rate: {rate} = {formatRate(rate)}. Baseline assumption: {objectLabel("Assumption", assumption)}. This changes the linked assumption, including any other holdings that share it.</p>
    {!valid && <p role="alert">Enter an exact effective annual decimal rate of at least −1, such as 0.08 = 8%. Returns below a total loss are unsupported.</p>}
    <button type="button" disabled={!valid || rate === String(assumption.value)} onClick={() => setDraft(patchPersonalObject(draft, "Assumption", objectId("Assumption", assumption), { value: rate }))}>Apply projected return</button>
  </section>;
}
function ObjectEditor({
  type,
  draft,
  setDraft,
  metadata,
  setNotice,
  currency,
  section,
  selectedScenarioId,
}: {
  type: PersonalObjectType;
  draft: PersonalDraft;
  setDraft: (draft: PersonalDraft) => void;
  metadata: ReturnType<typeof getPersonalEditorMetadata>;
  setNotice: (message: string) => void;
  currency: string;
  section?: NetWorthSection;
  selectedScenarioId?: string;
}) {
  const [editing, setEditing] = useState<JsonObject>();
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState("");
  const drawer = useRef<HTMLElement>(null);
  const editingId = editing ? objectId(type, editing) : undefined;
  useEffect(() => {
    if (!editingId) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [editingId]);
  const values = objectEntries(draft, type).filter((item) => belongsToNetWorthSection(draft, type, item, section));
  const descriptor = metadata[type];
  const fields = descriptor.fields as Record<string, EditorField>;
  const close = () => { setEditing(undefined); setCreating(false); setCreationError(""); };
  const add = () => {
    const id = randomId();
    const initial: Record<string, string | boolean | number | readonly string[]> = { [descriptor.idField]: id };
    for (const [name, field] of Object.entries(fields)) {
      if (field.derived || name === descriptor.idField || internalReference(field) ||
        (type === "Investment" && ["expected_return", "volatility"].includes(name))) continue;
      const value = field.default;
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        if (["money", "rate", "decimal"].includes(field.type) && !/^-?\d+(\.\d+)?$/.test(String(value))) continue;
        initial[name] = value;
      }
    }
    setCreating(true);
    setCreationError("");
    setEditing(initial);
  };
  const create = () => {
    if (!editing) return;
    const missing = Object.entries(fields).filter(([name, field]) => name !== descriptor.idField &&
      !field.derived && !field.mutable && field.required &&
      (editing[name] === undefined || editing[name] === null || editing[name] === ""));
    if (missing.length) {
      setCreationError("Complete the creation-time facts: " + missing.map(([name]) => FIELD_LABELS[name] ?? name.replaceAll("_", " ")).join(", "));
      return;
    }
    const next = addPersonalObject(draft, type, objectId(type, editing), editing);
    setDraft(next);
    close();
  };
  const saveField = (
    field: string,
    value: string | boolean | readonly string[] | null,
  ) => {
    if (!editing) return;
    if (type === "Investment" && ["expected_return", "volatility"].includes(field) && value !== null) return;
    if (creating) {
      setEditing({ ...editing, [field]: value });
      return;
    }
    if (fields[field]?.mutable === false && editing[field] !== undefined) return;
    const next = patchPersonalObject(draft, type, objectId(type, editing), {
      [field]: value,
    });
    setDraft(next);
    setEditing(
      objectEntries(next, type).find(
        (item) => objectId(type, item) === objectId(type, editing),
      ),
    );
  };
  const editableFields = Object.keys(fields).filter((name) =>
    name !== descriptor.idField && !fields[name]!.derived && !internalReference(fields[name]!));
  const commonFields = editableFields.filter((name) =>
    (PRIMARY_FIELDS[type].includes(name) && !EXPERT_FIELDS.has(name)) || (creating && !fields[name]!.mutable));
  const secondaryFields = editableFields.filter((name) => !commonFields.includes(name) && !EXPERT_FIELDS.has(name));
  const expertFields = editableFields.filter((name) => EXPERT_FIELDS.has(name) && !commonFields.includes(name));
  const managedFields = Object.keys(fields).filter((name) => internalReference(fields[name]!));
  const remove = (item: JsonObject) => {
    const result = deletePersonalObject(draft, type, objectId(type, item));
    if (!result.deleted) {
      setNotice("Cannot delete: other model records still refer to this item. Review its relationships before deleting.");
      return;
    }
    setDraft(result.draft);
    setEditing(undefined);
  };
  return (
    <section>
      <div className="page-head compact">
        <div>
          <h1>{section && type === "Account" ? section === "Cash & bank accounts" ? section : "Investment & retirement accounts" : section && type === "Investment" ? "Investment holdings" : TITLES[type]}</h1>
          <p>Review names, amounts, and relationships. Model details are available inside each item.</p>
          {type === "Asset" && <p>Use Investments & retirement for securities and positions in investment accounts. Property & other assets is for standalone real estate, vehicles, businesses, personal property, and other non-security resources. Do not duplicate cash or securities here.</p>}
        </div>
        <button className="primary" onClick={add}>
          + Add {type}
        </button>
      </div>
      {(type === "Investment" || type === "Account") && <p className="reference-state" role="note">{RETIREMENT_LIMITATION}</p>}
      {values.length === 0 ? (
        <p className="empty">No {TITLES[type].toLowerCase()} yet.</p>
      ) : (
        <div className="object-grid">
          {values.map((item) => (
            <article className="object-card" key={objectId(type, item)}>
              <button className="card-main" onClick={() => { setCreating(false); setEditing(item); }}>
                <span className="object-icon">{TITLES[type][0]}</span>
                <span>
                  <strong id={`${type}-${objectId(type, item)}-label`}>{objectLabel(type, item) || `New ${type}`}</strong>
                  <small>
                    {entitySummary(type, item, draft, currency)}
                  </small>
                </span>
              </button>
              {type === "Investment" && <ProjectedReturn investment={item} draft={draft} setDraft={setDraft} selectedScenarioId={selectedScenarioId} />}
              <button className="danger-link" aria-describedby={`${type}-${objectId(type, item)}-label`} onClick={() => remove(item)}>
                Delete
              </button>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <div
          className="drawer-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <aside ref={drawer} className="drawer" role="dialog" aria-modal="true" aria-label={`${creating ? "Create" : "Edit"} ${type}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); close(); }
              if (event.key !== "Tab") return;
              const controls = Array.from(drawer.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])
                .filter((control) => control.getClientRects().length > 0);
              const first = controls[0], last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }}>
            <div className="panel-head">
              <div>
                <p className="eyebrow">{creating ? "Create" : "Edit"} {type}</p>
                <h2>{creating ? `New ${type.toLowerCase()}` : objectLabel(type, editing)}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close editor"
                onClick={close}
              >
                ×
              </button>
            </div>
            {creating && <p>Choose creation-time facts before adding this record. Once set, these facts cannot be overwritten. Closing or cancelling discards this new record.</p>}
            {(type === "Investment" || type === "Account") && <p role="note">{RETIREMENT_LIMITATION}</p>}
            {type === "Investment" && !creating && <ProjectedReturn investment={editing} draft={draft} setDraft={setDraft} selectedScenarioId={selectedScenarioId} />}
            <form onSubmit={(event) => { event.preventDefault(); if (creating) create(); }}>
            <div className="form-grid">
              {commonFields.map((fieldName) => (
                <FieldControl
                  key={fieldName}
                  fieldName={fieldName}
                  field={(descriptor.fields as Record<string, any>)[fieldName]}
                  value={editing[fieldName]}
                  draft={draft}
                  currency={editing.currency ?? currency}
                  entityType={type}
                  creating={creating}
                  onChange={(value) => saveField(fieldName, value)}
                />
              ))}
            </div>
            <details>
              <summary>Additional financial details</summary>
              <p className="muted">Optional dates, classifications, and relationships.</p>
              <div className="form-grid">
                {secondaryFields.length ? (
                  secondaryFields.map((fieldName) => (
                    <FieldControl
                      key={fieldName}
                      fieldName={fieldName}
                      field={
                        (descriptor.fields as Record<string, any>)[fieldName]
                      }
                      value={editing[fieldName]}
                      draft={draft}
                      currency={editing.currency ?? currency}
                      entityType={type}
                      creating={creating}
                      onChange={(value) => saveField(fieldName, value)}
                    />
                  ))
                ) : (
                  <p className="muted">No secondary fields for this item.</p>
                )}
              </div>
            </details>
            <details>
              <summary>Expert model details</summary>
              <p className="muted">Stored classifications and model settings. Supported execution depends on the forecast configuration.</p>
              <div className="form-grid">
                {expertFields.map((fieldName) => <FieldControl key={fieldName}
                  fieldName={fieldName} field={fields[fieldName]} value={editing[fieldName]} draft={draft}
                  entityType={type} creating={creating}
                  currency={editing.currency ?? currency} onChange={(value) => saveField(fieldName, value)} />)}
              </div>
              {managedFields.length > 0 && <section aria-label="Managed model references">
                <h3>Managed model references</h3>
                <p>Calculation, rule, event links, and structured model data are preserved. This editor does not author them.</p>
                <dl className="advanced-list">
                  {managedFields.map((name) => <div key={name}>
                    <dt>{FIELD_LABELS[name] ?? name.replaceAll("_", " ")}</dt>
                    <dd>{editing[name] ? (fields[name]?.ref === "Event" ? referenceLabel(draft, "Event", editing[name]) + " · read-only here" : "Configured · read-only here") : "Not configured · managed outside this editor"}</dd>
                  </div>)}
                </dl>
              </section>}
              {expertFields.length === 0 && managedFields.length === 0 && <p>No expert settings for this item.</p>}
            </details>
            {creating && <div className="row">
              <button type="submit" className="primary">Create {type}</button>
              <button type="button" className="secondary" onClick={close}>Cancel</button>
            </div>}
            {creationError && <p className="field-error" role="alert">{creationError}</p>}
            </form>
            <details>
              <summary>Technical details</summary>
              <p className="muted">Record IDs for troubleshooting relationships. These do not change financial behavior.</p>
              <dl className="advanced-list">
                <dt>{type} ID</dt>
                <dd>{objectId(type, editing)}</dd>
                {Object.entries(descriptor.fields)
                  .filter(([, field]) => field.ref || field.type === "object")
                  .map(([name, field]) => (
                    <span key={name}>
                      <dt>{name}</dt>
                      <dd>
                        {field.type === "object" ? JSON.stringify(editing[name] ?? null, null, 2) : String(editing[name] ?? "Not set")}{" "}
                        <small>→ {field.ref}</small>
                      </dd>
                    </span>
                  ))}
              </dl>
            </details>
          </aside>
        </div>
      )}
    </section>
  );
}
function FieldControl({ fieldName, field, value, draft, currency, entityType, creating, onChange }: {
  fieldName: string; field: EditorField | undefined; value: unknown; draft: PersonalDraft; currency: unknown;
  entityType: PersonalObjectType; creating: boolean;
  onChange: (value: string | boolean | readonly string[] | null) => void;
}) {
  if (!field || field.derived || internalReference(field)) return null;
  const label = FIELD_LABELS[fieldName] ?? fieldName.replaceAll("_", " ");
  const unsupportedReturn = entityType === "Investment" && ["expected_return", "volatility"].includes(fieldName);
  if (unsupportedReturn || (!creating && !field.mutable && value !== undefined)) return <div className="financial-fact" role="group" aria-label={label}>
    <strong>{label}</strong>
    <p>{value === undefined || value === null || value === "" ? "Not set" :
      field.type === "money" ? formatExactMoney(value, currency) :
      field.type === "rate" ? formatRate(value) :
      field.ref ? referenceLabel(draft, field.ref, value) : String(value).replaceAll("_", " ")}</p>
    <small>{unsupportedReturn ? FIELD_HELP[fieldName] : "Read-only · set at creation. This fact cannot be overwritten on this record."}</small>
    {unsupportedReturn && value !== undefined && value !== null && <>
      <p>This stored value prevents deterministic forecasting. It is preserved until you explicitly clear it. Supported return changes use the linked assumption or What-If workflow.</p>
      <button type="button" className="secondary" onClick={() => onChange(null)}>Clear stored {label}</button>
    </>}
  </div>;
  const required = creating && field.required;
  if (field.type === "boolean") return <label className="check">
    <input aria-label={label} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}{FIELD_HELP[fieldName] && <small>{FIELD_HELP[fieldName]}</small>}</span>
  </label>;
  if (field.enumValues) return <label>{label}
    <select aria-label={label} required={required} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
      <option value="">{field.required ? "Select an option" : "Not set"}</option>
      {field.enumValues.filter((option) => !(creating && entityType === "Asset" && fieldName === "asset_type" && ["cash", "investment"].includes(option)))
        .map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
    </select>
    {FIELD_HELP[fieldName] && <small>{FIELD_HELP[fieldName]}</small>}
  </label>;
  if (field.ref) {
    const expenseFunding = entityType === "Expense" && fieldName === "payment_account_id";
    const targets = referenceTargets(field.ref);
    const options = targets.flatMap((target) => objectEntries(draft, target).filter((item) => !expenseFunding || isCashFlowPaymentAccount(item)).map((item) => ({
      id: objectId(target, item), label: objectLabel(target, item),
      context: entitySummary(target, item, draft, typeof currency === "string" ? currency : undefined),
    })));
    const hasReference = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (options.length === 0) return <div className="reference-state" role="note">
      <strong>{label}</strong>
      <p>{hasReference ? referenceLabel(draft, field.ref, value) + ". " : ""}{expenseFunding ? "No checking, savings, or cash funding accounts available. Add one under Money → Accounts; retirement and brokerage accounts cannot fund spending." : `No ${targets.map((type) => TITLES[type].toLowerCase()).join(" or ")} available. Add a record in its editor to choose this relationship.`}</p>
      {hasReference && <small>The stored reference is preserved; inspect Technical details for its ID.</small>}
    </div>;
    const selected = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
    const missing = selected.filter((id) => !options.some((option) => option.id === id));
    if (field.type === "uuid[]") return <label>{label}
      <select aria-label={label} multiple value={selected} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>
        {missing.map((id) => <option key={id} value={id}>Unavailable reference</option>)}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.context}</option>)}
      </select>
      <small>Select one or more relationships. {missing.length > 0 && "An existing relationship is unavailable; its ID is in Technical details."}</small>
    </label>;
    return <label>{label}
      {expenseFunding && missing.length > 0 && <span role="note" className="reference-state">
        Stored funding: {referenceLabel(draft, field.ref, value)}. This relationship is incompatible or unavailable and is preserved until you choose a checking, savings, or cash account. Do not model retirement contributions as Spending.
      </span>}
      <select aria-label={label} required={required} value={expenseFunding && missing.length > 0 ? "" : String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
        <option value="">{field.required ? "Select a relationship" : "Not set"}</option>
        {!expenseFunding && missing.map((id) => <option key={id} value={id}>Unavailable reference</option>)}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.context}</option>)}
      </select>
      <small>{referenceLabel(draft, field.ref, value)}{missing.length > 0 && " · inspect Technical details for the stored ID"}</small>
    </label>;
  }
  return <label>{label}
    <input aria-label={label} required={required} type={field.type === "date" ? "date" : "text"} value={String(value ?? "")}
      inputMode={["money", "rate", "decimal"].includes(field.type) ? "decimal" : undefined}
      placeholder={field.required ? "Required" : "Optional"} onChange={(event) => onChange(event.target.value)} />
    {FIELD_HELP[fieldName] && <small>{FIELD_HELP[fieldName]}</small>}
    {field.type === "money" && <small>Currency: {String(currency ?? "not specified")}. {value ? formatExactMoney(value, currency) : "Enter a decimal amount."}</small>}
    {field.type === "rate" && <small>Decimal rate{value ? ` · ${formatRate(value)}` : " · 0.05 means 5%"}. No rate basis is inferred.</small>}
    {field.type === "decimal" && <small>Decimal value; retain the supplied units and precision.</small>}
    {!creating && !field.mutable && value === undefined && <small>Missing creation-time fact: supply once. It cannot be overwritten afterward.</small>}
  </label>;
}
