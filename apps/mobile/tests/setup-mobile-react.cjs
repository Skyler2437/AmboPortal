const Module = require('node:module');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const mobileReact = require.resolve('react', { paths: [mobileRoot] });
const resolveFilename = Module._resolveFilename;

// The web and mobile workspaces intentionally use different React majors. The
// renderer is hoisted by npm, so route its internal peer import back through
// the mobile workspace instead of allowing it to pick up the web React copy.
Module._resolveFilename = function resolveMobileReact(request, parent, isMain, options) {
  if (request === 'react') return mobileReact;
  return resolveFilename.call(this, request, parent, isMain, options);
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
