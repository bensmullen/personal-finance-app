/** Derived from personal_finance_canonical_schema_v1.0.json. */
export type UUID = string;
export type Money = number;
export type Rate = number;
export type ISODate = string;
export type ISODateTime = string;
export type Currency = string;
export type Jurisdiction = string;
export type JsonObject = Record<string, unknown>;

export type PersonRelationshipStatus = "single" | "married" | "partnered" | "divorced" | "widowed" | "other";
export type EmploymentStatus = "employed" | "unemployed" | "retired" | "self_employed" | "student" | "other";
export type HouseholdType = "individual" | "couple" | "family" | "other";
export type AccountType = "checking" | "savings" | "cash" | "taxable_brokerage" | "traditional_401k" | "roth_401k" | "traditional_ira" | "roth_ira" | "hsa" | "hsa_investment" | "529" | "403b" | "457b" | "sep_ira" | "simple_ira" | "pension" | "cash_value_insurance" | "other";
export type LiquidityClass = "liquid" | "semi_liquid" | "illiquid" | "restricted";
export type TaxTreatment = "taxable" | "tax_deferred" | "tax_free" | "mixed" | "inherited";
export type AssetType = "cash" | "investment" | "real_estate" | "vehicle" | "business" | "personal_property" | "other";
export type ValuationMethod = "market" | "appraisal" | "cost" | "formula" | "custom";
export type LiabilityType = "mortgage" | "auto" | "student" | "credit_card" | "personal" | "heloc" | "business" | "tax" | "other";
export type RateType = "fixed" | "variable" | "indexed";
export type PaymentFrequency = "daily" | "weekly" | "biweekly" | "semimonthly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual" | "irregular";
export type IncomeType = "salary" | "bonus" | "commission" | "overtime" | "equity_compensation" | "business" | "rental" | "interest" | "dividend" | "capital_gain" | "pension" | "social_security" | "government_benefit" | "unemployment" | "severance" | "gift" | "inheritance" | "other";
export type IncomeTaxCharacter = "ordinary" | "qualified_dividend" | "short_term_capital_gain" | "long_term_capital_gain" | "tax_free" | "deferred" | "other";
export type ExpenseEssentiality = "essential" | "discretionary";
export type TransactionType = "income" | "expense" | "transfer" | "investment_purchase" | "investment_sale" | "debt_draw" | "debt_payment" | "tax" | "insurance_premium" | "insurance_claim" | "asset_purchase" | "asset_sale" | "gift" | "inheritance" | "conversion" | "distribution" | "contribution" | "other";
export type CashFlowClass = "operating" | "investing" | "financing" | "non_cash";
export type EventType = "marriage" | "divorce" | "childbirth" | "adoption" | "death" | "job_change" | "promotion" | "layoff" | "unemployment_start" | "unemployment_end" | "retirement" | "relocation" | "home_purchase" | "home_sale" | "vehicle_purchase" | "vehicle_sale" | "education_start" | "education_end" | "medical_event" | "inheritance" | "gift" | "business_creation" | "business_sale" | "insurance_claim" | "refinance" | "debt_issuance" | "debt_payoff" | "account_open" | "account_close" | "other";
export type TriggerType = "scheduled" | "stochastic" | "conditional" | "dependency" | "external";
export type AssumptionCategory = "inflation" | "market_return" | "salary_growth" | "longevity" | "healthcare" | "tax" | "housing" | "employment" | "demographic" | "interest_rate" | "expense_growth" | "education" | "insurance" | "other";
export type InvestmentType = "equity" | "bond" | "fund" | "cash" | "real_estate" | "option" | "commodity" | "crypto" | "other";
export type InsuranceType = "health" | "dental" | "vision" | "homeowners" | "auto" | "life" | "disability" | "long_term_care" | "umbrella" | "other";
export type TaxType = "federal_income" | "state_income" | "local_income" | "payroll" | "capital_gain" | "property" | "sales" | "niit" | "conversion" | "rmd" | "credit" | "deduction" | "other";
export type FilingStatus = "single" | "married_joint" | "married_separate" | "head_of_household" | "qualifying_widow_er";
export type CalculationMethod = "progressive" | "flat" | "proportional" | "custom";
export type SourceType = "user" | "historical" | "external" | "model";
export type DistributionType = "normal" | "lognormal" | "uniform" | "triangular" | "discrete" | "empirical" | "mixture" | "custom";
export type Timestep = "daily" | "monthly" | "quarterly" | "annual";
export type PrimitiveClass = "temporal" | "functional" | "dependency" | "financial_mechanics" | "event_uncertainty";
export type Aggregation = "sum" | "mean" | "median" | "min" | "max" | "ending" | "beginning" | "rate_of_change" | "ratio";
export type StatementType = "income_statement" | "balance_sheet" | "cash_flow_statement";
export type StatementSection = "operating" | "investing" | "financing" | "assets" | "liabilities" | "equity" | "income" | "expense";
export type AccountingEffectType = "asset" | "liability" | "income" | "expense" | "equity" | "gain" | "loss" | "tax" | "cash";
export type PostingSign = "debit" | "credit";
export type ComparisonOperator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "contains" | "starts_with" | "between";
export type LogicalOperator = "and" | "or" | "not";
export type DependencyNodeType = "input" | "state" | "flow" | "event" | "rule" | "derived" | "simulation_output";
export type DependencyEdgeType = "reads" | "writes" | "modifies" | "triggers" | "constrains" | "aggregates";

