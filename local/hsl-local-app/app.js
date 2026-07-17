const { runCli } = require("./src/cli");
const { shutdownAccountSessionRepositories } = require("./src/auth");

let signalDrainStarted = false;
const drainForSignal = (signal) => {
  if (signalDrainStarted) return;
  signalDrainStarted = true;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  shutdownAccountSessionRepositories({ reason: signal.toLowerCase(), timeoutMs: 2000 }).catch(() => {});
};
const onSigint = () => drainForSignal("SIGINT");
const onSigterm = () => drainForSignal("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

runCli(process.argv).catch((error) => {
  console.error("");
  console.error("Error fatal:");
  console.error(error.message || error);
  console.error("");
  process.exitCode = 1;
}).finally(async () => {
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  await shutdownAccountSessionRepositories({ reason: "cli-complete", timeoutMs: 2000 }).catch(() => {});
});
