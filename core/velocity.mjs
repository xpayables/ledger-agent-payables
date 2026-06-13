// Sliding request-count window used before payment settlement.
export function createVelocityWindow({ maxRequestsPerMinute }) {
  const timestamps = [];

  function prune(now) {
    const cutoff = now - 60_000;
    while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift();
  }

  return {
    tryConsume(now = Date.now()) {
      prune(now);
      if (timestamps.length >= maxRequestsPerMinute) return false;
      timestamps.push(now);
      return true;
    },

    count(now = Date.now()) {
      prune(now);
      return timestamps.length;
    },
  };
}
