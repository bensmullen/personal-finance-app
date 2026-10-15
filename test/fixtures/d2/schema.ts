import { z } from "zod";

// Preparation vocabulary only. This is neither a canonical model nor a public
// execution interface. Money is signed integer USD cents, never JS numbers.
export const centsSchema = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
const dateSchema = z.iso.date();
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const accountSchema = z.object({
  id: idSchema,
  kind: z.enum(["cash", "position", "tax_credit", "liability", "income", "expense", "equity"]),
  owner: idSchema,
  openingCents: centsSchema,
}).strict();
const transactionSchema = z.object({
  id: idSchema,
  date: dateSchema,
  legs: z.array(z.object({
    account: idSchema,
    side: z.enum(["debit", "credit"]),
    cents: z.string().regex(/^[1-9][0-9]*$/),
  }).strict()).min(2),
}).strict();
export const caseSchema = z.object({
  id: idSchema,
  lane: z.enum(["D2-A", "D2-B", "D2-C"]),
  family: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  variant: idSchema,
  requirements: z.array(z.string().regex(/^PFA-(DET|TAX|INV|INS)-[0-9]{3}$/)).min(1),
  authority: z.array(z.object({ path: z.string().min(1), anchor: z.string().min(1) }).strict()).min(1),
  period: z.object({ start: dateSchema, endExclusive: dateSchema }).strict(),
  input: z.object({
    currency: z.literal("USD"),
    unit: z.literal("integer_cents"),
    provenance: z.literal("synthetic"),
    identities: z.array(z.object({
      id: idSchema,
      kind: z.enum(["person", "employer", "plan", "account"]),
      owner: idSchema.optional(),
      plan: idSchema.optional(),
      family: idSchema.optional(),
      sponsor: idSchema.optional(),
      accountType: z.enum(["bank_cash", "wrapper_cash", "payroll", "income", "expense", "tax_credit", "403b", "governmental_457b", "tsp", "sep_ira", "simple_ira", "traditional_ira", "roth_ira", "after_tax_401k", "roth_401k", "retirement_account", "auto_loan", "student_loan", "credit_card", "heloc", "tips", "series_ee", "education_529"]).optional(),
    }).strict()).min(1),
    roles: z.object({
      owner: idSchema,
      source: idSchema,
      destination: idSchema,
      beneficiary: idSchema.optional(),
      previousBeneficiary: idSchema.optional(),
      plan: idSchema.optional(),
      destinationPlan: idSchema.optional(),
      employer: idSchema.optional(),
      coveredMembers: z.array(idSchema).min(1).optional(),
    }).strict(),
    amounts: z.record(z.string(), centsSchema),
    terms: z.record(z.string(), z.string().min(1)),
    accounts: z.array(accountSchema),
  }).strict(),
  expected: z.object({
    capability: z.enum(["decision_required", "not_yet_executable"]),
    integratedRuntimeEvidence: z.literal(false),
    boundary: z.string().min(1),
    unknownOutputs: z.array(z.string().min(1)).min(1),
    // Optional, explicitly bounded accounting projection of supplied facts.
    // Absence means unknown, not zero. These are not forecast transactions.
    effects: z.object({
      condition: z.string().min(1),
      transactions: z.array(transactionSchema),
      closingCents: z.record(z.string(), centsSchema),
      cashDeltaCents: centsSchema,
      netWorthDeltaCents: centsSchema,
      recognition: z.object({ incomeCents: centsSchema, expenseCents: centsSchema }).strict(),
      facts: z.record(z.string(), z.string().min(1)),
    }).strict().optional(),
  }).strict(),
}).strict();
export const catalogSchema = z.object({
  version: z.literal("d2-prep/v1"),
  scope: z.literal("synthetic_contract_effects_only"),
  cases: z.array(caseSchema).min(1),
}).strict();
export type D2Case = z.infer<typeof caseSchema>;
export type D2Catalog = z.infer<typeof catalogSchema>;
