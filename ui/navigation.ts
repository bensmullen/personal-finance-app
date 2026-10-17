/** Display destinations reuse established financial owners; no model migration. */
export type OwnerArea = "Overview" | "Money" | "Net Worth" | "Plan" | "Settings";
export const FINANCIAL_DESTINATIONS = [
  { label: "Overview", owner: "Overview", section: "How am I doing?" },
  { label: "Cash", owner: "Money", section: "Cash Flow" },
  { label: "Investing", owner: "Net Worth", section: "Investments & retirement" },
  { label: "Real Estate", owner: "Net Worth", section: "Real Estate" },
  { label: "Other Assets", owner: "Net Worth", section: "Other Assets" },
  { label: "Debt", owner: "Net Worth", section: "Debt" },
  { label: "Planning", owner: "Plan", section: "Current Plan" },
] as const satisfies readonly { label: string; owner: OwnerArea; section: string }[];
export function financialDestination(owner: OwnerArea, section: string): string {
  if (owner === "Money") return "Cash";
  if (owner === "Plan") return "Planning";
  if (owner === "Net Worth") return section === "Debt" || section === "Real Estate" || section === "Other Assets" ? section
    : section === "Cash & bank accounts" ? "Cash" : section === "Property & other assets" ? "Other Assets" : "Investing";
  return owner;
}