export interface Person {
  person_id: UUID;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  date_of_death?: string;
  household_id?: UUID;
  relationship_status?: PersonRelationshipStatus;
  employment_status: EmploymentStatus;
  residence_jurisdiction: string;
  /** derived; recompute rather than treat as authoritative. */
  filing_status?: FilingStatus;
  life_expectancy?: number;
  risk_profile?: string;
}

export interface Household {
  household_id: UUID;
  name: string;
  household_type: HouseholdType;
  formation_date: string;
  dissolution_date?: string;
  members: UUID[];
  primary_jurisdiction: string;
  /** derived; recompute rather than treat as authoritative. */
  filing_status?: FilingStatus;
  /** derived; recompute rather than treat as authoritative. */
  household_income?: number;
  /** derived; recompute rather than treat as authoritative. */
  household_expenses?: number;
  /** derived; recompute rather than treat as authoritative. */
  household_net_worth?: number;
}

export interface Account {
  account_id: UUID;
  name: string;
  account_type: AccountType;
  owner_id: UUID;
  institution?: string;
  currency: string;
  opening_date: string;
  closing_date?: string;
  opening_balance: number;
  /** derived; recompute rather than treat as authoritative. */
  current_balance: number;
  liquidity_class: LiquidityClass;
  tax_treatment: TaxTreatment;
  contribution_limit_rule_id?: UUID;
  withdrawal_rule_ids?: UUID[];
  fee_rule_id?: UUID;
  return_model_id?: UUID;
  transaction_ids?: UUID[];
}

export interface Asset {
  asset_id: UUID;
  name: string;
  asset_type: AssetType;
  owner_id: UUID;
  account_id?: UUID;
  acquisition_date?: string;
  acquisition_cost?: number;
  /** derived; recompute rather than treat as authoritative. */
  current_value: number;
  valuation_method: ValuationMethod;
  appreciation_model_id?: UUID;
  depreciation_model_id?: UUID;
  sale_date?: string;
  sale_cost?: number;
  /** derived; recompute rather than treat as authoritative. */
  tax_basis?: number;
  liquidity_class: LiquidityClass;
}

export interface Liability {
  liability_id: UUID;
  name: string;
  liability_type: LiabilityType;
  owner_id: UUID;
  principal: number;
  current_balance: number;
  interest_rate: number;
  rate_type: RateType;
  payment_frequency: PaymentFrequency;
  /** derived; recompute rather than treat as authoritative. */
  scheduled_payment?: number;
  /** derived; recompute rather than treat as authoritative. */
  minimum_payment?: number;
  extra_payment?: number;
  origination_date: string;
  maturity_date?: string;
  amortization_model_id?: UUID;
  fee_rule_id?: UUID;
  prepayment_rule_id?: UUID;
  collateral_id?: UUID;
  tax_treatment?: TaxTreatment;
}

export interface Income {
  income_id: UUID;
  owner_id: UUID;
  income_type: IncomeType;
  source?: string;
  amount: number;
  frequency: PaymentFrequency;
  start_date: string;
  end_date?: string;
  growth_model_id?: UUID;
  probability_model_id?: UUID;
  tax_character: IncomeTaxCharacter;
  gross_or_net: string;
  related_event_id?: UUID;
}

export interface Expense {
  expense_id: UUID;
  owner_id: UUID;
  category: string;
  amount: number;
  frequency: PaymentFrequency;
  start_date: string;
  end_date?: string;
  growth_model_id?: UUID;
  essentiality?: ExpenseEssentiality;
  tax_deductibility_rule_id?: UUID;
  payment_account_id?: UUID;
  event_trigger_id?: UUID;
}

