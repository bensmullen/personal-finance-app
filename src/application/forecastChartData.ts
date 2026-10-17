import type {
  HouseholdForecastBoundaries,
  HouseholdForecastPoint,
  HouseholdMoneyReadModel,
  HouseholdOpeningSnapshot,
  PersonalHouseholdForecastReadModel,
} from "./householdProjection.js";
import { Currency, Money } from "../values/index.js";

export type ForecastChartStatus = "complete" | "incomplete" | "unavailable";
export type ForecastChartGranularity = "monthly" | "annual";

/** Deliberately no bank-cash or disposable-pay aliases. */
export const forecastChartInterpretation = Object.freeze({
  totalModeledCash: "All account cash, including brokerage and retirement wrappers",
  totalModeledCashChange: "Signed change in the same total modeled account cash balance",
  modeledStatementIncome: "Modeled recognized statement income",
  modeledStatementExpenses: "Modeled recognized statement expenses",
  unsupported: Object.freeze([
    "bankCash", "payrollDisposableIncome", "investmentAttribution", "retirementIncomeBySource",
  ] as const),
});

const sourceFields = {
  totalAssets: "totalAssets",
  totalLiabilities: "totalLiabilities",
  netWorth: "netWorth",
  totalModeledCash: "cash",
  totalInvestmentValue: "investmentValue",
  modeledStatementIncome: "statementIncome",
  modeledStatementExpenses: "statementExpenses",
} as const;
export type ForecastChartMetric = keyof typeof sourceFields | "totalModeledCashChange";
const metricKeys: readonly ForecastChartMetric[] = Object.freeze([
  ...(Object.keys(sourceFields) as (keyof typeof sourceFields)[]), "totalModeledCashChange",
]);
const flowKeys: ReadonlySet<ForecastChartMetric> = new Set([
  "modeledStatementIncome", "modeledStatementExpenses", "totalModeledCashChange",
]);

export interface ForecastChartValue {
  readonly amount: string | null;
  readonly currency: string;
  readonly status: ForecastChartStatus;
  readonly traceIds: readonly string[];
  /** Stocks may fall back to an earlier supported annual close. */
  readonly closingAt?: string;
}
export type ForecastChartMetrics = Readonly<Record<ForecastChartMetric, ForecastChartValue>>;
export interface ForecastChartPeriod {
  readonly periodKind: "projected";
  readonly granularity: ForecastChartGranularity;
  /** Actual covered bounds, always exclusive at end; never padded to a year. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly coveredMonthCount: number;
  readonly coverage: "complete_month" | "full_year" | "partial_year";
  readonly metrics: ForecastChartMetrics;
  readonly traceIds: readonly string[];
}
export interface ForecastChartOpening {
  readonly periodKind: "opening";
  readonly source: "openingSnapshot";
  readonly at: string;
  readonly metrics: ForecastChartMetrics;
}
export interface ForecastChartData {
  readonly status: ForecastChartStatus;
  readonly sourceStatus: PersonalHouseholdForecastReadModel["status"];
  readonly granularity: ForecastChartGranularity;
  readonly currency: string | null;
  readonly actualHistoryAvailable: false;
  readonly interpretation: typeof forecastChartInterpretation;
  readonly sourceFingerprint?: string;
  readonly boundaries?: HouseholdForecastBoundaries;
  readonly horizonCoverage: "complete" | "partial" | "unavailable";
  readonly opening: ForecastChartOpening | null;
  readonly points: readonly ForecastChartPeriod[];
  /** All exact months retained even when annual points are requested. */
  readonly monthlyPoints: readonly ForecastChartPeriod[];
  readonly unavailableReason?: string;
}

const ids = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)]);
const value = (
  amount: string | null, currency: string, status: ForecastChartStatus,
  traceIds: readonly string[] = Object.freeze([]),
  closingAt?: string,
): ForecastChartValue => Object.freeze({
  amount, currency, status, traceIds,
  ...(closingAt === undefined ? {} : { closingAt }),
});

/** Only exact UTC calendar months may be grouped by year. */
const monthBoundary = (at: string): number => {
  if (!/^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(at)) throw new Error("invalid_month_boundary");
  const date = new Date(at);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== at) throw new Error("invalid_month_boundary");
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

