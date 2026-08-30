declare const semanticIdentityBrand: unique symbol;
type SemanticIdentity<Kind extends string> = string & { readonly [semanticIdentityBrand]: Kind };

export type RecognitionId = SemanticIdentity<"RecognitionId">;
export type ClaimId = SemanticIdentity<"ClaimId">;
export type SettlementProposalId = SemanticIdentity<"SettlementProposalId">;
export type SettlementId = SemanticIdentity<"SettlementId">;
export type SemanticEffectId = SemanticIdentity<"SemanticEffectId">;

const semanticId = <Kind extends string>(kind: Kind, value: string): SemanticIdentity<Kind> => {
  if (value.trim().length === 0) throw new Error(`${kind} cannot be empty`);
  return value as SemanticIdentity<Kind>;
};

export const recognitionId = (value: string): RecognitionId => semanticId("RecognitionId", value);
export const claimId = (value: string): ClaimId => semanticId("ClaimId", value);
export const settlementProposalId = (value: string): SettlementProposalId => semanticId("SettlementProposalId", value);
export const settlementId = (value: string): SettlementId => semanticId("SettlementId", value);
export const semanticEffectId = (value: string): SemanticEffectId => semanticId("SemanticEffectId", value);