export interface Transaction {
  transaction_id: UUID;
  transaction_date: string;
  transaction_type: TransactionType;
  amount: number;
  currency: string;
  source_account_id?: UUID;
  destination_account_id?: UUID;
  cash_flow_class: CashFlowClass;
  event_id?: UUID;
  scenario_id: UUID;
  /** derived; recompute rather than treat as authoritative. */
  tax_effect?: number;
  description?: string;
  legs: AccountingLeg[];
}

export interface Event {
  event_id: UUID;
  name: string;
  event_type: EventType;
  description?: string;
  start_date: string;
  end_date?: string;
  /** derived; recompute rather than treat as authoritative. */
  duration_days?: number;
  trigger_type: TriggerType;
  trigger_condition?: string;
  probability_model_id?: UUID;
  effect_ids: UUID[];
  dependencies?: EventDependency[];
  precedence?: number;
  scenario_id: UUID;
  enabled: boolean;
}

export interface Scenario {
  scenario_id: UUID;
  name: string;
  description?: string;
  base_scenario_id?: UUID;
  start_date: string;
  end_date: string;
  timestep: Timestep;
  assumption_ids?: UUID[];
  event_ids?: UUID[];
  enabled: boolean;
  stochastic: boolean;
  simulation_count?: number;
}

export interface Assumption {
  assumption_id: UUID;
  name: string;
  category: AssumptionCategory;
  value: number;
  unit: string;
  start_date?: string;
  end_date?: string;
  distribution_type?: DistributionType;
  distribution_parameters?: JsonObject;
  correlation_group?: string;
  source: SourceType;
  confidence?: number;
  scenario_id: UUID;
}

export interface Investment {
  investment_id: UUID;
  account_id: UUID;
  asset_id?: UUID;
  investment_type: InvestmentType;
  symbol?: string;
  quantity: number;
  /** derived; recompute rather than treat as authoritative. */
  price: number;
  /** derived; recompute rather than treat as authoritative. */
  market_value: number;
  expected_return?: number;
  volatility?: number;
  contribution_model_id?: UUID;
  return_model_id?: UUID;
  tax_treatment: TaxTreatment;
  rebalancing_rule_id?: UUID;
}

export interface Insurance {
  insurance_id: UUID;
  owner_id: UUID;
  insurance_type: InsuranceType;
  provider?: string;
  policy_number?: string;
  premium: number;
  premium_frequency: PaymentFrequency;
  coverage_amount?: number;
  deductible?: number;
  copay?: number;
  coinsurance?: number;
  out_of_pocket_max?: number;
  start_date: string;
  end_date?: string;
  claim_probability_model_id?: UUID;
  claim_effect_ids?: UUID[];
}

export interface TaxRule {
  tax_rule_id: UUID;
  jurisdiction: string;
  tax_type: TaxType;
  filing_status?: FilingStatus;
  effective_date: string;
  expiration_date?: string;
  brackets?: TaxBracket[];
  rates?: number[];
  deduction_rules?: GenericRule[];
  credit_rules?: GenericRule[];
  contribution_limits?: GenericRule[];
  withdrawal_rules?: GenericRule[];
  taxability_rules?: GenericRule[];
  calculation_method: CalculationMethod;
}

export interface PrimitiveInstance {
  primitive_instance_id: UUID;
  primitive_id: PrimitiveId;
  input_bindings: JsonObject;
  parameters?: JsonObject;
  start_date?: string;
  end_date?: string;
  scenario_id: UUID;
  enabled: boolean;
}

export interface DependencyNode {
  node_id: UUID;
  node_key: string;
  node_type: DependencyNodeType;
  entity_type: string;
  entity_id: UUID;
  field_path?: string;
  timestep_scope?: string;
  scenario_id: UUID;
}

export interface DependencyEdge {
  edge_id: UUID;
  from_node_id: UUID;
  to_node_id: UUID;
  edge_type: DependencyEdgeType;
  expression?: string;
  lag?: number;
  priority?: number;
  scenario_id: UUID;
}

export interface EventEffect {
  event_effect_id: UUID;
  target_entity_type: string;
  target_entity_id: UUID;
  target_field_path?: string;
  operation: string;
  value?: string;
  primitive_instance_id?: UUID;
}

export interface AccountingLeg {
  accounting_leg_id: UUID;
  transaction_id: UUID;
  posting_type: PostingSign;
  effect_type: AccountingEffectType;
  entity_type: string;
  entity_id?: UUID;
  amount: number;
  currency: string;
  statement_section?: StatementSection;
  cash_flow_class?: CashFlowClass;
  memo?: string;
}

