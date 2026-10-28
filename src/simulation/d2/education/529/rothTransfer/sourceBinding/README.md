# Conditional original-source binding (#147)

`bind529RothSources` consumes compact versioned pins and five independently
parameterized trusted producer ports: original plan/funded lots/history, original
trustee instruction/destination, original dated law, person/year annual IRA
capacity plus exhaustive current usage, and compensation capacity plus exhaustive
current usage. A caller-authored `RothTransferRequest` is not an input. Digests
cover the full original record (including any publisher extensions) using the
repository canonical serializer and SHA-256; they identify content, not authority.
The caller must wire trusted original repositories, not callbacks that echo pins
or manufacture complete evidence. Annual and compensation records may share the
independent IRA producer but may not use the plan original's producer identity.

No authentic production IRA provider is invented here. The exact missing ports
are `RothOriginalPorts.annual` and `RothOriginalPorts.compensation`; each must
retrieve an original `RothOriginal` for the named source/version at the event
cutoff, including the independently owned `IraCapacity` and exhaustive posted and
pending `usage`. Missing ports produce `INDEPENDENT_CAPACITY_REQUIRED` and name
the missing port. These records do not reserve physical capacity; #149 owns
production integration, shared capacity, balances, claims, and atomic settlement.

Every envelope binds household/owner/beneficiary, plan/provider/account/holding,
destination/trustee, event/operation/claim, year, and cutoff. All originals are
retrieved again after the unchanged evaluator, including an incomplete result;
any amendment or withdrawal suppresses the occurrence. Later known-at dates do
not authorize future-known law. The original trustee instruction determines the
requested amount; oversized instructions retain the evaluator's bound and null
economics, never a partially admitted transfer.

Batch collisions reject all participants, including reissued IDs, shared plan,
holding, accounts, person/year capacity or capacity-original IDs. Admission is
conservative across the entire batch, including unavailable candidates. Separate
calls cannot establish durable claim exclusivity; the shared owner must arbitrate
those before posting. Event identities are supplied by the producer, independently
of forecast horizon, and are preserved without regeneration.

Outputs copy only compact exact-money economics, one bound, output coverage, and
five original pins. They omit sources, histories, lots and catalogs. No state is
written. All occurrences remain `committed:false`, `postable:false`,
`physicalTransfer:not_applied`, `capacityReservation:incomplete` and
`taxLiability:incomplete`. Evaluator failures may retain coverage and bounds with
`economics:null`; source failures and collisions emit diagnostics only.

Authority: PFA-DET-022 §5.7/§5.11, PFA-INV-028, PFA-TAX-015. The new tests use
fictional evidence and independently authored exact-cent expected results from
the supported B3 scenarios. They cover source races, chronology, destination and
continuity, capacity/use, collisions/permutation, and compact 1/12/120 growth.
CI and the independent semantic audit remain external merge gates.
