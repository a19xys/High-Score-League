function deriveDeveloperToolsEnabled(options = {}) {
  if (options.environment?.HSL_DEVELOPER_TOOLS === "1") return true;
  return options.isPackaged !== true;
}

async function runDeveloperOnlyOperation(enabled, operation) {
  if (enabled !== true) return { allowed: false, value: null };
  return { allowed: true, value: await operation() };
}

module.exports = {
  deriveDeveloperToolsEnabled,
  runDeveloperOnlyOperation,
};
