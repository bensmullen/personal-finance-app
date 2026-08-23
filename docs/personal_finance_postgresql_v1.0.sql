-- Derived from personal_finance_canonical_schema_v1.0.json
-- PostgreSQL 16+
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE pf_person_relationship_status AS ENUM ('single', 'married', 'partnered', 'divorced', 'widowed', 'other');
CREATE TYPE pf_employment_status AS ENUM ('employed', 'unemployed', 'retired', 'self_employed', 'student', 'other');
CREATE TYPE pf_household_type AS ENUM ('individual', 'couple', 'family', 'other');
CREATE TYPE pf_account_type AS ENUM ('checking', 'savings', 'cash', 'taxable_brokerage', 'traditional_401k', 'roth_401k', 'traditional_ira', 'roth_ira', 'hsa', 'hsa_investment', '529', '403b', '457b', 'sep_ira', 'simple_ira', 'pension', 'cash_value_insurance', 'other');
CREATE TYPE pf_liquidity_class AS ENUM ('liquid', 'semi_liquid', 'illiquid', 'restricted');
CREATE TYPE pf_tax_treatment AS ENUM ('taxable', 'tax_deferred', 'tax_free', 'mixed', 'inherited');
CREATE TYPE pf_asset_type AS ENUM ('cash', 'investment', 'real_estate', 'vehicle', 'business', 'personal_property', 'other');
CREATE TYPE pf_valuation_method AS ENUM ('market', 'appraisal', 'cost', 'formula', 'custom');
CREATE TYPE pf_liability_type AS ENUM ('mortgage', 'auto', 'student', 'credit_card', 'personal', 'heloc', 'business', 'tax', 'other');
CREATE TYPE pf_rate_type AS ENUM ('fixed', 'variable', 'indexed');
CREATE TYPE pf_payment_frequency AS ENUM ('daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'irregular');
CREATE TYPE pf_income_type AS ENUM ('salary', 'bonus', 'commission', 'overtime', 'equity_compensation', 'business', 'rental', 'interest', 'dividend', 'capital_gain', 'pension', 'social_security', 'government_benefit', 'unemployment', 'severance', 'gift', 'inheritance', 'other');
CREATE TYPE pf_income_tax_character AS ENUM ('ordinary', 'qualified_dividend', 'short_term_capital_gain', 'long_term_capital_gain', 'tax_free', 'deferred', 'other');
CREATE TYPE pf_expense_essentiality AS ENUM ('essential', 'discretionary');
CREATE TYPE pf_transaction_type AS ENUM ('income', 'expense', 'transfer', 'investment_purchase', 'investment_sale', 'debt_draw', 'debt_payment', 'tax', 'insurance_premium', 'insurance_claim', 'asset_purchase', 'asset_sale', 'gift', 'inheritance', 'conversion', 'distribution', 'contribution', 'other');
CREATE TYPE pf_cash_flow_class AS ENUM ('operating', 'investing', 'financing', 'non_cash');
CREATE TYPE pf_event_type AS ENUM ('marriage', 'divorce', 'childbirth', 'adoption', 'death', 'job_change', 'promotion', 'layoff', 'unemployment_start', 'unemployment_end', 'retirement', 'relocation', 'home_purchase', 'home_sale', 'vehicle_purchase', 'vehicle_sale', 'education_start', 'education_end', 'medical_event', 'inheritance', 'gift', 'business_creation', 'business_sale', 'insurance_claim', 'refinance', 'debt_issuance', 'debt_payoff', 'account_open', 'account_close', 'other');
CREATE TYPE pf_trigger_type AS ENUM ('scheduled', 'stochastic', 'conditional', 'dependency', 'external');
CREATE TYPE pf_assumption_category AS ENUM ('inflation', 'market_return', 'salary_growth', 'longevity', 'healthcare', 'tax', 'housing', 'employment', 'demographic', 'interest_rate', 'expense_growth', 'education', 'insurance', 'other');
CREATE TYPE pf_investment_type AS ENUM ('equity', 'bond', 'fund', 'cash', 'real_estate', 'option', 'commodity', 'crypto', 'other');
CREATE TYPE pf_insurance_type AS ENUM ('health', 'dental', 'vision', 'homeowners', 'auto', 'life', 'disability', 'long_term_care', 'umbrella', 'other');
CREATE TYPE pf_tax_type AS ENUM ('federal_income', 'state_income', 'local_income', 'payroll', 'capital_gain', 'property', 'sales', 'niit', 'conversion', 'rmd', 'credit', 'deduction', 'other');
CREATE TYPE pf_filing_status AS ENUM ('single', 'married_joint', 'married_separate', 'head_of_household', 'qualifying_widow_er');
CREATE TYPE pf_calculation_method AS ENUM ('progressive', 'flat', 'proportional', 'custom');
CREATE TYPE pf_source_type AS ENUM ('user', 'historical', 'external', 'model');
CREATE TYPE pf_distribution_type AS ENUM ('normal', 'lognormal', 'uniform', 'triangular', 'discrete', 'empirical', 'mixture', 'custom');
CREATE TYPE pf_timestep AS ENUM ('daily', 'monthly', 'quarterly', 'annual');
CREATE TYPE pf_primitive_class AS ENUM ('temporal', 'functional', 'dependency', 'financial_mechanics', 'event_uncertainty');
CREATE TYPE pf_aggregation AS ENUM ('sum', 'mean', 'median', 'min', 'max', 'ending', 'beginning', 'rate_of_change', 'ratio');
CREATE TYPE pf_statement_type AS ENUM ('income_statement', 'balance_sheet', 'cash_flow_statement');
CREATE TYPE pf_statement_section AS ENUM ('operating', 'investing', 'financing', 'assets', 'liabilities', 'equity', 'income', 'expense');
CREATE TYPE pf_accounting_effect_type AS ENUM ('asset', 'liability', 'income', 'expense', 'equity', 'gain', 'loss', 'tax', 'cash');
CREATE TYPE pf_posting_sign AS ENUM ('debit', 'credit');
CREATE TYPE pf_comparison_operator AS ENUM ('eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in', 'contains', 'starts_with', 'between');
CREATE TYPE pf_logical_operator AS ENUM ('and', 'or', 'not');
CREATE TYPE pf_dependency_node_type AS ENUM ('input', 'state', 'flow', 'event', 'rule', 'derived', 'simulation_output');
CREATE TYPE pf_dependency_edge_type AS ENUM ('reads', 'writes', 'modifies', 'triggers', 'constrains', 'aggregates');

CREATE TABLE person (
    person_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date NOT NULL,
    date_of_death date,
    household_id uuid,
    relationship_status pf_person_relationship_status,
    employment_status pf_employment_status NOT NULL,
    residence_jurisdiction text NOT NULL,
    life_expectancy numeric(19,6),
    risk_profile text,
    CONSTRAINT pk_person PRIMARY KEY (person_id)
);

CREATE TABLE household (
    household_id uuid NOT NULL,
    name text NOT NULL,
    household_type pf_household_type NOT NULL,
    formation_date date NOT NULL,
    dissolution_date date,
    primary_jurisdiction text NOT NULL,
    CONSTRAINT pk_household PRIMARY KEY (household_id)
);

CREATE TABLE account (
    account_id uuid NOT NULL,
    name text NOT NULL,
    account_type pf_account_type NOT NULL,
    owner_id uuid NOT NULL,
    institution text,
    currency char(3) NOT NULL,
    opening_date date NOT NULL,
    closing_date date,
    opening_balance numeric(19,4) NOT NULL,
    liquidity_class pf_liquidity_class NOT NULL,
    tax_treatment pf_tax_treatment NOT NULL,
    contribution_limit_rule_id uuid,
    withdrawal_rule_ids jsonb,
    fee_rule_id uuid,
    return_model_id uuid,
    transaction_ids jsonb,
    CONSTRAINT pk_account PRIMARY KEY (account_id)
);

CREATE TABLE asset (
    asset_id uuid NOT NULL,
    name text NOT NULL,
    asset_type pf_asset_type NOT NULL,
    owner_id uuid NOT NULL,
    account_id uuid,
    acquisition_date date,
    acquisition_cost numeric(19,4),
    valuation_method pf_valuation_method NOT NULL,
    appreciation_model_id uuid,
    depreciation_model_id uuid,
    sale_date date,
    sale_cost numeric(19,4),
    liquidity_class pf_liquidity_class NOT NULL,
    CONSTRAINT pk_asset PRIMARY KEY (asset_id)
);

CREATE TABLE liability (
    liability_id uuid NOT NULL,
    name text NOT NULL,
    liability_type pf_liability_type NOT NULL,
    owner_id uuid NOT NULL,
    principal numeric(19,4) NOT NULL,
    current_balance numeric(19,4) NOT NULL,
    interest_rate numeric(19,10) NOT NULL,
    rate_type pf_rate_type NOT NULL,
    payment_frequency pf_payment_frequency NOT NULL,
    extra_payment numeric(19,4),
    origination_date date NOT NULL,
    maturity_date date,
    amortization_model_id uuid,
    fee_rule_id uuid,
    prepayment_rule_id uuid,
    collateral_id uuid,
    tax_treatment pf_tax_treatment,
    CONSTRAINT pk_liability PRIMARY KEY (liability_id)
);

CREATE TABLE income (
    income_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    income_type pf_income_type NOT NULL,
    source text,
    amount numeric(19,4) NOT NULL,
    frequency pf_payment_frequency NOT NULL,
    start_date date NOT NULL,
    end_date date,
    growth_model_id uuid,
    probability_model_id uuid,
    tax_character pf_income_tax_character NOT NULL,
    gross_or_net text NOT NULL,
    related_event_id uuid,
    CONSTRAINT pk_income PRIMARY KEY (income_id)
);

CREATE TABLE expense (
    expense_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    category text NOT NULL,
    amount numeric(19,4) NOT NULL,
    frequency pf_payment_frequency NOT NULL,
    start_date date NOT NULL,
    end_date date,
    growth_model_id uuid,
    essentiality pf_expense_essentiality,
    tax_deductibility_rule_id uuid,
    payment_account_id uuid,
    event_trigger_id uuid,
    CONSTRAINT pk_expense PRIMARY KEY (expense_id)
);

CREATE TABLE "transaction" (
    transaction_id uuid NOT NULL,
    transaction_date timestamptz NOT NULL,
    transaction_type pf_transaction_type NOT NULL,
    amount numeric(19,4) NOT NULL,
    currency char(3) NOT NULL,
    source_account_id uuid,
    destination_account_id uuid,
    cash_flow_class pf_cash_flow_class NOT NULL,
    event_id uuid,
    scenario_id uuid NOT NULL,
    tax_effect numeric(19,4),
    description text,
    CONSTRAINT pk_transaction PRIMARY KEY (transaction_id)
);

CREATE TABLE event (
    event_id uuid NOT NULL,
    name text NOT NULL,
    event_type pf_event_type NOT NULL,
    description text,
    start_date date NOT NULL,
    end_date date,
    trigger_type pf_trigger_type NOT NULL,
    trigger_condition text,
    probability_model_id uuid,
    effect_ids jsonb NOT NULL,
    dependencies jsonb,
    precedence integer,
    scenario_id uuid NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT pk_event PRIMARY KEY (event_id)
);

CREATE TABLE scenario (
    scenario_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    base_scenario_id uuid,
    start_date date NOT NULL,
    end_date date NOT NULL,
    timestep pf_timestep NOT NULL,
    assumption_ids jsonb,
    event_ids jsonb,
    enabled boolean NOT NULL,
    stochastic boolean NOT NULL,
    simulation_count integer,
    CONSTRAINT pk_scenario PRIMARY KEY (scenario_id)
);

CREATE TABLE assumption (
    assumption_id uuid NOT NULL,
    name text NOT NULL,
    category pf_assumption_category NOT NULL,
    value numeric(19,6) NOT NULL,
    unit text NOT NULL,
    start_date date,
    end_date date,
    distribution_type pf_distribution_type,
    distribution_parameters jsonb,
    correlation_group text,
    source pf_source_type NOT NULL,
    confidence numeric(19,10),
    scenario_id uuid NOT NULL,
    CONSTRAINT pk_assumption PRIMARY KEY (assumption_id)
);

CREATE TABLE investment (
    investment_id uuid NOT NULL,
    account_id uuid NOT NULL,
    asset_id uuid,
    investment_type pf_investment_type NOT NULL,
    symbol text,
    quantity numeric(19,6) NOT NULL,
    expected_return numeric(19,10),
    volatility numeric(19,10),
    contribution_model_id uuid,
    return_model_id uuid,
    tax_treatment pf_tax_treatment NOT NULL,
    rebalancing_rule_id uuid,
    CONSTRAINT pk_investment PRIMARY KEY (investment_id)
);

CREATE TABLE insurance (
    insurance_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    insurance_type pf_insurance_type NOT NULL,
    provider text,
    policy_number text,
    premium numeric(19,4) NOT NULL,
    premium_frequency pf_payment_frequency NOT NULL,
    coverage_amount numeric(19,4),
    deductible numeric(19,4),
    copay numeric(19,4),
    coinsurance numeric(19,10),
    out_of_pocket_max numeric(19,4),
    start_date date NOT NULL,
    end_date date,
    claim_probability_model_id uuid,
    claim_effect_ids jsonb,
    CONSTRAINT pk_insurance PRIMARY KEY (insurance_id)
);

CREATE TABLE taxrule (
    tax_rule_id uuid NOT NULL,
    jurisdiction text NOT NULL,
    tax_type pf_tax_type NOT NULL,
    filing_status pf_filing_status,
    effective_date date NOT NULL,
    expiration_date date,
    brackets jsonb,
    rates jsonb,
    deduction_rules jsonb,
    credit_rules jsonb,
    contribution_limits jsonb,
    withdrawal_rules jsonb,
    taxability_rules jsonb,
    calculation_method pf_calculation_method NOT NULL,
    CONSTRAINT pk_taxrule PRIMARY KEY (tax_rule_id)
);

CREATE TABLE primitiveinstance (
    primitive_instance_id uuid NOT NULL,
    primitive_id text NOT NULL,
    input_bindings jsonb NOT NULL,
    parameters jsonb,
    start_date date,
    end_date date,
    scenario_id uuid NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT pk_primitiveinstance PRIMARY KEY (primitive_instance_id)
);

CREATE TABLE dependencynode (
    node_id uuid NOT NULL,
    node_key text NOT NULL,
    node_type pf_dependency_node_type NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    field_path text,
    timestep_scope text,
    scenario_id uuid NOT NULL,
    CONSTRAINT pk_dependencynode PRIMARY KEY (node_id)
);

CREATE TABLE dependencyedge (
    edge_id uuid NOT NULL,
    from_node_id uuid NOT NULL,
    to_node_id uuid NOT NULL,
    edge_type pf_dependency_edge_type NOT NULL,
    expression text,
    lag integer,
    priority integer,
    scenario_id uuid NOT NULL,
    CONSTRAINT pk_dependencyedge PRIMARY KEY (edge_id)
);

CREATE TABLE eventeffect (
    event_effect_id uuid NOT NULL,
    target_entity_type text NOT NULL,
    target_entity_id uuid NOT NULL,
    target_field_path text,
    operation text NOT NULL,
    value text,
    primitive_instance_id uuid,
    CONSTRAINT pk_eventeffect PRIMARY KEY (event_effect_id)
);

CREATE TABLE accountingleg (
    accounting_leg_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    posting_type pf_posting_sign NOT NULL,
    effect_type pf_accounting_effect_type NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    amount numeric(19,4) NOT NULL,
    currency char(3) NOT NULL,
    statement_section pf_statement_section,
    cash_flow_class pf_cash_flow_class,
    memo text,
    CONSTRAINT pk_accountingleg PRIMARY KEY (accounting_leg_id)
);

ALTER TABLE person ADD CONSTRAINT fk_person_household_id FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE account ADD CONSTRAINT fk_account_contribution_limit_rule_id FOREIGN KEY (contribution_limit_rule_id) REFERENCES taxrule(taxrule_id);
ALTER TABLE account ADD CONSTRAINT fk_account_fee_rule_id FOREIGN KEY (fee_rule_id) REFERENCES taxrule(taxrule_id);
ALTER TABLE account ADD CONSTRAINT fk_account_return_model_id FOREIGN KEY (return_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE asset ADD CONSTRAINT fk_asset_account_id FOREIGN KEY (account_id) REFERENCES account(account_id);
ALTER TABLE asset ADD CONSTRAINT fk_asset_appreciation_model_id FOREIGN KEY (appreciation_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE asset ADD CONSTRAINT fk_asset_depreciation_model_id FOREIGN KEY (depreciation_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE liability ADD CONSTRAINT fk_liability_amortization_model_id FOREIGN KEY (amortization_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE liability ADD CONSTRAINT fk_liability_fee_rule_id FOREIGN KEY (fee_rule_id) REFERENCES taxrule(taxrule_id);
ALTER TABLE liability ADD CONSTRAINT fk_liability_prepayment_rule_id FOREIGN KEY (prepayment_rule_id) REFERENCES taxrule(taxrule_id);
ALTER TABLE liability ADD CONSTRAINT fk_liability_collateral_id FOREIGN KEY (collateral_id) REFERENCES asset(asset_id);
ALTER TABLE income ADD CONSTRAINT fk_income_growth_model_id FOREIGN KEY (growth_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE income ADD CONSTRAINT fk_income_probability_model_id FOREIGN KEY (probability_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE income ADD CONSTRAINT fk_income_related_event_id FOREIGN KEY (related_event_id) REFERENCES event(event_id);
ALTER TABLE expense ADD CONSTRAINT fk_expense_growth_model_id FOREIGN KEY (growth_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE expense ADD CONSTRAINT fk_expense_tax_deductibility_rule_id FOREIGN KEY (tax_deductibility_rule_id) REFERENCES taxrule(taxrule_id);
ALTER TABLE expense ADD CONSTRAINT fk_expense_payment_account_id FOREIGN KEY (payment_account_id) REFERENCES account(account_id);
ALTER TABLE expense ADD CONSTRAINT fk_expense_event_trigger_id FOREIGN KEY (event_trigger_id) REFERENCES event(event_id);
ALTER TABLE "transaction" ADD CONSTRAINT fk_transaction_source_account_id FOREIGN KEY (source_account_id) REFERENCES account(account_id);
ALTER TABLE "transaction" ADD CONSTRAINT fk_transaction_destination_account_id FOREIGN KEY (destination_account_id) REFERENCES account(account_id);
ALTER TABLE "transaction" ADD CONSTRAINT fk_transaction_event_id FOREIGN KEY (event_id) REFERENCES event(event_id);
ALTER TABLE "transaction" ADD CONSTRAINT fk_transaction_scenario_id FOREIGN KEY (scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE event ADD CONSTRAINT fk_event_probability_model_id FOREIGN KEY (probability_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE event ADD CONSTRAINT fk_event_scenario_id FOREIGN KEY (scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE scenario ADD CONSTRAINT fk_scenario_base_scenario_id FOREIGN KEY (base_scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE assumption ADD CONSTRAINT fk_assumption_scenario_id FOREIGN KEY (scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE investment ADD CONSTRAINT fk_investment_account_id FOREIGN KEY (account_id) REFERENCES account(account_id);
ALTER TABLE investment ADD CONSTRAINT fk_investment_asset_id FOREIGN KEY (asset_id) REFERENCES asset(asset_id);
ALTER TABLE investment ADD CONSTRAINT fk_investment_contribution_model_id FOREIGN KEY (contribution_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE investment ADD CONSTRAINT fk_investment_return_model_id FOREIGN KEY (return_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE investment ADD CONSTRAINT fk_investment_rebalancing_rule_id FOREIGN KEY (rebalancing_rule_id) REFERENCES rule(rule_id);
ALTER TABLE insurance ADD CONSTRAINT fk_insurance_claim_probability_model_id FOREIGN KEY (claim_probability_model_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE primitiveinstance ADD CONSTRAINT fk_primitiveinstance_scenario_id FOREIGN KEY (scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE dependencynode ADD CONSTRAINT fk_dependencynode_scenario_id FOREIGN KEY (scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE dependencyedge ADD CONSTRAINT fk_dependencyedge_from_node_id FOREIGN KEY (from_node_id) REFERENCES dependencynode(dependencynode_id);
ALTER TABLE dependencyedge ADD CONSTRAINT fk_dependencyedge_to_node_id FOREIGN KEY (to_node_id) REFERENCES dependencynode(dependencynode_id);
ALTER TABLE dependencyedge ADD CONSTRAINT fk_dependencyedge_scenario_id FOREIGN KEY (scenario_id) REFERENCES scenario(scenario_id);
ALTER TABLE eventeffect ADD CONSTRAINT fk_eventeffect_primitive_instance_id FOREIGN KEY (primitive_instance_id) REFERENCES primitiveinstance(primitiveinstance_id);
ALTER TABLE accountingleg ADD CONSTRAINT fk_accountingleg_transaction_id FOREIGN KEY (transaction_id) REFERENCES "transaction"(transaction_id);

CREATE TABLE household_member (household_id uuid NOT NULL REFERENCES household(household_id), person_id uuid NOT NULL REFERENCES person(person_id), valid_from date, valid_to date, PRIMARY KEY (household_id, person_id, valid_from));
CREATE TABLE scenario_assumption (scenario_id uuid NOT NULL REFERENCES scenario(scenario_id), assumption_id uuid NOT NULL REFERENCES assumption(assumption_id), PRIMARY KEY (scenario_id, assumption_id));
CREATE TABLE scenario_event (scenario_id uuid NOT NULL REFERENCES scenario(scenario_id), event_id uuid NOT NULL REFERENCES event(event_id), PRIMARY KEY (scenario_id, event_id));
CREATE TABLE account_withdrawal_rule (account_id uuid NOT NULL REFERENCES account(account_id), tax_rule_id uuid NOT NULL REFERENCES taxrule(tax_rule_id), PRIMARY KEY (account_id, tax_rule_id));
CREATE TABLE account_transaction (account_id uuid NOT NULL REFERENCES account(account_id), transaction_id uuid NOT NULL REFERENCES "transaction"(transaction_id), PRIMARY KEY (account_id, transaction_id));
CREATE TABLE event_effect (event_effect_id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES event(event_id), target_entity_type text NOT NULL, target_entity_id uuid NOT NULL, target_field_path text NOT NULL, operation text NOT NULL, value jsonb, primitive_instance_id uuid REFERENCES primitiveinstance(primitive_instance_id));
CREATE TABLE transaction_leg (accounting_leg_id uuid PRIMARY KEY, transaction_id uuid NOT NULL REFERENCES "transaction"(transaction_id), posting_type pf_posting_sign NOT NULL, effect_type pf_accounting_effect_type NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, amount numeric(19,4) NOT NULL CHECK (amount >= 0), currency char(3) NOT NULL, statement_section pf_statement_section NOT NULL, cash_flow_class pf_cash_flow_class NOT NULL, memo text);
CREATE TABLE event_dependency (event_id uuid NOT NULL REFERENCES event(event_id), node_id uuid NOT NULL REFERENCES dependencynode(node_id), edge_type pf_dependency_edge_type NOT NULL, lag integer NOT NULL DEFAULT 0 CHECK (lag >= 0), PRIMARY KEY(event_id,node_id,edge_type));
CREATE TABLE dependency_edge (edge_id uuid PRIMARY KEY, from_node_id uuid NOT NULL REFERENCES dependencynode(node_id), to_node_id uuid NOT NULL REFERENCES dependencynode(node_id), edge_type pf_dependency_edge_type NOT NULL, expression text, lag integer NOT NULL DEFAULT 0 CHECK(lag >= 0), priority integer NOT NULL DEFAULT 0, scenario_id uuid NOT NULL REFERENCES scenario(scenario_id), CHECK(from_node_id <> to_node_id OR lag >= 1));
CREATE INDEX idx_dependency_edge_to ON dependency_edge(to_node_id);
CREATE INDEX idx_transaction_leg_transaction ON transaction_leg(transaction_id);
CREATE INDEX idx_event_effect_target ON event_effect(target_entity_type,target_entity_id);
CREATE INDEX idx_person_household ON person(household_id);
CREATE INDEX idx_account_owner ON account(owner_id);
CREATE INDEX idx_asset_owner ON asset(owner_id);
CREATE INDEX idx_liability_owner ON liability(owner_id);
CREATE INDEX idx_income_owner ON income(owner_id);
CREATE INDEX idx_expense_owner ON expense(owner_id);
COMMIT;

-- Semantic rules intentionally enforced by the application/domain layer:
-- * polymorphic owner/entity references (Person|Household and entity_type/entity_id);
-- * cross-table UUID target validation;
-- * temporal/cardinality invariants;
-- * balanced debits/credits per currency;
-- * dependency-graph acyclicity except explicit lagged state;
-- * conflicting-write priority rules;
-- * derived values are non-authoritative.
