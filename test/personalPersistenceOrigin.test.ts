import { describe, expect, it } from "vitest";
import { isPersonalPersistenceEnabledOrigin } from "../ui/persistence/indexedDbPersonalModelStore.js";

describe("personal persistence origin policy", () => {
  it.each([
    ["https:", "example.com", true],
    ["https:", "finance.example.com", true],
    ["https:", "owner.github.io", false],
    ["https:", "foo.github.io", false],
    ["http:", "127.0.0.1", true],
    ["http:", "localhost", true],
    ["http:", "[::1]", true],
    ["http:", "example.com", false],
  ])("%s//%s enabled=%s", (protocol, hostname, enabled) => {
    expect(isPersonalPersistenceEnabledOrigin({ protocol, hostname })).toBe(enabled);
  });
});
