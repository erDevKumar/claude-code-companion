// Self-check: node src/etaEstimator.test.js  (run `npm run compile` first)
const assert = require("assert");
const { EtaEstimator, formatDuration } = require("../out/etaEstimator.js");

let now = 0;
const est = new EtaEstimator(() => now);

// No samples yet -> not estimable, but must not throw.
est.update(0, 10);
assert.strictEqual(est.remainingMs(0, 10), undefined, "no sample => undefined");

// Steady 1000ms per task.
for (let i = 1; i <= 4; i++) { now += 1000; est.update(i, 10); }
const eta = est.remainingMs(4, 10);
assert.ok(Math.abs(eta - 6000) < 500, `steady rate => ~6000ms, got ${eta}`);

// Repeated pushes with no progress must not decay the estimate.
const before = est.remainingMs(4, 10);
now += 5000; est.update(4, 10);
now += 5000; est.update(4, 10);
assert.strictEqual(est.remainingMs(4, 10), before, "idle pushes must not change EMA");

// Sudden completion.
now += 1000; est.update(10, 10);
assert.strictEqual(est.remainingMs(10, 10), 0, "all done => 0");

// Zero tasks / restart.
assert.strictEqual(est.remainingMs(0, 0), undefined, "zero total => undefined");
const e2 = new EtaEstimator(() => now);
e2.update(5, 10); now += 1000; e2.update(2, 10);  // list shrank
assert.strictEqual(e2.remainingMs(2, 10), undefined, "restart rebaselines");

assert.strictEqual(formatDuration(45000), "45s");
assert.strictEqual(formatDuration(180000), "3m");
assert.strictEqual(formatDuration(3900000), "1h 5m");

console.log("etaEstimator: all assertions passed");
