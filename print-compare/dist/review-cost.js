// Standard GPT-4.1 USD rates per million tokens, verified 2026-11-01.
// https://developers.openai.com/api/docs/models/gpt-4.1
export const USD_PER_AUD = 0.70;
export const COST_NOTE = 'Fixed exchange rate: US$0.70 = A$1.00. Estimate for returned AI requests in the current reports only; excludes hosting, taxes, previous regenerated reports and requests whose usage was not returned.';
export function estimateReviewCost(model, usage) {
  const valid = n => Number.isSafeInteger(n) && n >= 0;
  const input = usage?.input_tokens, output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  if (!/^gpt-4\.1(?:-2025-04-14)?$/.test(model) || !valid(input) || !valid(output) || !valid(cached) || cached > input) return null;
  const usd = ((input - cached) * 2 + cached * 0.5 + output * 8) / 1_000_000;
  return { usd, aud: usd / USD_PER_AUD, pricedRequests: 1, unpricedRequests: 0, inputTokens: input, cachedTokens: cached, outputTokens: output };
}
export function sumReviewCosts(costs) {
  return costs.reduce((sum, cost) => {
    if (!cost) { sum.unpricedRequests++; return sum; }
    for (const key of Object.keys(sum)) sum[key] += cost[key] ?? 0;
    return sum;
  }, { usd: 0, aud: 0, pricedRequests: 0, unpricedRequests: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 });
}
export function costLabel(cost) {
  if (!cost?.pricedRequests) return 'Estimated AI cost (AUD): unavailable';
  const amount = `A$${cost.aud.toFixed(cost.aud < 0.01 ? 4 : 2)}`;
  return `Estimated AI cost (AUD): ${amount}${cost.unpricedRequests ? ' (partial; some request costs unavailable)' : ''}`;
}
