import { describe, expect, it } from "vitest";
import {
  deletePersistedPersonalModel,
  exportPersonalModelJson,
  importPersonalModelJson,
  inspectPersistedPersonalModel,
  migratePersistedPersonalModel,
  readPersistedPersonalModelBackup,
  savePersonalModel,
  type PersonalModelPersistencePort,
} from "../src/application/index.js";
import { domainId } from "../src/identity/index.js";
import {
  CURRENT_MODEL_FORMAT_VERSION,
  ModelMigrationRegistry,
  type ModelMigration,
  type PortableModelEnvelope,
} from "../src/model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../src/model/version.js";

const MODEL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_MODEL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD_FORMAT = "0.1.5-persistence-test";

const document = (overrides: Record<string, unknown> = {}) => ({
  model_format_version: CURRENT_MODEL_FORMAT_VERSION,
  financial_specification_version: CURRENT_RUN_VERSIONS.financialSpecificationVersion,
  model_id: MODEL_ID,
  objects: {
    Account: [{ account_id: "synthetic-account", opening_balance: "not-yet-complete" }],
    FutureObjectCollection: [{ z: 2, a: { exact: "123.4500" } }],
  },
  ...overrides,
});

const json = (value: unknown) => JSON.stringify(value);
const model = (overrides: Record<string, unknown> = {}) =>
  importPersonalModelJson(json(document(overrides)));

class MemoryPort implements PersonalModelPersistencePort {
  value: string | undefined;
  failReplace = false;
  replaceCalls = 0;

  constructor(value?: string) {
    this.value = value;
  }

  async read() { return this.value; }
  async replace(value: string) {
    this.replaceCalls += 1;
    if (this.failReplace) throw new Error("synthetic write failure");
    this.value = value;
  }
  async remove() { this.value = undefined; }
}

const migration: ModelMigration = {
  migrationId: "test:persistence-old-to-current",
  sourceVersion: OLD_FORMAT,
  targetVersion: CURRENT_MODEL_FORMAT_VERSION,
  migrate: (source) => ({ ...source, model_format_version: CURRENT_MODEL_FORMAT_VERSION }),
};
const migrations = new ModelMigrationRegistry([migration]);

