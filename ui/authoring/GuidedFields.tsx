"use client";
import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { FieldShell, RepairSummary } from "./FieldShell.js";
import { FINANCIAL_FIELDS, fieldProblem } from "./fieldContract.js";
import { FieldHelp } from "../forecast/PercentageInput.js";

/** Migration adapter: existing D1 callbacks survive; presentation is centralized. */
export const FIELD_ALIASES: Readonly<Record<string, string>> = {
  "Cash-flow execution account": "cashAccount", "Payment anchor": "paymentAnchor", "Total payment count": "totalPayments", "Settlement priority": "settlementPriority",
  "Mortgage to replace": "operationMortgage", "Mortgage for extra principal": "operationMortgage", "Extra principal checking / savings account": "operationFunding", "Received proceeds account": "operationFunding", "Purchase / exercise funding account": "operationFunding", "Replacement funding account": "operationFunding", "Replacement monthly payments": "totalPayments",
  "Source and Roth destination are compartments of the same employer plan.": "samePlan",
  "Purchase execution order": "purchaseOrder", "Annual taxable compensation": "taxableCompensation", "Roth IRA MAGI": "rothMagi", "Traditional IRA deduction MAGI": "deductionMagi", "Excess contribution policy": "excess",
  "Payroll contribution character": "character", "Payroll contribution method": "method", "Payroll allocation priority": "payrollPriority", "Payroll contribution year": "taxYear", "Payroll age at year end": "age", "Last year’s pay from this employer": "priorYearSponsorWages",
  "Historical contribution year": "taxYear", "Your age at the end of that year": "age", "Historical HSA full-year eligibility": "hsaFullYearEligible", "Historical HSA coverage": "hsaCoverage", "Historical individual family HSA allocation": "hsaFamilyAllocation", "Historical annual taxable compensation": "taxableCompensation", "Historical Roth IRA MAGI": "rothMagi", "Historical filing status": "filingStatus", "Historical lived with spouse": "livesWithSpouse", "Historical employer / plan group": "planKey", "Historical annual pay eligible for this plan": "eligiblePlanCompensation", "Historical plan has Roth feature": "planHasRoth", "Historical last year’s pay from this employer": "priorYearSponsorWages",
  "I confirm all prior YTD usage in these shared scopes is known, including zero for omitted categories.": "ytdConfirmed",
  "I have established owned/vested eligibility and destination/plan acceptance for this supported path.": "operationAcceptance",
};
const labels = new Map(Object.values(FINANCIAL_FIELDS).map(field => [field.label, field.key]));
type NodeProps = { children?: ReactNode; value?: unknown; required?: boolean; readOnly?: boolean; disabled?: boolean; "aria-invalid"?: boolean; "aria-label"?: string; "data-repair"?: string; type?: string };
export function GuidedFields({ children, scope, aliases = {}, required = [], errors = {}, repairKeys = {} }: {
  children: ReactNode; scope: string; aliases?: Readonly<Record<string, string>>; required?: readonly string[]; errors?: Readonly<Record<string, string | undefined>>; repairKeys?: Readonly<Record<string, string | undefined>>;
}) {
  const identity = useId(), problems: { target: string; message: string }[] = [];
  const visit = (nodes: ReactNode, path = ""): ReactNode => Children.map(nodes, (node, index) => {
    if (!isValidElement<NodeProps>(node)) return node;
    const nextPath = `${path}-${index}`;
    // Technical payloads are deliberately outside normal financial authoring.
    if (node.type === "details" && Children.toArray(node.props.children).some(child => isValidElement<NodeProps>(child) && child.type === "summary" && String(child.props.children).startsWith("Technical"))) return node;
    if (node.type === FieldHelp) return null;
    if (node.type === "label") {
      const contents = Children.toArray(node.props.children);
      const control = contents.find(child => isValidElement(child) && (child.type === "input" || child.type === "select")) as ReactElement<NodeProps> | undefined;
      if (!control) return node;
      const label = contents.filter(child => typeof child === "string" || typeof child === "number").join("").trim() || control.props["aria-label"] || "";
      const key = aliases[label] ?? FIELD_ALIASES[label] ?? labels.get(label);
      if (!key) throw new Error(`Missing financial field metadata in ${scope}: ${label}`);
      const field = FINANCIAL_FIELDS[key]!;
      const needed = required.includes(key) || !!control.props.required;
      const problem = control.props.readOnly || control.props.disabled ? undefined : errors[key] ?? fieldProblem(field, control.props.value, needed) ?? (control.props["aria-invalid"] ? `Complete ${field.label.toLowerCase()} before forecasting.` : undefined);
      const target = repairKeys[key] ?? control.props["data-repair"] ?? `${scope}:${identity}:${key}:${nextPath}`;
      if (problem) problems.push({ target, message: `${field.label}: ${problem}` });
      const notices = contents.filter(child => isValidElement<{ role?: string }>(child) && child.props.role === "note");
      return <div key={node.key ?? nextPath}><FieldShell fieldKey={key} required={needed} error={problem} repairKey={target}>{control as Parameters<typeof FieldShell>[0]["children"]}</FieldShell>{notices}</div>;
    }
    return node.props.children === undefined ? node : cloneElement(node, {}, visit(node.props.children, nextPath));
  });
  const content = visit(children);
  return <div className="guided-fields" data-authoring-scope={scope}><RepairSummary errors={problems} />{content}</div>;
}
