import {
  ACTIVE_JOB_RETENTION,
  withActiveJobRetention,
} from "./jobRetention.js";

test("keeps completed jobs through the client polling window with a count cap", () => {
  expect(ACTIVE_JOB_RETENTION.removeOnComplete).toEqual({
    age: 86_400,
    count: 1_000,
  });
});

test("retains longer failure diagnostics while still bounding Redis growth", () => {
  expect(ACTIVE_JOB_RETENTION.removeOnFail).toEqual({
    age: 2_592_000,
    count: 5_000,
  });
});

test("combines retention with producer-specific retry options", () => {
  expect(withActiveJobRetention({ attempts: 3 })).toEqual({
    attempts: 3,
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 2_592_000, count: 5_000 },
  });
});
