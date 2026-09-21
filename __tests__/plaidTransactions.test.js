const { fetchAllTransactions } = require("../utils/plaidTransactions");

// A fake Plaid client that serves `total` transactions in pages, honouring count/offset.
function makeFakeClient(total, { failWith } = {}) {
  const calls = [];
  const all = Array.from({ length: total }, (_, i) => ({ transaction_id: `t${i}` }));
  const errors = failWith ? [...failWith] : [];
  return {
    calls,
    transactionsGet: async (params) => {
      calls.push(params);
      if (errors.length) throw errors.shift();
      const { count, offset } = params.options;
      return { data: { transactions: all.slice(offset, offset + count), total_transactions: total } };
    },
  };
}

const notReady = () => Object.assign(new Error("not ready"), { response: { data: { error_code: "PRODUCT_NOT_READY" } } });
const args = { accessToken: "tok", startDate: "2026-08-01", endDate: "2026-08-30" };

describe("fetchAllTransactions", () => {
  test("fetches every page, not just the first", async () => {
    const client = makeFakeClient(5);
    const result = await fetchAllTransactions(client, { ...args, pageSize: 2 });
    expect(result).toHaveLength(5);
    expect(client.calls.map((c) => c.options.offset)).toEqual([0, 2, 4]);
    expect(client.calls[0].access_token).toBe("tok");
  });

  test("uses a single request when everything fits in one page", async () => {
    const client = makeFakeClient(3);
    const result = await fetchAllTransactions(client, { ...args, pageSize: 500 });
    expect(result).toHaveLength(3);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options.count).toBe(500);
  });

  test("returns an empty list when there are no transactions", async () => {
    const client = makeFakeClient(0);
    expect(await fetchAllTransactions(client, args)).toHaveLength(0);
    expect(client.calls).toHaveLength(1);
  });

  test("treats a response without total_transactions as a single page", async () => {
    let calls = 0;
    const client = { transactionsGet: async () => { calls++; return { data: { transactions: [{ transaction_id: "a" }] } }; } };
    const result = await fetchAllTransactions(client, args);
    expect(result).toHaveLength(1);
    expect(calls).toBe(1);
  });

  test("stops instead of looping forever if Plaid returns an empty page early", async () => {
    let calls = 0;
    const client = { transactionsGet: async () => { calls++; return { data: { transactions: [], total_transactions: 10 } }; } };
    const result = await fetchAllTransactions(client, args);
    expect(result).toHaveLength(0);
    expect(calls).toBe(1);
  });

  test("retries PRODUCT_NOT_READY and then succeeds", async () => {
    const client = makeFakeClient(2, { failWith: [notReady(), notReady()] });
    const result = await fetchAllTransactions(client, { ...args, retryDelayMs: 0 });
    expect(result).toHaveLength(2);
    expect(client.calls).toHaveLength(3); // 2 failures + 1 success
  });

  test("gives up after the retry limit and throws", async () => {
    const client = makeFakeClient(2, { failWith: [notReady(), notReady(), notReady()] });
    await expect(fetchAllTransactions(client, { ...args, retryDelayMs: 0, notReadyRetries: 2 })).rejects.toThrow("not ready");
    expect(client.calls).toHaveLength(3); // first try + 2 retries
  });

  test("does not retry other Plaid errors", async () => {
    const other = Object.assign(new Error("bad token"), { response: { data: { error_code: "INVALID_ACCESS_TOKEN" } } });
    const client = makeFakeClient(2, { failWith: [other] });
    await expect(fetchAllTransactions(client, { ...args, retryDelayMs: 0 })).rejects.toThrow("bad token");
    expect(client.calls).toHaveLength(1);
  });

  test("stops at maxPages as a safety limit", async () => {
    const client = makeFakeClient(100);
    const result = await fetchAllTransactions(client, { ...args, pageSize: 10, maxPages: 3 });
    expect(result).toHaveLength(30);
  });
});
