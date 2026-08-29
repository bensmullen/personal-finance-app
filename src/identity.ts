import type { Instant } from "./time.js";

declare const uuidBrand: unique symbol;
declare const domainIdBrand: unique symbol;
declare const occurrenceKeyBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;

export type UUID = string & { readonly [uuidBrand]: "UUID" };
export type DomainId<Kind extends string> = UUID & { readonly [domainIdBrand]: Kind };
export type GeneratedOccurrenceKey = string & { readonly [occurrenceKeyBrand]: "GeneratedOccurrenceKey" };
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: "IdempotencyKey" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const uuid = (value: string): UUID => {
  const normalized = value.toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`Invalid UUID: ${value}`);
  return normalized as UUID;
};

export const domainId = <Kind extends string>(_kind: Kind, value: string): DomainId<Kind> => uuid(value) as DomainId<Kind>;

const encodeParts = (namespace: string, parts: readonly string[]): string =>
  `${namespace}:v1:${parts.map((part) => `${new TextEncoder().encode(part).length}:${part}`).join(":")}`;

export interface GeneratedOccurrenceIdentity {
  readonly scenarioId: DomainId<"scenario">;
  readonly primitiveInstanceId: DomainId<"primitive-instance">;
  readonly scheduledAt: Instant;
  readonly semanticEffectType: string;
  readonly economicTargetId: UUID;
}

export const generatedOccurrenceKey = (identity: GeneratedOccurrenceIdentity): GeneratedOccurrenceKey =>
  encodeParts("occurrence", [
    identity.scenarioId,
    identity.primitiveInstanceId,
    identity.scheduledAt,
    identity.semanticEffectType,
    identity.economicTargetId,
  ]) as GeneratedOccurrenceKey;

export const idempotencyKey = (sourceType: string, sourceId: string): IdempotencyKey => {
  if (sourceType.length === 0 || sourceId.length === 0) throw new Error("Idempotency key parts cannot be empty");
  return encodeParts("idempotency", [sourceType, sourceId]) as IdempotencyKey;
};
