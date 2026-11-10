'use strict';

const path = require('node:path');
const { createPublicSandboxLifecycle } = require('../.generated/node/public-sandbox/lifecycle/index.js');

const lifecycle = createPublicSandboxLifecycle({ repoRoot: path.resolve(__dirname, '..') });

if (require.main === module) {
  lifecycle.main().catch((error) => {
    process.stderr.write(`${error && error.safeToPrint
      ? error.message
      : 'Public sandbox lifecycle failed; database details, credentials and content are withheld.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = lifecycle;
