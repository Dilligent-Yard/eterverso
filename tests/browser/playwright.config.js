'use strict';

const path = require('node:path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /\.spec\.js$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  outputDir: path.resolve(__dirname, '../../.local/test/browser-results'),
  use: {
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    ...(process.env.ETERVERSO_TEST_BROWSER_EXECUTABLE ? {
      launchOptions: { executablePath: process.env.ETERVERSO_TEST_BROWSER_EXECUTABLE },
    } : {}),
  },
});
