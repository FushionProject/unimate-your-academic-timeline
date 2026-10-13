import assert from "node:assert/strict";
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "../../src/lib/browser-storage.ts";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};
assert.equal(
  readBrowserStorage(() => storage, "recovery"),
  null,
);
assert.equal(
  writeBrowserStorage(() => storage, "recovery", "active"),
  true,
);
assert.equal(
  readBrowserStorage(() => storage, "recovery"),
  "active",
);
removeBrowserStorage(() => storage, "recovery");
assert.equal(
  readBrowserStorage(() => storage, "recovery"),
  null,
);

const denied = () => {
  throw new Error("Storage access denied");
};
assert.equal(
  readBrowserStorage(denied, "recovery"),
  null,
  "unavailable recovery state fails closed",
);
assert.equal(
  writeBrowserStorage(denied, "recovery", "active"),
  false,
  "recovery mode cannot start without storage",
);
assert.doesNotThrow(
  () => removeBrowserStorage(denied, "setup"),
  "cleanup cannot turn successful signin into an error",
);
assert.doesNotThrow(
  () => writeBrowserStorage(denied, "setup", "pending"),
  "optional setup hint cannot turn successful signup into an error",
);

const quotaExceeded = {
  ...storage,
  setItem: () => {
    throw new Error("Quota exceeded");
  },
};
assert.equal(
  writeBrowserStorage(() => quotaExceeded, "recovery", "active"),
  false,
);
assert.equal(
  readBrowserStorage(() => quotaExceeded, "recovery"),
  null,
);
console.log(
  "PASS optional storage denial, recovery fail-closed behavior, and harmless auth cleanup",
);
