const { authStatus, authToken, login, logout } = require("./auth");
const { loadConfig } = require("./config");
const { diagnose } = require("./diagnose");
const { scanBox, showOne, watchPending } = require("./event-files");
const { markFailed, markSent, restoreToPending } = require("./file-queue");
const { launchMame } = require("./mame-launcher");
const { printHelp } = require("./output");
const { submitAll, submitOne } = require("./submission-service");

async function runCli(argv = process.argv) {
  const config = loadConfig();
  const command = argv[2] || "scan";

  if (command === "scan") {
    await scanBox(config, argv[3] || "pending");
    return;
  }

  if (command === "show") {
    await showOne(config, argv[3], argv[4] || "pending");
    return;
  }

  if (command === "watch") {
    await watchPending(config);
    return;
  }

  if (command === "mark-sent") {
    await markSent(config, argv[3]);
    return;
  }

  if (command === "mark-failed") {
    const reason = argv.slice(4).join(" ");
    await markFailed(config, argv[3], reason);
    return;
  }

  if (command === "restore") {
    await restoreToPending(config, argv[3], argv[4]);
    return;
  }

  if (command === "login") {
    await login(config, argv[3]);
    return;
  }

  if (command === "auth-status") {
    await authStatus(config);
    return;
  }

  if (command === "auth-token") {
    await authToken(config);
    return;
  }

  if (command === "logout") {
    await logout(config);
    return;
  }

  if (command === "submit") {
    await submitOne(config, argv[3]);
    return;
  }

  if (command === "submit-all") {
    await submitAll(config);
    return;
  }

  if (command === "diagnose") {
    await diagnose(config);
    return;
  }

  if (command === "play") {
    process.exitCode = await launchMame(config, argv[3], "competition");
    return;
  }

  if (command === "practice") {
    process.exitCode = await launchMame(config, argv[3], "practice");
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  console.error(`Comando desconocido: ${command}`);
  printHelp();
  process.exitCode = 1;
}

module.exports = {
  runCli,
};
