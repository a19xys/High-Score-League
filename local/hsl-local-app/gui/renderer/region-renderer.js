function defaultWriteRegion(region, html) {
  region.innerHTML = html;
}

export function createRegionRenderer({ findRegion, writeRegion = defaultWriteRegion }) {
  if (typeof findRegion !== "function") {
    throw new TypeError("findRegion must be a function");
  }

  const snapshots = new Map();

  return {
    clear() {
      snapshots.clear();
    },

    forget(name) {
      snapshots.delete(name);
    },

    prime(name, html) {
      snapshots.set(name, String(html ?? ""));
    },

    render(name, html) {
      const nextHtml = String(html ?? "");
      const region = findRegion(name);

      if (!region) {
        snapshots.delete(name);
        return false;
      }

      if (snapshots.get(name) === nextHtml) {
        return false;
      }

      writeRegion(region, nextHtml, name);
      snapshots.set(name, nextHtml);
      return true;
    },

    snapshot(name) {
      return snapshots.get(name);
    },
  };
}
