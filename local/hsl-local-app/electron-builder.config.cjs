const path = require("node:path");
const { readProductPublicConfig } = require("./src/product-config");

const appDir = __dirname;
const productConfig = readProductPublicConfig(path.join(appDir, "product-public-config.json"), {
  required: true,
});

module.exports = {
  appId: "com.highscoreleague.launcher",
  productName: "High Score League",
  asar: true,
  directories: {
    output: "dist",
  },
  files: [
    "gui/**/*",
    "src/**/*",
    "app.js",
    "mame-runtime-manifest.json",
    "package.json",
    "!**/*.map",
    "!test{,/**/*}",
    "!test-support{,/**/*}",
  ],
  extraMetadata: {
    hslProduct: productConfig,
  },
  extraResources: [
    {
      from: ".cache/mame/0.287/runtime",
      to: "mame/0.287",
      filter: ["**/*"],
    },
    {
      from: ".cache/product/hsl/mame-plugin/hsl-score",
      to: "hsl/mame-plugin/hsl-score",
      filter: ["**/*"],
    },
  ],
  win: {
    icon: "gui/renderer/assets/native/app-icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
    executableName: "High Score League",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "High Score League",
    uninstallDisplayName: "High Score League",
    deleteAppDataOnUninstall: false,
    artifactName: "High Score League Setup ${version}.${ext}",
  },
};
