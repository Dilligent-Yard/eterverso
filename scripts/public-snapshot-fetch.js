#!/usr/bin/env node
'use strict';

const { main } = require('./lib/public-snapshot');

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`public-snapshot-fetch: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
