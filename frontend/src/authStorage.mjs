const sessionKey = "mw.pages.session";

export function storeSession(token, browser = window) {
  try {
    browser.localStorage.setItem(sessionKey, token);
    try { browser.sessionStorage.removeItem(sessionKey); } catch { /* Storage unavailable. */ }
  } catch {
    try { browser.sessionStorage.setItem(sessionKey, token); } catch { /* Storage unavailable. */ }
  }
}

export function readSession(browser = window) {
  try {
    const token = browser.localStorage.getItem(sessionKey);
    if (token) return token;
  } catch { /* Storage unavailable. */ }
  try { return browser.sessionStorage.getItem(sessionKey); } catch { return null; }
}

export function clearStoredSession(browser = window) {
  try { browser.localStorage.removeItem(sessionKey); } catch { /* Storage unavailable. */ }
  try { browser.sessionStorage.removeItem(sessionKey); } catch { /* Storage unavailable. */ }
}
