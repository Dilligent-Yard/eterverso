'use strict';

const path = require('node:path');
const { createPublicSnapshot } = require('../../.generated/node/public-snapshot/index.js');

// The typed capture modules live under `.generated`; the repository root is
// passed explicitly instead of being inferred from the emitted location.
module.exports = createPublicSnapshot({ repoRoot: path.resolve(__dirname, '..', '..') });
