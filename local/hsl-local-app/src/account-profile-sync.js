const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { readKnownAccounts, updateKnownAccountProfile } = require("./account-store");
const { resolveCanonicalSessionResult } = require("./auth");
const { executeRemoteRequest } = require("./remote-request");
const { derivePlayerKey } = require("./scoped-queue");
const { isSessionRemoteUsable } = require("./session-result");

const AVATAR_BUCKET = "hsl-public-media";
const DEFAULT_PROFILE_FRESH_MS = 5 * 60 * 1000;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function profileHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function resolveCachePath(config, relativePath) {
  if (!config?.userDataDir || typeof relativePath !== "string" || !relativePath.trim()) return null;
  const root = path.resolve(config.userDataDir, "accounts", "avatars");
  const candidate = path.resolve(config.userDataDir, relativePath);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function validateStoragePath(storagePath, userId) {
  if (typeof storagePath !== "string" || typeof userId !== "string") return false;
  return new RegExp(`^avatars/${userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${UUID_PATTERN}\\.webp$`).test(storagePath);
}

function safeLegacyAvatarUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|224\.|255\.)/.test(host)) return null;
    const match172 = host.match(/^172\.(\d+)\./);
    if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return null;
    if (["::", "::1"].includes(host) || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return null;
    return url;
  } catch {
    return null;
  }
}

function detectImage(buffer, contentType = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const type = String(contentType).split(";", 1)[0].trim().toLowerCase();
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return !type || ["image/webp", "application/octet-stream"].includes(type) ? { extension: "webp", type: "image/webp" } : null;
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return !type || type === "image/png" ? { extension: "png", type: "image/png" } : null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    return !type || ["image/jpeg", "image/jpg"].includes(type) ? { extension: "jpg", type: "image/jpeg" } : null;
  }
  return null;
}

function normalizeProfile(row = {}) {
  const value = (key) => typeof row[key] === "string" && row[key].trim() ? row[key].trim() : null;
  return {
    avatarStoragePath: value("avatar_storage_path"),
    avatarUrl: value("avatar_url"),
    id: value("id"),
    initials: value("initials")?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null,
    username: value("username"),
  };
}

async function downloadLegacyAvatar(url, requestOptions) {
  let current = safeLegacyAvatarUrl(url);
  if (!current) return { ok: false, reason: "legacy-url-rejected" };
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const result = await executeRemoteRequest({
      ...requestOptions,
      redirect: "manual",
      responseType: "arrayBuffer",
      url: current.href,
    });
    if (!result.ok) return result;
    if ([301, 302, 303, 307, 308].includes(result.httpStatus)) {
      if (redirectCount === 3) return { ok: false, reason: "redirect-limit" };
      const location = result.response.headers?.get?.("location");
      current = safeLegacyAvatarUrl(new URL(location, current).href);
      if (!current) return { ok: false, reason: "redirect-rejected" };
      continue;
    }
    return result;
  }
  return { ok: false, reason: "redirect-limit" };
}

