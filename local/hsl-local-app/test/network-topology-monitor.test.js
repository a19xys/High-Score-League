const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTopologySnapshot,
  createNetworkTopologyMonitor,
} = require("../src/network-topology-monitor");

const ipv4 = (address, internal = false) => ({
  address,
  cidr: `${address}/24`,
  family: "IPv4",
  internal,
  netmask: "255.255.255.0",
});

test("topology fingerprint is deterministic and reacts to address changes", () => {
  const first = buildTopologySnapshot({ wifi: [ipv4("192.168.1.4")], loopback: [ipv4("127.0.0.1", true)] });
  const reordered = buildTopologySnapshot({ loopback: [ipv4("127.0.0.1", true)], wifi: [ipv4("192.168.1.4")] });
  const changed = buildTopologySnapshot({ wifi: [ipv4("192.168.1.5")] });
  assert.equal(first.fingerprintHash, reordered.fingerprintHash);
  assert.notEqual(first.fingerprintHash, changed.fingerprintHash);
  assert.equal(first.externalAddressCount, 1);
  assert.equal(buildTopologySnapshot({ lo: [ipv4("127.0.0.1", true)] }).externalAddressCount, 0);
  assert.doesNotThrow(() => buildTopologySnapshot({ vpn: [{ family: "IPv6", address: "fd00::1" }], partial: null }));
});

test("monitor polls, emits each change once, stops, and tolerates API errors", () => {
  let now = 1000;
  let interfaces = { lan: [ipv4("10.0.0.2")] };
  let callback;
  let cleared = false;
  const changes = [];
  const monitor = createNetworkTopologyMonitor({
    networkInterfaces: () => interfaces,
    now: () => now,
    onChange: (change) => changes.push(change),
    setInterval(fn, delay) { callback = fn; assert.equal(delay, 1000); return { unref() {} }; },
    clearInterval() { cleared = true; },
  });
  monitor.start();
  callback();
  assert.equal(changes.length, 0);
  now += 1000;
  interfaces = { lan: [ipv4("10.0.0.3")] };
  callback();
  callback();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].generation, 1);
  monitor.stop();
  assert.equal(cleared, true);

  const broken = createNetworkTopologyMonitor({ networkInterfaces() { throw new Error("unavailable"); } });
  assert.doesNotThrow(() => broken.poll());
  assert.equal(broken.getDiagnostics().lastError, "Error");
});
