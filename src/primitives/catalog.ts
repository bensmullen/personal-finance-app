import { failValidation, issueCodes } from "../diagnostics/index.js";

export type PrimitiveId =
  | "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07" | "P08" | "P09"
  | "P10" | "P11" | "P12" | "P13" | "P14" | "P15" | "P16" | "P17" | "P18"
  | "P19" | "P20" | "P21" | "P22" | "P23" | "P24" | "P25" | "P26" | "P27"
  | "P28" | "P29" | "P30" | "P31" | "P32" | "P33" | "P34";

export type ImplementedPrimitiveId = "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P08" | "P13" | "P20" | "P22" | "P23" | "P24" | "P26" | "P27" | "P29" | "P30";
export type RegisteredOnlyPrimitiveId = Exclude<PrimitiveId, ImplementedPrimitiveId>;
export type PrimitiveClass = "temporal" | "functional" | "dependency" | "financial_mechanics" | "event_uncertainty";
export type PrimitiveRandomness = "deterministic" | "deterministic_or_stochastic" | "stochastic" | "either";
export type PrimitiveImplementationStatus = "implemented" | "registered_only";

export interface PrimitiveDefinition {
  readonly id: PrimitiveId;
  readonly name: string;
  readonly class: PrimitiveClass;
  readonly stateful: boolean;
  readonly randomness: PrimitiveRandomness;
  readonly implementationStatus: PrimitiveImplementationStatus;
}

const definition = <T extends PrimitiveDefinition>(value: T): Readonly<T> => Object.freeze(value);

export const primitiveCatalogEntries = Object.freeze([
  definition({ id: "P01", name: "static", class: "temporal", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P02", name: "one_time", class: "temporal", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P03", name: "recurring", class: "temporal", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P04", name: "finite_duration", class: "temporal", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P05", name: "perpetual", class: "temporal", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P06", name: "constant", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P07", name: "linear", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P08", name: "geometric_growth", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P09", name: "geometric_decline", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P10", name: "stepwise", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P11", name: "piecewise", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P12", name: "periodic", class: "functional", stateful: false, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P13", name: "inflation_linked", class: "functional", stateful: true, randomness: "deterministic_or_stochastic", implementationStatus: "implemented" }),
  definition({ id: "P14", name: "index_linked", class: "functional", stateful: true, randomness: "deterministic_or_stochastic", implementationStatus: "registered_only" }),
  definition({ id: "P15", name: "balance_dependent", class: "dependency", stateful: true, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P16", name: "income_dependent", class: "dependency", stateful: true, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P17", name: "age_dependent", class: "dependency", stateful: true, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P18", name: "account_dependent", class: "dependency", stateful: true, randomness: "deterministic", implementationStatus: "registered_only" }),
  definition({ id: "P19", name: "market_dependent", class: "dependency", stateful: true, randomness: "stochastic", implementationStatus: "registered_only" }),
  definition({ id: "P20", name: "tax_dependent", class: "dependency", stateful: true, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P21", name: "dependency_driven", class: "dependency", stateful: true, randomness: "either", implementationStatus: "registered_only" }),
  definition({ id: "P22", name: "amortization", class: "financial_mechanics", stateful: true, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P23", name: "compounding", class: "financial_mechanics", stateful: true, randomness: "deterministic_or_stochastic", implementationStatus: "implemented" }),
  definition({ id: "P24", name: "accrual", class: "financial_mechanics", stateful: true, randomness: "deterministic", implementationStatus: "implemented" }),
  definition({ id: "P25", name: "depreciation", class: "financial_mechanics", stateful: true, randomness: "deterministic_or_stochastic", implementationStatus: "registered_only" }),
  definition({ id: "P26", name: "mark_to_market", class: "financial_mechanics", stateful: true, randomness: "stochastic", implementationStatus: "implemented" }),
  definition({ id: "P27", name: "event_trigger", class: "event_uncertainty", stateful: true, randomness: "either", implementationStatus: "implemented" }),
  definition({ id: "P28", name: "conditional", class: "event_uncertainty", stateful: true, randomness: "either", implementationStatus: "registered_only" }),
  definition({ id: "P29", name: "event_modification", class: "event_uncertainty", stateful: true, randomness: "either", implementationStatus: "implemented" }),
  definition({ id: "P30", name: "event_termination", class: "event_uncertainty", stateful: true, randomness: "either", implementationStatus: "implemented" }),
  definition({ id: "P31", name: "probabilistic", class: "event_uncertainty", stateful: false, randomness: "stochastic", implementationStatus: "registered_only" }),
  definition({ id: "P32", name: "scenario_dependent", class: "event_uncertainty", stateful: false, randomness: "deterministic_or_stochastic", implementationStatus: "registered_only" }),
  definition({ id: "P33", name: "correlated_random_process", class: "event_uncertainty", stateful: true, randomness: "stochastic", implementationStatus: "registered_only" }),
  definition({ id: "P34", name: "path_dependent", class: "event_uncertainty", stateful: true, randomness: "either", implementationStatus: "registered_only" }),
] as const satisfies readonly PrimitiveDefinition[]);

const catalogById: ReadonlyMap<PrimitiveId, PrimitiveDefinition> = new Map(
  primitiveCatalogEntries.map((entry) => [entry.id, entry]),
);

export const listPrimitiveDefinitions = (): readonly PrimitiveDefinition[] => primitiveCatalogEntries;

export const isPrimitiveId = (value: string): value is PrimitiveId => catalogById.has(value as PrimitiveId);

export const parsePrimitiveId = (value: string): PrimitiveId => {
  if (!isPrimitiveId(value)) {
    failValidation({
      severity: "error",
      code: issueCodes.primitiveUnknown,
      message: `Unknown primitive identity: ${value}`,
      entityType: "primitive",
      entityId: value,
      fieldPath: "primitive_id",
    });
  }
  return value;
};

export const getPrimitiveDefinition = (value: string): PrimitiveDefinition => catalogById.get(parsePrimitiveId(value))!;

export const isImplementedPrimitive = (id: PrimitiveId): id is ImplementedPrimitiveId =>
  catalogById.get(id)?.implementationStatus === "implemented";

export const requireImplementedPrimitive = (id: PrimitiveId): ImplementedPrimitiveId => {
  if (!isImplementedPrimitive(id)) {
    failValidation({
      severity: "error",
      code: issueCodes.primitiveNotImplemented,
      message: `Primitive ${id} (${catalogById.get(id)!.name}) is registered but not implemented`,
      entityType: "primitive",
      entityId: id,
    });
  }
  return id;
};