function createAccountProfileSync(options = {}) {
  const configProvider = options.configProvider || (() => options.config || {});
  const fetchImpl = options.fetchImpl || fetch;
  const getConnectivityState = options.getConnectivityState || (() => ({ reachability: "offline" }));
  const readAccounts = options.readKnownAccountsImpl || readKnownAccounts;
  const resolveSession = options.resolveSessionResultImpl || resolveCanonicalSessionResult;
  const updateProfile = options.updateKnownAccountProfileImpl || updateKnownAccountProfile;
  const now = options.now || Date.now;
  const diagnostics = {
    cacheCleanupFailed: 0, cancelled: 0, downloadFailed: 0, downloaded: 0, failed: 0,
    invalidStoragePath: 0, lastReason: null, lastRunAt: null, legacyUrlRejected: 0,
    profilesQueried: 0, profilesReturned: 0, removed: 0, skippedFresh: 0,
    skippedNoSession: 0, skippedOffline: 0, unchanged: 0,
  };
  let active = null;
  let epoch = 0;
  let lastCompletedAt = 0;

  async function removeFile(filePath, diagnoseFailure = false) {
    if (!filePath) return;
    await fsp.rm(filePath, { force: true }).catch(() => {
      if (diagnoseFailure) diagnostics.cacheCleanupFailed += 1;
    });
  }

  async function downloadAvatar(profile, account, config, token, signal) {
    const source = profile.avatarStoragePath ? `storage:${profile.avatarStoragePath}` : `legacy:${profile.avatarUrl}`;
    const identity = profileHash(source);
    const oldAbsolute = resolveCachePath(config, account.avatarCachePath);
    if (account.avatarCacheIdentity === identity && oldAbsolute) {
      try {
        if ((await fsp.stat(oldAbsolute)).isFile()) return { identity, relativePath: account.avatarCachePath, unchanged: true };
      } catch {}
    }
    const requestOptions = {
      fetchImpl,
      init: { headers: profile.avatarStoragePath ? { apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` } : {} },
      maxResponseBytes: MAX_AVATAR_BYTES,
      signal,
      timeoutMs: 15000,
    };
    let result;
    if (profile.avatarStoragePath) {
      const encodedPath = profile.avatarStoragePath.split("/").map(encodeURIComponent).join("/");
      result = await executeRemoteRequest({
        ...requestOptions,
        responseType: "arrayBuffer",
        url: `${String(config.supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/${encodedPath}`,
      });
    } else {
      result = await downloadLegacyAvatar(profile.avatarUrl, requestOptions);
    }
    if (!result.ok || result.httpStatus < 200 || result.httpStatus >= 300) return { failed: true, reason: result.reason || `http-${result.httpStatus}` };
    if (signal.aborted) throw Object.assign(new Error("avatar-download-cancelled"), { name: "AbortError" });
    const image = detectImage(result.bodyBuffer, result.response.headers?.get?.("content-type"));
    if (!image || (profile.avatarStoragePath && image.extension !== "webp")) return { failed: true, reason: "invalid-image" };
    const userKey = derivePlayerKey({ hasSession: true, userId: account.userId });
    const directory = path.join(config.userDataDir, "accounts", "avatars", userKey);
    const fileName = `${identity}.${image.extension}`;
    const absolutePath = path.join(directory, fileName);
    const tempPath = path.join(directory, `.${fileName}.${crypto.randomUUID()}.tmp`);
    await fsp.mkdir(directory, { recursive: true });
    try {
      await fsp.writeFile(tempPath, result.bodyBuffer, { flag: "wx" });
      if (signal.aborted) throw Object.assign(new Error("avatar-write-cancelled"), { name: "AbortError" });
      await fsp.rename(tempPath, absolutePath);
    } finally {
      await removeFile(tempPath, true);
    }
    return {
      identity,
      absolutePath,
      oldAbsolute: oldAbsolute && oldAbsolute !== absolutePath ? oldAbsolute : null,
      relativePath: path.relative(config.userDataDir, absolutePath),
    };
  }

  async function run(trigger, requestOptions = {}, owner) {
    const { controller, runId } = owner;
    const config = configProvider();
    diagnostics.lastReason = trigger;
    diagnostics.lastRunAt = new Date(now()).toISOString();
    if (getConnectivityState()?.reachability !== "connected") {
      diagnostics.skippedOffline += 1;
      return { attempted: false, reason: "offline" };
    }
    if (!requestOptions.force && lastCompletedAt && now() - lastCompletedAt < (options.freshMs || DEFAULT_PROFILE_FRESH_MS)) {
      diagnostics.skippedFresh += 1;
      return { attempted: false, reason: "fresh" };
    }
    const store = await readAccounts(config);
    const activeUserId = store.lastActiveUserId;
    if (!activeUserId || store.accounts.length === 0) {
      diagnostics.skippedNoSession += 1;
      return { attempted: false, reason: "no-account" };
    }
    const sessionResult = await resolveSession(config, { connected: true, signal: controller.signal, userId: activeUserId });
    const token = sessionResult.storedSession?.session?.access_token;
    if (!token || !isSessionRemoteUsable(sessionResult)) {
      diagnostics.skippedNoSession += 1;
      return { attempted: false, reason: "no-session" };
    }
    const ids = store.accounts.map((account) => account.userId).filter(Boolean);
    const select = "id,username,initials,avatar_url,avatar_storage_path";
    const queryIds = ids.map((id) => `\"${String(id).replace(/[\"\\]/g, "")}\"`).join(",");
    const result = await executeRemoteRequest({
      fetchImpl,
      init: { headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}`, Accept: "application/json" } },
      signal: controller.signal,
      timeoutMs: 15000,
      url: `${String(config.supabaseUrl).replace(/\/$/, "")}/rest/v1/profiles?select=${encodeURIComponent(select)}&id=in.(${encodeURIComponent(queryIds)})`,
    });
    diagnostics.profilesQueried += 1;
    if (!result.ok || result.httpStatus < 200 || result.httpStatus >= 300) throw Object.assign(new Error("profile-query-failed"), { code: result.reason || `HTTP_${result.httpStatus}` });
    const rows = JSON.parse(result.bodyText || "[]").map(normalizeProfile).filter((row) => row.id && ids.includes(row.id));
    diagnostics.profilesReturned += rows.length;
    const byId = new Map(rows.map((row) => [row.id, row]));
    let changed = false;
    for (const account of store.accounts) {
      if (controller.signal.aborted || runId !== epoch) break;
      const profile = byId.get(account.userId);
      if (!profile) continue;
      const presentation = { initials: profile.initials, username: profile.username };
      const presentationChanged = account.initials !== presentation.initials || account.username !== presentation.username;
      if (profile.avatarStoragePath && !validateStoragePath(profile.avatarStoragePath, account.userId)) {
        diagnostics.failed += 1;
        diagnostics.invalidStoragePath += 1;
        await updateProfile(config, account.userId, presentation);
        changed ||= presentationChanged;
        continue;
      }
      if (!profile.avatarStoragePath && !profile.avatarUrl) {
        await updateProfile(config, account.userId, {
          ...presentation, avatarCacheIdentity: null, avatarCachePath: null, avatarStoragePath: null, avatarUrl: null,
        });
        changed ||= presentationChanged || Boolean(account.avatarCacheIdentity || account.avatarCachePath || account.avatarStoragePath || account.avatarUrl);
        const old = resolveCachePath(config, account.avatarCachePath);
        await removeFile(old, true);
        diagnostics.removed += Boolean(old) ? 1 : 0;
        continue;
      }
      const avatar = await downloadAvatar(profile, account, config, token, controller.signal);
      if (avatar.failed) {
        diagnostics.failed += 1;
        diagnostics.downloadFailed += 1;
        if (["legacy-url-rejected", "redirect-rejected"].includes(avatar.reason)) diagnostics.legacyUrlRejected += 1;
        await updateProfile(config, account.userId, presentation);
        changed ||= presentationChanged;
        continue;
      }
      if (avatar.unchanged) diagnostics.unchanged += 1;
      else diagnostics.downloaded += 1;
      if (controller.signal.aborted || runId !== epoch) {
        if (!avatar.unchanged) await removeFile(avatar.absolutePath, true);
        throw Object.assign(new Error("profile-sync-cancelled"), { name: "AbortError" });
      }
      try {
        await updateProfile(config, account.userId, {
          ...presentation,
          avatarCacheIdentity: avatar.identity,
          avatarCachePath: avatar.relativePath,
          avatarStoragePath: profile.avatarStoragePath,
          avatarUrl: profile.avatarStoragePath ? null : profile.avatarUrl,
        });
      } catch (error) {
        if (!avatar.unchanged) await removeFile(avatar.absolutePath, true);
        throw error;
      }
      changed ||= presentationChanged || !avatar.unchanged;
      await removeFile(avatar.oldAbsolute, true);
    }
    if (runId === epoch && !controller.signal.aborted) lastCompletedAt = now();
    if (changed) await options.onChanged?.({ trigger });
    return { attempted: true, changed, profiles: rows.length };
  }

  function request(trigger = "unknown", requestOptions = {}) {
    if (active?.promise) return active.promise;
    const owner = { controller: new AbortController(), promise: null, runId: ++epoch };
    active = owner;
    const promise = Promise.resolve().then(() => run(trigger, requestOptions, owner)).catch((error) => {
      if (error?.name === "AbortError" || owner.controller.signal.aborted) {
        diagnostics.cancelled += 1;
        return { attempted: true, cancelled: true };
      }
      diagnostics.failed += 1;
      options.logger?.warn?.("account-profile-sync", { reason: error?.code || error?.name || "Error" });
      return { attempted: true, failed: true, reason: error?.code || "profile-sync-failed" };
    }).finally(() => {
      if (active === owner) active = null;
    });
    owner.promise = promise;
    return promise;
  }

  async function forget(userId) {
    const config = configProvider();
    const playerKey = derivePlayerKey({ hasSession: true, userId });
    const directory = path.join(config.userDataDir, "accounts", "avatars", playerKey);
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {
      diagnostics.cacheCleanupFailed += 1;
    });
  }

  function cancel(reason = "account-change") {
    epoch += 1;
    const owner = active;
    active = null;
    owner?.controller.abort(reason);
  }

  return {
    cancel,
    forget,
    getDiagnostics: () => ({ ...diagnostics, inFlight: Boolean(active) }),
    request,
    shutdown: () => cancel("shutdown"),
  };
}

module.exports = {
  AVATAR_BUCKET,
  DEFAULT_PROFILE_FRESH_MS,
  MAX_AVATAR_BYTES,
  createAccountProfileSync,
  detectImage,
  normalizeProfile,
  safeLegacyAvatarUrl,
  resolveCachePath,
  validateStoragePath,
};
