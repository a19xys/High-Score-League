const { runCli } = require("./src/cli");

runCli(process.argv).catch((error) => {
  console.error("");
  console.error("Error fatal:");
  console.error(error.message || error);
  console.error("");
  process.exitCode = 1;
});
