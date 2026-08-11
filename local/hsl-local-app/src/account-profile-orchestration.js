async function runAccountMutationWithProfileRefresh(options = {}) {
  const result = await options.operation();
  if (!result?.ok) return result;

  try {
    Promise.resolve(options.requestProfileSync(options.trigger, { force: true })).catch(() => {});
  } catch {}

  return result;
}

module.exports = {
  runAccountMutationWithProfileRefresh,
};
