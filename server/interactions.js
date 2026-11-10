'use strict';

// Compatibility adapter. The implementation lives in the typed island at
// src/node/interactions and is emitted to .generated/node/interactions.
const interactions = require('../.generated/node/interactions/index.js');

module.exports = {
  createInteractionsRouter: interactions.createInteractionsRouter,
  createNotification: interactions.createNotification,
  publicNotification: interactions.publicNotification,
  resolveTurnLikeTarget: interactions.resolveTurnLikeTarget,
  sceneScopedTurnKey: interactions.sceneScopedTurnKey,
  validateTurnId: interactions.validateTurnId,
};
