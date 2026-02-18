/**
 * Creates a concurrency limiter that queues async operations and runs at most
 * `concurrency` of them in parallel.
 *
 * @param {number} concurrency - Maximum number of parallel operations
 * @returns {function} - A function that wraps an async fn and returns a promise
 */
export function createLimiter(concurrency) {
  let active = 0;
  const queue = [];

  function next() {
    if (queue.length === 0 || active >= concurrency) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        active--;
        next();
      });
  }

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}
