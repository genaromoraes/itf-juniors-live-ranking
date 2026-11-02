import test from "node:test";
import assert from "node:assert/strict";
import { fetchCalendarAttempt } from "../scripts/04_fetch_week_tournaments.mjs";
import { fetchResultsAttempt } from "../scripts/05_fetch_week_results.mjs";

test("uses a direct calendar request after a browser network failure", async () => {
  const valid = { ok: true, status: 200, json: { items: [] } };
  const result = await fetchCalendarAttempt({}, "https://example.test/calendar", {
    browserFetch: async () => ({ status: 0, timedOut: false }),
    directFetch: async () => valid,
  });
  assert.equal(result, valid);
});

test("does not switch transports after an ITF challenge", async () => {
  const blocked = { ok: false, status: 403, contentType: "text/html", json: null };
  let directCalled = false;
  const result = await fetchCalendarAttempt({}, "https://example.test/calendar", {
    browserFetch: async () => blocked,
    directFetch: async () => { directCalled = true; },
  });
  assert.equal(result, blocked);
  assert.equal(directCalled, false);
});

test("does not treat a failed direct response as valid", async () => {
  const blocked = { ok: false, status: 200, contentType: "text/html", json: null };
  const result = await fetchCalendarAttempt({}, "https://example.test/calendar", {
    browserFetch: async () => ({ status: 0, timedOut: false }),
    directFetch: async () => blocked,
  });
  assert.equal(result, blocked);
  assert.equal(result.json, null);
});

test("retries event network failures directly and preserves request options", async () => {
  const expected = { ok: true, status: 200, json: { filters: [] } };
  const options = { method: "GET" };
  const result = await fetchResultsAttempt({}, "https://example.test/event", options, {
    mode: "browser",
    browserFetch: async () => ({ status: 0, timedOut: false }),
    directFetch: async (url, received) => {
      assert.equal(url, "https://example.test/event");
      assert.equal(received, options);
      return expected;
    },
  });
  assert.equal(result, expected);
});

test("does not retry an event challenge directly", async () => {
  const blocked = { ok: false, status: 200, contentType: "text/html", json: null };
  let directCalled = false;
  const result = await fetchResultsAttempt({}, "https://example.test/event", {}, {
    mode: "browser",
    browserFetch: async () => blocked,
    directFetch: async () => { directCalled = true; },
  });
  assert.equal(result, blocked);
  assert.equal(directCalled, false);
});
