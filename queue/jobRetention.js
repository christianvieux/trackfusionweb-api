export const ACTIVE_JOB_RETENTION = Object.freeze({
  removeOnComplete: Object.freeze({
    age: 24 * 60 * 60,
    count: 1_000,
  }),
  removeOnFail: Object.freeze({
    age: 30 * 24 * 60 * 60,
    count: 5_000,
  }),
});

export function withActiveJobRetention(options = {}) {
  return {
    ...options,
    removeOnComplete: { ...ACTIVE_JOB_RETENTION.removeOnComplete },
    removeOnFail: { ...ACTIVE_JOB_RETENTION.removeOnFail },
  };
}