/** Pure DTO selection: never executes a forecast or resolves replay trace artifacts. */
export const selectForecastChartData = (
  source: PersonalHouseholdForecastReadModel,
  options: { readonly granularity?: ForecastChartGranularity; readonly sourceFingerprint?: string } = {},
): ForecastChartData => {
  const granularity = options.granularity ?? "monthly";
  const common = {
    sourceStatus: source.status, granularity, actualHistoryAvailable: false as const,
    interpretation: forecastChartInterpretation,
    ...(options.sourceFingerprint === undefined ? {} : { sourceFingerprint: options.sourceFingerprint }),
  };
  const empty = Object.freeze([]);
  const unavailable = (reason: string, boundaries?: HouseholdForecastBoundaries): ForecastChartData => Object.freeze({
    ...common, status: "unavailable", currency: null, horizonCoverage: "unavailable",
    opening: null, points: empty, monthlyPoints: empty, unavailableReason: reason,
    ...(boundaries === undefined ? {} : { boundaries }),
  });
  if (source.status === "unavailable") return unavailable(source.message);
  const boundaries: HouseholdForecastBoundaries = Object.freeze({
    requestedHorizon: Object.freeze({ ...source.requestedHorizon }),
    ...(source.reachedThrough === undefined ? {} : { reachedThrough: source.reachedThrough }),
    ...(source.stoppedAt === undefined ? {} : { stoppedAt: source.stoppedAt }),
    asOf: source.asOf, dataCutoff: source.dataCutoff,
    simulationStart: source.simulationStart, simulationEnd: source.simulationEnd,
    actualForecastBoundary: source.actualForecastBoundary,
  });
  try {
    const start = monthBoundary(source.requestedHorizon.start);
    const end = monthBoundary(source.requestedHorizon.end);
    if (end <= start || source.simulationStart !== source.requestedHorizon.start ||
        source.simulationEnd !== source.requestedHorizon.end) throw new Error("invalid_requested_horizon");
    const currency = Currency.of(source.openingSnapshot.cash.currency);
    const parse = (item: HouseholdMoneyReadModel): Money => {
      if (item.currency !== currency.code) throw new Error("currency_mismatch");
      return Money.parse(item.amount, currency);
    };
    const validate = (item: HouseholdOpeningSnapshot | HouseholdForecastPoint): void => {
      for (const field of ["cash", "investmentValue", "totalAssets", "totalLiabilities", "netWorth"] as const) parse(item[field]);
      if (!parse(item.totalAssets).minus(parse(item.totalLiabilities)).equals(parse(item.netWorth)))
        throw new Error("net_worth_identity_mismatch");
    };
    const extract = (
      item: HouseholdOpeningSnapshot | HouseholdForecastPoint, traceIds: readonly string[],
    ): Record<ForecastChartMetric, ForecastChartValue> => {
      const result = {} as Record<ForecastChartMetric, ForecastChartValue>;
      for (const key of metricKeys) {
        if (key === "totalModeledCashChange") {
          result[key] = value(null, currency.code, "unavailable");
          continue;
        }
        const field = sourceFields[key];
        const money = field in item ? (item as HouseholdForecastPoint)[field] : undefined;
        if (money !== undefined) parse(money);
        const capability = item.outputCapabilities?.[field];
        result[key] = money === undefined || capability === undefined
          ? value(null, currency.code, "unavailable", traceIds)
          : value(money.amount, currency.code, capability.status, traceIds,
            flowKeys.has(key) ? undefined : "periodEnd" in item ? item.periodEnd : source.requestedHorizon.start);
      }
      return result;
    };
    validate(source.openingSnapshot);
    const opening: ForecastChartOpening = Object.freeze({
      periodKind: "opening", source: "openingSnapshot", at: source.requestedHorizon.start,
      metrics: Object.freeze(extract(source.openingSnapshot, empty)),
    });
    let previousCash = opening.metrics.totalModeledCash;
    let expected = start;
    const months: ForecastChartPeriod[] = [];
    for (const point of source.points) {
      const from = monthBoundary(point.periodStart);
      const to = monthBoundary(point.periodEnd);
      if (from !== expected || to !== from + 1 || to > end) throw new Error("noncontiguous_monthly_periods");
      validate(point);
      const traceIds = ids(point.traceIds);
      const metrics = extract(point, traceIds);
      const cash = metrics.totalModeledCash;
      metrics.totalModeledCashChange = cash.amount === null || previousCash.amount === null
        ? value(null, currency.code, "unavailable", ids([...previousCash.traceIds, ...traceIds]))
        : value(Money.parse(cash.amount, currency).minus(Money.parse(previousCash.amount, currency)).amount.toString(),
          currency.code, cash.status === "complete" && previousCash.status === "complete" ? "complete" : "incomplete",
          ids([...previousCash.traceIds, ...traceIds]));
      months.push(Object.freeze({
        periodKind: "projected", granularity: "monthly", periodStart: point.periodStart,
        periodEnd: point.periodEnd, coveredMonthCount: 1, coverage: "complete_month",
        metrics: Object.freeze(metrics), traceIds,
      }));
      previousCash = cash;
      expected = to;
    }
    const lastEnd = months[months.length - 1]?.periodEnd;
    if ((source.reachedThrough !== undefined && source.reachedThrough !== (lastEnd ?? source.requestedHorizon.start)) ||
        (lastEnd !== undefined && source.reachedThrough === undefined)) throw new Error("invalid_reached_coverage");
    if (source.stoppedAt !== undefined && monthBoundary(source.stoppedAt) !== expected) throw new Error("invalid_stopped_coverage");
    const horizonCoverage = expected === end ? "complete" as const : "partial" as const;
    const monthlyPoints = Object.freeze(months);
    const points = granularity === "monthly" ? monthlyPoints : aggregateYears(monthlyPoints, currency);
    const incomplete = source.status === "incomplete" || horizonCoverage === "partial" || points.length === 0 ||
      points.some(point => point.coverage === "partial_year" || metricKeys.some(key => point.metrics[key].status !== "complete"));
    return Object.freeze({
      ...common, status: incomplete ? "incomplete" : "complete", currency: currency.code,
      boundaries, horizonCoverage, opening, points, monthlyPoints,
    });
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "invalid_forecast_source", boundaries);
  }
};

