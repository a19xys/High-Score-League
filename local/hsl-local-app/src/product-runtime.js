const packageMetadata = require("../package.json");

const DEFAULT_CONTEXT = Object.freeze({
  appPath: null,
  isPackaged: false,
  productConfig: null,
  productName: "High Score League",
  resourcesPath: null,
  userDataDir: null,
  version: packageMetadata.version,
});

let context = DEFAULT_CONTEXT;

function configureProductRuntime(next = {}) {
  context = Object.freeze({
    ...DEFAULT_CONTEXT,
    ...next,
    appPath: next.appPath || null,
    isPackaged: next.isPackaged === true,
    productConfig: next.productConfig || null,
    resourcesPath: next.resourcesPath || null,
    userDataDir: next.userDataDir || null,
    version: next.version || packageMetadata.version,
  });
  return context;
}

function getProductRuntime() {
  return context;
}

function resetProductRuntime() {
  context = DEFAULT_CONTEXT;
}

module.exports = {
  configureProductRuntime,
  getProductRuntime,
  resetProductRuntime,
};
