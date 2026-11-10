'use strict';

const path = require('node:path');
const timeline = require('../.generated/node/timeline/index.js');

// The seed file stays at the repository-root server directory. The typed
// implementation receives the root explicitly instead of deriving it from its
// emitted location.
function seedTimelineIfEmpty(sql) {
  return timeline.seedTimelineIfEmpty(sql, { repoRoot: path.resolve(__dirname, '..') });
}

module.exports = {
  createTimelineRouter: timeline.createTimelineRouter,
  ensureTimelineSchema: timeline.ensureTimelineSchema,
  seedTimelineIfEmpty,
  publicTimelineEvent: timeline.publicTimelineEvent,
};
