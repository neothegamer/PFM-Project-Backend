const { getInstitutionName, isPlaceholderBankName } = require("../utils/plaidInstitution");

// Fake Plaid client. `item` is what /item/get returns; `byId` is what /institutions/get_by_id returns.
function makeClient({ item, byId, itemError, byIdError } = {}) {
  const calls = { itemGet: 0, institutionsGetById: [] };
  return {
    calls,
    itemGet: async () => {
      calls.itemGet++;
      if (itemError) throw itemError;
      return { data: { item } };
    },
    institutionsGetById: async (params) => {
      calls.institutionsGetById.push(params);
      if (byIdError) throw byIdError;
      return { data: byId };
    },
  };
}

// The helper logs a warning on failure; keep the test output clean.
async function quietly(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

describe("getInstitutionName", () => {
  test("uses the name on the item when Plaid provides one, without a second lookup", async () => {
    const client = makeClient({ item: { institution_id: "ins_1", institution_name: "Chase" } });
    expect(await getInstitutionName(client, "tok")).toBe("Chase");
    expect(client.calls.institutionsGetById).toHaveLength(0);
  });

  test("looks the name up by institution id when the item has no name", async () => {
    const client = makeClient({ item: { institution_id: "ins_109508" }, byId: { institution: { name: "First Platypus Bank" } } });
    expect(await getInstitutionName(client, "tok")).toBe("First Platypus Bank");
    expect(client.calls.institutionsGetById).toEqual([{ institution_id: "ins_109508", country_codes: ["US"] }]);
  });

  test("passes custom country codes to the lookup", async () => {
    const client = makeClient({ item: { institution_id: "ins_1" }, byId: { institution: { name: "Some Bank" } } });
    await getInstitutionName(client, "tok", ["US", "CA"]);
    expect(client.calls.institutionsGetById[0].country_codes).toEqual(["US", "CA"]);
  });

  test("returns null when the item has neither a name nor an id", async () => {
    const client = makeClient({ item: {} });
    expect(await getInstitutionName(client, "tok")).toBeNull();
    expect(client.calls.institutionsGetById).toHaveLength(0);
  });

  test("returns null (does not throw) when /item/get fails", async () => {
    const client = makeClient({ itemError: new Error("boom") });
    expect(await quietly(() => getInstitutionName(client, "tok"))).toBeNull();
  });

  test("returns null (does not throw) when the by-id lookup fails", async () => {
    const client = makeClient({ item: { institution_id: "ins_1" }, byIdError: new Error("boom") });
    expect(await quietly(() => getInstitutionName(client, "tok"))).toBeNull();
  });

  test("returns null when the lookup response has no name", async () => {
    const client = makeClient({ item: { institution_id: "ins_1" }, byId: { institution: {} } });
    expect(await getInstitutionName(client, "tok")).toBeNull();
  });
});

describe("isPlaceholderBankName", () => {
  test.each([
    [undefined, true],
    [null, true],
    ["", true],
    ["Connected Bank", true],
    ["ins_109508", true],
    ["Chase", false],
    ["First Platypus Bank", false],
    ["Instant Bank", false],
  ])("%s -> %s", (name, expected) => {
    expect(isPlaceholderBankName(name)).toBe(expected);
  });
});
