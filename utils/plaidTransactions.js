// Fetch ALL transactions in a date range from Plaid.
//
// Plaid's /transactions/get returns at most `count` transactions per call (default 100,
// max 500) and reports `total_transactions`. Without paging, anything beyond the first
// page is silently dropped. This helper pages with `offset` until everything is fetched.
//
// It also retries when Plaid answers PRODUCT_NOT_READY, which happens in the sandbox
// (and for real banks) for a few seconds right after an account is first linked.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPage(plaidClient, params, { notReadyRetries, retryDelayMs }) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await plaidClient.transactionsGet(params);
      return response.data;
    } catch (err) {
      const code = err.response && err.response.data && err.response.data.error_code;
      if (code === "PRODUCT_NOT_READY" && attempt < notReadyRetries) {
        await sleep(retryDelayMs);
        continue;
      }
      throw err;
    }
  }
}

async function fetchAllTransactions(
  plaidClient,
  { accessToken, startDate, endDate, pageSize = 500, maxPages = 50, notReadyRetries = 4, retryDelayMs = 2000 }
) {
  const all = [];
  let total = Infinity; // learned from the first response
  let pages = 0;

  while (all.length < total && pages < maxPages) {
    const data = await getPage(
      plaidClient,
      {
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: { count: pageSize, offset: all.length },
      },
      { notReadyRetries, retryDelayMs }
    );

    const batch = data.transactions || [];
    all.push(...batch);
    pages++;

    // If Plaid doesn't report a total, treat this as the only page.
    total = Number.isFinite(data.total_transactions) ? data.total_transactions : all.length;

    if (batch.length === 0) break; // safety: never loop on an empty page
  }

  return all;
}

module.exports = { fetchAllTransactions };
