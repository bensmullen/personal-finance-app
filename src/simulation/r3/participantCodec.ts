import type { HouseholdKernelParticipant } from "../householdExecution.js";

/** Portable configuration identity. Executable callbacks never cross this boundary. */
export interface PortableHouseholdParticipant {
  readonly id: string;
  readonly version: string;
  readonly codec: string;
  readonly economicInputs: unknown;
}
export interface HouseholdParticipantCodec {
  readonly codec: string;
  readonly restore: (inputs: unknown) => HouseholdKernelParticipant;
}
const codecs = new Map<string, HouseholdParticipantCodec>();
export const registerHouseholdParticipantCodec = (codec: HouseholdParticipantCodec): void => {
  if (codecs.has(codec.codec)) throw new Error(`HOUSEHOLD_PARTICIPANT_CODEC_DUPLICATE: ${codec.codec}`);
  codecs.set(codec.codec, Object.freeze(codec));
};
export const portableHouseholdParticipant = (participant: HouseholdKernelParticipant): PortableHouseholdParticipant => {
  if (participant.portableCodec === undefined || !codecs.has(participant.portableCodec))
    throw new Error(`HOUSEHOLD_PARTICIPANT_CODEC_UNAVAILABLE: ${participant.id}/${participant.version}`);
  return Object.freeze({ id: participant.id, version: participant.version, codec: participant.portableCodec, economicInputs: participant.economicInputs });
};
export const restoreHouseholdParticipant = (input: PortableHouseholdParticipant): HouseholdKernelParticipant => {
  const codec = codecs.get(input.codec);
  if (codec === undefined) throw new Error(`HOUSEHOLD_PARTICIPANT_CODEC_UNAVAILABLE: ${input.codec}`);
  const participant = codec.restore(input.economicInputs);
  if (participant.id !== input.id || participant.version !== input.version || participant.portableCodec !== input.codec)
    throw new Error("HOUSEHOLD_PARTICIPANT_CODEC_MISMATCH: immutable participant identity changed");
  return participant;
};
