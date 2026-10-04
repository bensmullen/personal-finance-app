import { ValidationError } from "../../diagnostics/index.js";
import type { HouseholdWorkDescriptor } from "../intraperiodScheduler.js";
import type { AuthoritativeState } from "../../state/index.js";
import type { PrimitiveRuntimeStateStore } from "../period.js";
import type { AccountId } from "../../accounting/index.js";
import type { Money } from "../../values/index.js";

/** Domain-owned proof data; deliberately outside the fingerprinted descriptor. */
export type OperationCommutativity =
  | { readonly kind: "fixed_owned_transfer"; readonly source: AccountId; readonly destination: AccountId; readonly amount: Money; readonly primitiveIds: readonly string[] }
  | { readonly kind: "guaranteed_unfunded_pool"; readonly accounts: readonly AccountId[]; readonly primitiveIds: readonly string[] }
  | { readonly kind: "nonnegative_cash_income"; readonly account: AccountId; readonly primitiveIds: readonly string[] }
  | { readonly kind: "guaranteed_first_source_service"; readonly primitiveIds: readonly string[] };

export interface OperationState {
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
}
export interface OperationResult<Facts> extends OperationState {
  readonly facts: Facts;
}
/** Domain owns financial behavior; orchestration sees only descriptor, state and facts. */
export interface PreparedHouseholdOperation<Facts> {
  readonly descriptor: HouseholdWorkDescriptor;
  readonly execute: (opening: OperationState, statuses: Map<string, string>) => OperationResult<Facts>;
  readonly commutativity?: (opening: OperationState) => OperationCommutativity | undefined;
}
export interface PreparedOperationParticipant<Facts> {
  readonly id: string;
  readonly operations: readonly PreparedHouseholdOperation<Facts>[];
}

/** One period-scoped index shared by all contention previews and final dispatch. */
export const indexPreparedOperations = <Facts>(participants: readonly PreparedOperationParticipant<Facts>[]) => {
  const operations = new Map<string, PreparedHouseholdOperation<Facts>>();
  const owners = new Set<string>();
  for (const participant of participants) {
    if (participant.id.trim() === "" || owners.has(participant.id)) throw new ValidationError({ severity: "error",
      code: "HOUSEHOLD_PARTICIPANT_DUPLICATE", message: "Prepared participant IDs must be unique.", entityType: "household_projection" });
    owners.add(participant.id);
    for (const operation of participant.operations) {
      if (operations.has(operation.descriptor.id)) throw new ValidationError({ severity: "error",
        code: "HOUSEHOLD_WORK_PLAN_INVALID", message: "Prepared operation IDs must be unique.", entityType: "household_projection",
        relatedIds: [operation.descriptor.id] });
      operations.set(operation.descriptor.id, operation);
    }
  }
  return Object.freeze({
    size: operations.size,
    descriptors: Object.freeze([...operations.values()].map(operation => operation.descriptor)),
    commutativity: (descriptor: HouseholdWorkDescriptor, opening: OperationState) => operations.get(descriptor.id)?.commutativity?.(opening),
    execute: (descriptor: HouseholdWorkDescriptor, opening: OperationState, statuses: Map<string, string>) => {
      const operation = operations.get(descriptor.id);
      if (operation === undefined) throw new ValidationError({ severity: "error",
        code: "HOUSEHOLD_OPERATION_MISSING", message: "Scheduled work has no prepared operation.", entityType: "household_projection",
        relatedIds: [descriptor.id] });
      return operation.execute(opening, statuses);
    },
  });
};
