import assert from "node:assert/strict";
import { test } from "node:test";
import { clearStoredSession, readSession, storeSession } from "./src/authStorage.mjs";

function storage(backing = new Map()) {
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, value),
    removeItem: (key) => backing.delete(key),
  };
}

test("Pages app session survives a new tab and logout clears both stores", () => {
  const localStorage = storage();
  const firstTab = { localStorage, sessionStorage: storage() };
  storeSession("signed-app-session", firstTab);
  assert.equal(readSession({ localStorage, sessionStorage: storage() }), "signed-app-session");
  clearStoredSession(firstTab);
  assert.equal(readSession({ localStorage, sessionStorage: storage() }), null);
});

test("unavailable persistent storage falls back to the current tab", () => {
  const unavailable = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  const browser = { localStorage: unavailable, sessionStorage: storage() };
  storeSession("temporary-session", browser);
  assert.equal(readSession(browser), "temporary-session");
  clearStoredSession(browser);
  assert.equal(readSession(browser), null);
});
