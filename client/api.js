(function (root) {
  'use strict';

  var modules = root.VaultModules || (typeof VaultModules !== 'undefined' ? VaultModules : null);
  if (!modules || !modules.api || typeof modules.api.createApi !== 'function') {
    throw new Error('Aetherverse API modules were not loaded before client/api.js.');
  }
  root.Aetherverse = Object.assign({}, root.Aetherverse, modules.api.createApi(root));
})(window);
