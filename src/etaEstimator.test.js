// Self-check: node src/etaEstimator.test.js  (run `npm run compile` first)
const assert = require("assert");
const { EtaEstimator, formatDuration } = require("../out/etaEstimator.js");

/** Drives the estimator on a fake clock: completions at given durations apart. */
function session(firstGap, durations, total) {
  let now = 0;
  const est = new EtaEstimator(() => now);
  est.update(0, total);
  now += firstGap;
  est.update(1, total); // startup interval — discarded by design
  let completed = 1;
  for (const d of durations) {
    now += d;
    est.update(++completed, total);
  }
  return { est, completed, at: (t) => (now = t), hold: (d) => (now += d) };
}

// --- nothing to go on ---------------------------------------------------
{
  const est = new EtaEstimator(() => 0);
  est.update(0, 10);
  assert.strictEqual(est.estimate(0, 10), undefined, "no completions => no estimate");
  assert.strictEqual(est.estimate(0, 0), undefined, "zero total => undefined");
}

// --- the startup interval must NOT become a sample ----------------------
// Regression: 30s of setup before task 1 was read as "one task took 30s",
// inflating the first ETA ~7x and polluting every later estimate.
{
  const s = session(30000, [], 10);
  assert.strictEqual(s.est.estimate(1, 10), undefined, "first completion yields no sample");

  const s2 = session(30000, [5000], 10);
  const e = s2.est.estimate(2, 10);
  assert.ok(Math.abs(e.ms - 8 * 5000) < 1, `expected 8x5s, got ${e.ms}`);
  assert.strictEqual(e.confidence, "rough", "one sample is a rough guess");
  assert.strictEqual(e.samples, 1);
}

// --- steady pace: accurate, and confidence climbs with evidence ---------
{
  const few = session(10000, [5000, 5000], 10);
  assert.strictEqual(few.est.estimate(3, 10).confidence, "rough", "2 samples is still rough");

  const s = session(10000, [5000, 5000, 5000], 10);
  const mid = s.est.estimate(4, 10);
  assert.ok(Math.abs(mid.ms - 6 * 5000) < 1, "steady 5s/task");
  assert.strictEqual(mid.confidence, "fair", "3 consistent samples => fair");

  const long = session(10000, [5000, 5000, 5000, 5000, 5000, 5000], 10);
  const late = long.est.estimate(7, 10);
  assert.strictEqual(late.confidence, "good", "5 consistent samples => good");
  assert.strictEqual(late.samples, 5, "window caps at 5");
  assert.ok(Math.abs(late.ms - 3 * 5000) < 1, "3 tasks left x 5s");
}

// --- one stalled task must not dominate (median, not mean) --------------
{
  const s = session(1000, [5000, 5000, 120000, 5000, 5000], 10);
  const e = s.est.estimate(6, 10);
  const perTask = e.ms / 4;
  assert.ok(perTask < 10000, `median ignores the 120s stall, got ${perTask}ms/task`);
  assert.strictEqual(e.confidence, "rough", "a wide spread is reported as rough");
}

// --- idle refreshes must not corrupt the measured pace ------------------
// The ETA itself SHOULD move as time passes (it counts down, then widens if
// the task overruns). What must not happen is a phantom sample being recorded.
{
  const s = session(5000, [5000, 5000], 10);
  const samplesBefore = s.est.estimate(3, 10).samples;
  s.hold(60000); s.est.update(3, 10);
  s.hold(99000); s.est.update(3, 10);
  const after = s.est.estimate(3, 10);
  assert.strictEqual(after.samples, samplesBefore, "idle pushes must not add samples");
  assert.ok(after.overdue, "159s idle on a 5s pace is an overrun");
}

// --- completion, and restart when the list shrinks ----------------------
{
  const s = session(1000, [2000], 5);
  s.est.update(5, 5);
  assert.strictEqual(s.est.estimate(5, 5).ms, 0, "all done => 0");

  s.hold(1000);
  s.est.update(1, 5); // list shrank => new session
  assert.strictEqual(s.est.estimate(1, 5), undefined, "restart clears samples");
}

// --- the estimate must decay in real time, not freeze at the last payload
{
  let now = 0;
  const est = new EtaEstimator(() => now);
  est.update(0, 10);
  now = 10000; est.update(1, 10);              // startup, discarded
  now = 15000; est.update(2, 10);              // sample: 5s
  now = 20000; est.update(3, 10);              // sample: 5s

  const atPayload = est.estimate(3, 10).ms;
  now = 22500;                                  // 2.5s into the current task
  const later = est.estimate(3, 10).ms;
  assert.ok(later < atPayload, "ETA must shrink as the current task runs");

  // A task running far past the average must widen the estimate, not keep
  // promising the old pace — the number the user saw frozen at "~30s left".
  now = 20000 + 8 * 60000;
  const stalled = est.estimate(3, 10);
  assert.ok(stalled.overdue, "overrun must be flagged");
  assert.strictEqual(stalled.confidence, "rough", "an overrun is never confident");
  assert.ok(stalled.ms > 8 * 60000, `stalled estimate must widen, got ${stalled.ms}ms`);
  assert.ok(est.overrunMs() > 7 * 60000, "overrun time is reported");

  // Once it completes, the estimate recovers instead of staying poisoned.
  now = 20000 + 9 * 60000; est.update(4, 10);
  now += 5000; est.update(5, 10);
  const recovered = est.estimate(5, 10);
  assert.strictEqual(recovered.overdue, false, "no longer overdue");
  assert.ok(recovered.ms < 2 * 60000, `median shrugs off the stall, got ${recovered.ms}ms`);
}

// --- formatting rounds to a precision the estimate actually supports ----
assert.strictEqual(formatDuration(4000), "<10s");
assert.strictEqual(formatDuration(47000), "45s");
assert.strictEqual(formatDuration(180000), "3m");
assert.strictEqual(formatDuration(3900000), "1h 5m");

console.log("etaEstimator: all assertions passed");
