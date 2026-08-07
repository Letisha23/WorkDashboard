const assert = require('node:assert/strict');
const { createSelectionGuard } = require('../client-state.js');

const guard = createSelectionGuard();
const firstVersion = guard.activate('client-a');
assert.equal(firstVersion, 1);
assert.equal(guard.getActiveClientId(), 'client-a');
assert.equal(guard.isCurrent('client-a', firstVersion), true);
assert.equal(guard.isCurrent('client-b', firstVersion), false);

const secondVersion = guard.activate('client-b');
assert.equal(secondVersion, 2);
assert.equal(guard.isCurrent('client-a', firstVersion), false);
assert.equal(guard.isCurrent('client-b', secondVersion), true);

console.log('Selection guard regression test passed.');
