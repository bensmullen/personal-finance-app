# Alpha onboarding: manual-entry reduction and aggregator evaluation (2026-10-11)

**Status:** non-normative vendor discovery and staged product recommendation; **not** an approved purchase, implementation, contracted rate, or a claim of production readiness. Companion [Issue #108](https://github.com/bensmullen/personal-finance-app/issues/108) and [household fixture blueprints](household-blueprints.md).

## Decision
**Do not make commercial Plaid integration an R11 hard prerequisite.** Deliver seven populated demo households to remove all data-entry burden during product exploration, then targeted bank/brokerage CSV import under existing O1/PFA-ONB requirements, with a separate optional Plaid Trial + SnapTrade brokerage comparison. Production account linking should require verified bank/institution coverage, data quality, secure shared-service persistence and explicit unit economics.

## Why an aggregator helps and what it cannot supply
| Financial need | Potential automated source | Important limitation |
| --- | --- | --- |
| Cash/card balances, spending & payroll deposits | Plaid Transactions/Balance | 24-month ceiling; categorizations require review; paycheck deposits do not fully define gross salary/benefits |
| Liability balances | Plaid Liabilities, supported institutions | Loan terms, escrow/payment funding may be absent/uneven; borrower must review |
| Brokerage holdings & present positions | Plaid Investments / SnapTrade | Security IDs, duplicate accounts, stale values, account cash and holdings must reconcile |
| Investment trading activity | Plaid Investments transactions; SnapTrade activities | Plaid maximum 24 months; missing historic corporate actions/old lots possible |
| Acquisition lots, tax basis | Plaid Investments `tax_lots` where institution provides | Empty tax_lots is legitimate; **not a guarantee** of 20-year cost basis |
| Planning preferences & life goals | Short guided user input | Aggregators do not know retirement goals, future education expenses, domicile elections, estate decisions, planned moves |
| Historical statements and old purchase lots | Bank/broker exports, statement import | Formats variable and ownership/provenance need review |

### Provider shortlist (official published data)
- **Plaid** — investment holdings, up to 24 months investment transactions, optional tax lots, holdings refresh; broad banking, credit and lending. Public pricing does **not** expose product per-Item dollars. Eligible new-account Trial has 10 production Items free; existing accounts may differ. Transactions, Investments and Liabilities usually subscription fees per connected Item; on-demand refresh may have separate fees; access timing differs by institution (notably Fidelity).
  - Pricing: https://plaid.com/pricing/ ; https://plaid.com/docs/account/billing/
  - Trial: https://support.plaid.com/hc/en-us/articles/16110502116887-What-are-Plaid-s-prices-and-pricing-plans-and-how-do-they-differ
  - Lot/history/coverage: https://plaid.com/docs/investments/ ; https://plaid.com/docs/institutions/
- **SnapTrade** — brokerage-focused; public Launch monthly base **$100** + **$1/connected user/month** for daily read-only data or **$2/user/month** real-time. Build plan 5 connected test accounts free. Data consistency and available lot history need testing against actual broker cohort; not substitute for bank transaction coverage. https://snaptrade.com/pricing ; https://docs.snaptrade.com/docs/account-data
- **MX** — bank aggregation + normalized investment positions and other assets including HSA/529; commercial quote needed. https://www.mx.com/products/account-aggregation/ ; https://www.mx.com/products/investment-data/
- **Mastercard Open Finance (Finicity)** — consumer-permissioned account/transaction/position data; quote and brokerage capability confirmation needed. https://www.mastercard.com/us/en/news-and-trends/Insights/2026/amid-rising-competition-wealth-management-providers-can-score-with-investment-insights.html
- **SimpleFIN** — inexpensive user-paid bridge ($1.50/month or $15/year consumer price published) to explore limited personal finance use cases, *not* evidence of acceptable commercial redistribution, institution breadth, tax-lot support, or licensing. https://beta-bridge.simplefin.org/

## Explicit rough one-developer estimates, *not* verified engineering budgets
- Targeted CSV import from one high-priority bank format and brokerage holdings/transactions: **2–5 engineering weeks**, with format/mapping-specific maintenance afterward. Universal statement PDF/OCR is not implied.
- Synthetic demo loader/generator plus seven personas, overview and guided experiences, after canonical engine/domain features: **3–6 weeks**, potentially longer if estate/rental/cross-state mechanics are required rather than scoped incomplete.
- Plaid proof of concept in Sandbox/eligible Trial: **1–2 weeks**; production-grade adapter/review/secure storage/webhooks/consent handling/QA: **6–12+ weeks**, longer if shared auth/privacy/persistence infra is not already available. Multiple providers and historical lot reconciliation are additional major workstreams.
- Provider fees only one component: include failed/relinked Items, inactive retained connections, updates, historical exports, customer support, security reviews, maintenance, chargebacks/quotas and privacy obligations. Verify actual applicable pricing within provider dashboard or signed quote before a commercial go/no-go.
- SnapTrade illustrative bill: 100 active connected users (daily-only) -> **$200/mo**; 1,000 -> **$1,100/mo**, before applicable taxes/other provider charges. Plaid invoice per paying user cannot be inferred without number of linked Items/products and contracted rates.

## Provider-neutral technical/product policy
1. Account linking/import both produce **typed candidates with provenance**, not direct authoritative ledger writes; no double credit-card/payment/mortgage/transfer spending, basis fabrication, unsupported law inference or transaction duplication.
2. Imported household snapshot, posted transaction history, and user-confirmed **future** assumptions remain separate. Preserve how old a value is, account owner, connection state, coverage gaps and confidence/approximation.
3. Review unresolved or conflicting facts, then deliberate commit. No investment projection silently claims full tax-aware accuracy when lots, taxable basis or capital-gains history are missing.
4. Support deletion/disconnection, retry, reconnect, revoked access, stale snapshots, OAuth, historical-import gaps and automatic update idempotency. Enforce consent, token protection, scoped data access, auditability, no raw financial data in logs, and genuine data retention controls before shared alpha.
5. Test provider coverage for actual prioritized firms (Fidelity, Schwab, Vanguard, E*TRADE, 401(k) recordkeeper, key checking banks), account types (brokerage, 401k, IRA, HSA, mortgage, credit cards), lots/historical precision, error rates, retries, link completion and cash reconciliation.
6. Target the user journey: `Explore a demo` -> `Create household with essential facts` -> `Import file or optionally connect accounts` -> `Review/confirm` -> `First useful forecast` -> `Progressive completeness suggestions`. Do not gate the first insight on uploading decades of purchase history.

## Product go/no-go before provider production
- Demonstrated median/p90 time to first useful forecast and abandonment for assisted/import/demo paths; thresholds chosen based on representative dry runs per PFA-ONB-001/011.
- Targeted institution/product/lot coverage measured (not generic provider marketing numbers), reconciliation quality, privacy/security/persistence readiness, monthly spend sensitivity at 100/1,000 connected users, and a named operator for reliability/disconnection support.
- Optional downstream paid-tier financing of enhanced connectivity and updates can be considered *after* actual cost/user measurement; no need to build a hard paywall architecture merely to test a provider.