describe("personal persistence application policy", () => {
  it("saves exact deterministic portable bytes, including unknown collections and incomplete editor data", async () => {
    const draft = model();
    const port = new MemoryPort();
    const result = await savePersonalModel(port, draft);
    expect(result.status).toBe("saved");
    expect(port.value).toBe(exportPersonalModelJson(draft));
    expect(importPersonalModelJson(port.value!).objects.FutureObjectCollection).toEqual(
      draft.objects.FutureObjectCollection,
    );
  });

  it("distinguishes empty, ready, unsupported financial/model versions, legacy, and invalid data", async () => {
    expect((await inspectPersistedPersonalModel(new MemoryPort())).status).toBe("empty");
    expect((await inspectPersistedPersonalModel(new MemoryPort(exportPersonalModelJson(model())))).status).toBe("ready");
    expect((await inspectPersistedPersonalModel(new MemoryPort(json(document({
      financial_specification_version: "99.0.0-future",
    }))))).status).toBe("unsupported");
    expect((await inspectPersistedPersonalModel(new MemoryPort(json(document({
      model_format_version: "99.0.0-future",
    }))))).status).toBe("unsupported");
    expect((await inspectPersistedPersonalModel(new MemoryPort(json({
      specification_version: "0.1.0-draft",
      model_id: MODEL_ID,
      objects: {},
    })))).status).toBe("read_only_legacy");
    expect((await inspectPersistedPersonalModel(new MemoryPort("not json"))).status).toBe("invalid");
  });

  it("requires explicit migration and replaces only after validation, import, and a successful atomic write", async () => {
    const original = json(document({ model_format_version: OLD_FORMAT }));
    const port = new MemoryPort(original);
    expect((await inspectPersistedPersonalModel(port, migrations)).status).toBe("migration_required");
    expect(port.value).toBe(original);
    const migrated = await migratePersistedPersonalModel(port, migrations);
    expect(migrated.status).toBe("ready");
    expect(migrated.model.modelId).toBe(domainId("model", MODEL_ID));
    expect(port.value).toBe(migrated.serializedModel);
  });

  it("does not offer persisted format migration when the financial specification is unsupported", async () => {
    const original = json(document({
      model_format_version: OLD_FORMAT,
      financial_specification_version: "99.0.0-future",
    }));
    const port = new MemoryPort(original);

    expect((await inspectPersistedPersonalModel(port, migrations)).status).toBe("unsupported");
    expect(port.value).toBe(original);
    expect((await savePersonalModel(port, model(), { migrations })).status).toBe("recovery_required");
    expect(port.value).toBe(original);
    await expect(migratePersistedPersonalModel(port, migrations)).rejects.toThrow(
      "Saved model is not eligible for explicit migration",
    );
    expect(port.replaceCalls).toBe(0);
    expect(port.value).toBe(original);
  });

  it("classifies a structurally invalid migratable document as invalid", async () => {
    const original = json(document({ model_format_version: OLD_FORMAT, model_id: "invalid" }));
    const port = new MemoryPort(original);
    expect((await inspectPersistedPersonalModel(port, migrations)).status).toBe("invalid");
    expect(port.value).toBe(original);
    expect(port.replaceCalls).toBe(0);
  });

  it("preserves original bytes when migration output is invalid or replacement rejects", async () => {
    const original = json(document({ model_format_version: OLD_FORMAT }));
    const invalidMigrations = new ModelMigrationRegistry([{
      ...migration,
      migrate: (source) => ({ ...source, model_format_version: CURRENT_MODEL_FORMAT_VERSION, model_id: "invalid" }),
    }]);
    const invalidPort = new MemoryPort(original);
    await expect(migratePersistedPersonalModel(invalidPort, invalidMigrations)).rejects.toThrow();
    expect(invalidPort.value).toBe(original);

    const failingPort = new MemoryPort(original);
    failingPort.failReplace = true;
    await expect(migratePersistedPersonalModel(failingPort, migrations)).rejects.toThrow("synthetic write failure");
    expect(failingPort.value).toBe(original);
  });

  it("requires confirmation before replacing a different loadable model", async () => {
    const first = model();
    const second = model({ model_id: OTHER_MODEL_ID });
    const port = new MemoryPort(exportPersonalModelJson(first));
    expect((await savePersonalModel(port, second)).status).toBe("different_model_confirmation_required");
    expect(port.value).toBe(exportPersonalModelJson(first));
    expect((await savePersonalModel(port, second, { confirmDifferentModel: true })).status).toBe("saved");
    expect(port.value).toBe(exportPersonalModelJson(second));
  });

  it("protects incompatible recovery bytes from normal Save and exposes them exactly for backup", async () => {
    const cases = [
      { bytes: "not json" },
      { bytes: json(document({ model_format_version: "99.0.0-future" })) },
      { bytes: json({ specification_version: "0.1.0-draft", model_id: MODEL_ID, objects: {} }) },
      { bytes: json(document({ model_format_version: OLD_FORMAT })), migrations },
    ];
    for (const { bytes: protectedBytes, migrations: registry } of cases) {
      const port = new MemoryPort(protectedBytes);
      expect((await savePersonalModel(port, model(), registry ? { migrations: registry } : {})).status).toBe("recovery_required");
      expect(port.value).toBe(protectedBytes);
      expect(await readPersistedPersonalModelBackup(port)).toBe(protectedBytes);
    }
  });

  it("does not change a prior value when replace fails and deletes only persisted bytes", async () => {
    const previous = exportPersonalModelJson(model());
    const port = new MemoryPort(previous);
    port.failReplace = true;
    const changed = {
      ...model(),
      objects: { ...model().objects, Extra: [{ synthetic: true }] },
    } as PortableModelEnvelope;
    await expect(savePersonalModel(port, changed)).rejects.toThrow("synthetic write failure");
    expect(port.value).toBe(previous);
    port.failReplace = false;
    await deletePersistedPersonalModel(port);
    expect(await inspectPersistedPersonalModel(port)).toEqual({ status: "empty" });
  });
});