const aggregateYears = (months: readonly ForecastChartPeriod[], currency: Currency): readonly ForecastChartPeriod[] => {
  const groups = new Map<string, ForecastChartPeriod[]>();
  for (const month of months) {
    const year = month.periodStart.slice(0, 4);
    const group = groups.get(year);
    if (group === undefined) groups.set(year, [month]);
    else group.push(month);
  }
  return Object.freeze([...groups.values()].map(group => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const fullYear = group.length === 12 && first.periodStart.slice(5, 7) === "01" && last.periodStart.slice(5, 7) === "12";
    const metrics = {} as Record<ForecastChartMetric, ForecastChartValue>;
    for (const key of metricKeys) {
      const values = group.map(month => month.metrics[key]);
      const traceIds = ids(values.flatMap(item => item.traceIds));
      const complete = fullYear && values.every(item => item.status === "complete");
      if (flowKeys.has(key)) {
        // A partial sum with unknown months would invite a false numeric total.
        metrics[key] = values.some(item => item.amount === null)
          ? value(null, currency.code, "unavailable", traceIds)
          : value(values.reduce((sum, item) => sum.plus(Money.parse(item.amount!, currency)), Money.zero(currency)).amount.toString(),
            currency.code, complete ? "complete" : "incomplete", traceIds);
      } else {
        const closing = [...values].reverse().find(item => item.amount !== null);
        metrics[key] = value(closing?.amount ?? null, currency.code,
          closing === undefined ? "unavailable" : complete ? "complete" : "incomplete", traceIds, closing?.closingAt);
      }
    }
    return Object.freeze({
      periodKind: "projected", granularity: "annual", periodStart: first.periodStart,
      periodEnd: last.periodEnd, coveredMonthCount: group.length,
      coverage: fullYear ? "full_year" : "partial_year", metrics: Object.freeze(metrics),
      traceIds: ids(group.flatMap(month => month.traceIds)),
    });
  }));
};
