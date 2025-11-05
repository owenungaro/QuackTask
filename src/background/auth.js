// Minimal OAuth helpers for Google Tasks
// Uses chrome.identity to mint and clear tokens

export async function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!token) return reject(new Error("No token"));
      resolve(token);
    });
  });
}

export async function ensureTokenInteractive(interactive = false) {
  return getToken(interactive);
}

export async function clearAuth() {
  // Best effort: remove current cached token and clear all cached tokens
  try {
    const token = await getToken(false).catch(() => null);
    if (token) {
      await new Promise((resolve) =>
        chrome.identity.removeCachedAuthToken({ token }, () => resolve())
      );
    }
    if (chrome.identity.clearAllCachedAuthTokens) {
      await new Promise((resolve) =>
        chrome.identity.clearAllCachedAuthTokens(() => resolve())
      );
    }
  } catch (_) {
    // ignore
  }

  // Also drop any local state that assumes an authenticated session
  await chrome.storage.local.remove(["qt_selected_list", "qt_google_index"]);
  return true;
}
