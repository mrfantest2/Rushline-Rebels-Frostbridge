export function createTestClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    set: (value) => { current = value; return current; },
    advance: (ms) => { current += ms; return current; },
  };
}