export type PrimitiveId = "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07" | "P08" | "P09" | "P10" | "P11" | "P12" | "P13" | "P14" | "P15" | "P16" | "P17" | "P18" | "P19" | "P20" | "P21" | "P22" | "P23" | "P24" | "P25" | "P26" | "P27" | "P28" | "P29" | "P30" | "P31" | "P32" | "P33" | "P34";
export interface PrimitiveDefinition { primitive_id: PrimitiveId; description: string; input_signature: JsonObject; parameter_signature: JsonObject; stateful: boolean; deterministic: boolean; stochastic: boolean; evaluate(ctx: PrimitiveEvaluationContext): PrimitiveEvaluationResult; }
export interface PrimitiveEvaluationContext { timestepIndex: number; timestamp: ISODate; inputs: Record<string, number>; state: JsonObject; parameters: JsonObject; scenario: Scenario; random: RandomSource; }
export interface PrimitiveEvaluationResult { value: number | JsonObject; nextState?: JsonObject; diagnostics?: ValidationIssue[]; }
export interface DependencyGraph { nodes: DependencyNode[]; edges: DependencyEdge[]; validate(): ValidationIssue[]; topologicalOrder(timestepIndex: number): UUID[]; }
export interface FinancialState { timestamp: ISODate; accounts: Record<UUID, JsonObject>; assets: Record<UUID, JsonObject>; liabilities: Record<UUID, JsonObject>; investments: Record<UUID, JsonObject>; active_events: UUID[]; active_policies: UUID[]; tax_state: JsonObject; insurance_state: JsonObject; }
export interface AccountingTransaction { transaction: Transaction; legs: AccountingLeg[]; }
export interface AccountingEngine { validate(tx: AccountingTransaction): ValidationIssue[]; post(tx: AccountingTransaction, state: FinancialState): FinancialState; }
export interface RandomSource { seed: string; next(processName: string): number; sample(processName: string, distribution: DistributionType, parameters: JsonObject): number; }
export interface ValidationIssue { severity: "error" | "warning" | "info"; code: string; message: string; entity_type?: string; entity_id?: UUID; field_path?: string; node_id?: UUID; }
export interface SimulationMetadata { run_id: UUID; engine_version: string; specification_version: string; seed?: string; scenario_id: UUID; started_at: ISODateTime; completed_at?: ISODateTime; }
export interface SimulationResult { metadata: SimulationMetadata; time_series_state: FinancialState[]; transactions: AccountingTransaction[]; financial_statements: JsonObject; derived_metrics: JsonObject; validation_results: ValidationIssue[]; }
export interface SimulationInput { scenario: Scenario; people: Person[]; households: Household[]; accounts: Account[]; assets: Asset[]; liabilities: Liability[]; incomes: Income[]; expenses: Expense[]; events: Event[]; assumptions: Assumption[]; investments: Investment[]; insurance: Insurance[]; taxRules: TaxRule[]; primitives: PrimitiveInstance[]; dependencyNodes: DependencyNode[]; dependencyEdges: DependencyEdge[]; initialState: FinancialState; }
export interface SimulationStepContext { state: FinancialState; inputs: SimulationInput; timestamp: ISODate; timestepIndex: number; random: RandomSource; }
export interface SimulationStepResult { state: FinancialState; transactions: AccountingTransaction[]; issues: ValidationIssue[]; }
export interface SimulationEngine { validateModel(input: SimulationInput): ValidationIssue[]; run(input: SimulationInput): SimulationResult; step(ctx: SimulationStepContext): SimulationStepResult; }
export interface EventEngine { activate(ctx: SimulationStepContext): Event[]; applyEffects(events: Event[], state: FinancialState): FinancialState; }
export interface DependencyResolver { resolve(ctx: { graph: DependencyGraph; state: FinancialState; scenario: Scenario; timestepIndex: number }): Record<UUID, number | JsonObject>; }
export interface TaxEngine { calculate(ctx: TaxEvaluationContext): TaxCalculationResult; }
export interface TaxEvaluationContext { taxableState: JsonObject; taxRules: TaxRule[]; timestamp: ISODate; }
export interface TaxCalculationResult { tax: Money; components: JsonObject; issues: ValidationIssue[]; }
export interface FinancialStatementEngine { build(state: FinancialState, transactions: AccountingTransaction[]): JsonObject; }
export interface InvariantValidator { validate(ctx: InvariantValidationContext): ValidationIssue[]; }
export interface InvariantValidationContext { before: FinancialState; after: FinancialState; transactions: AccountingTransaction[]; graph?: DependencyGraph; timestamp: ISODate; }
export interface TaxBracket { lower_bound: Money; upper_bound?: Money | null; rate: Rate; }
export type GenericRule = JsonObject;
export interface EventDependency { node_id: UUID; edge_type?: DependencyEdgeType; lag?: number; }
