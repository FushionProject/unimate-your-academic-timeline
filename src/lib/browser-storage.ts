type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readBrowserStorage(getStorage: () => BrowserStorage, key: string): string | null {
  try {
    return getStorage().getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserStorage(
  getStorage: () => BrowserStorage,
  key: string,
  value: string,
): boolean {
  try {
    getStorage().setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorage(getStorage: () => BrowserStorage, key: string): void {
  try {
    getStorage().removeItem(key);
  } catch {
    // Browser preferences are optional; cleanup must not turn an auth success into an error.
  }
}
