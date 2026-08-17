const fs = require("node:fs");
const path = require("node:path");

const MUTABLE_DIRECTORY_OPTIONS = Object.freeze({
  cfg: "-cfg_directory",
  nvram: "-nvram_directory",
  input: "-input_directory",
  state: "-state_directory",
  snapshot: "-snapshot_directory",
  diff: "-diff_directory",
  comments: "-comment_directory",
  share: "-share_directory",
});

function resolveMameState(config = {}, options = {}) {
  if (!config.userDataDir) throw new Error("No se pudo resolver userDataDir para el estado mutable de MAME.");
  const root = path.join(config.userDataDir, "runtime", "mame", "state");
  const directories = {
    root,
    ini: options.runRoot ? path.join(options.runRoot, "ini") : path.join(root, "ini"),
    home: options.runRoot || path.join(root, "home"),
    cfg: path.join(root, "cfg"),
    nvram: path.join(root, "nvram"),
    input: path.join(root, "inp"),
    state: path.join(root, "sta"),
    snapshot: path.join(root, "snap"),
    diff: path.join(root, "diff"),
    comments: path.join(root, "comments"),
    share: path.join(root, "share"),
  };
  return directories;
}

function buildMameMutableArgs(directories, cfgDirectory = null) {
  const args = ["-inipath", directories.ini, "-homepath", directories.home];
  for (const [key, option] of Object.entries(MUTABLE_DIRECTORY_OPTIONS)) {
    args.push(option, key === "cfg" && cfgDirectory ? cfgDirectory : directories[key]);
  }
  return args;
}

function ensureMameStateDirectories(directories) {
  for (const directory of Object.values(directories || {})) {
    if (directory) fs.mkdirSync(directory, { recursive: true });
  }
}

function pathIsInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

module.exports = {
  MUTABLE_DIRECTORY_OPTIONS,
  buildMameMutableArgs,
  ensureMameStateDirectories,
  pathIsInside,
  resolveMameState,
};
