"use strict";

// {{slug}} — {{summary}}
// The work is a pure function: records in, a summary out, no I/O. That keeps the automation
// deterministic and unit-testable (test/pipeline.test.js); the runner (index.js) is the only
// part that touches the outside world. Replace `process` with your real transform/filter.

/**
 * Process a batch of records into a result summary. Pure: no I/O, no clock, no globals.
 * @param {Array<object>} records
 * @returns {{ processed: number, kept: number, items: Array<object> }}
 */
function process(records = []) {
  const items = records.filter((record) => record && record.active);
  return { processed: records.length, kept: items.length, items };
}

module.exports = { process };
