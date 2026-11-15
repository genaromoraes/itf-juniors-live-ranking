import test from "node:test";
import assert from "node:assert/strict";
import { fetchCandidateBreakdown } from "../scripts/lib/player_breakdown.mjs";

test("recovers browser network failures through the direct request", async () => {
  const expected = { ok: true, status: 200, json: { countable: [] } };
  const result = await fetchCandidateBreakdown({}, "https://example.test", 10, {
    browserFetch: async () => ({ status: 0, timedOut: false }),
    directFetch: async () => expected,
  });
  assert.equal(result, expected);
});

test("does not bypass an ITF challenge", async () => {
  const blocked = { status: 200, contentType: "text/html", json: null };
  let directCalled = false;
  const result = await fetchCandidateBreakdown({}, "https://example.test", 10, {
    browserFetch: async () => blocked,
    directFetch: async () => { directCalled = true; },
  });
  assert.equal(result, blocked);
  assert.equal(directCalled, false);
});

test("retries transient failures, without accepting incomplete data", async () => {
  let attempts = 0;
  const expected = { ok: true, status: 200, json: { countable: [] } };
  const result = await fetchCandidateBreakdown({}, "https://example.test", 10, {
    browserFetch: async () => (++attempts === 3 ? expected : { status: 503 }),
    wait: async () => {},
  });
  assert.equal(result, expected);
  assert.equal(attempts, 3);
});
