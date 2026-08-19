const path = require("node:path");
const { readMameRuntimeManifest } = require("./src/mame-runtime-manifest");
const { readProductPublicConfig } = require("./src/product-config");

const appDir = __dirname;
const mameRuntime = readMameRuntimeManifest(path.join(appDir, "mame-runtime-manifest.json"));
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
      from: path.join(".cache", "product", "mame", mameRuntime.version, "runtime"),
      to: path.posix.join("mame", mameRuntime.version),
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
    include: "build/installer.nsh",
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
  publish: [
    {
      provider: "github",
      owner: "a19xys",
      repo: "High-Score-League",
      channel: "latest",
      private: false,
    },
  ],
};
