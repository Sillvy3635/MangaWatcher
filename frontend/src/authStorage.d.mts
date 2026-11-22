type BrowserStorage = Pick<Window, "localStorage" | "sessionStorage">;

export function storeSession(token: string, browser?: BrowserStorage): void;
export function readSession(browser?: BrowserStorage): string | null;
export function clearStoredSession(browser?: BrowserStorage): void;
