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
  const err = (...a) => console.error("[QuackTask/auth]", ...a);
  
  // Best effort: revoke OAuth grant, remove cached tokens, and clear local state
  try {
    // Try to get the current token (non-interactive)
    const token = await getToken(false).catch(() => null);
    
    if (token) {
      // Remove the cached token
      try {
        await new Promise((resolve) =>
          chrome.identity.removeCachedAuthToken({ token }, () => resolve())
        );
      } catch (e) {
        err("Failed to remove cached auth token:", e);
      }
      
      // Revoke the OAuth grant with Google
      try {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
          method: "GET",
        }).catch(() => {
          // Ignore fetch errors - best effort revoke
        });
      } catch (e) {
        err("Failed to revoke OAuth grant:", e);
      }
    }
    
    // Clear all cached auth tokens
    if (chrome.identity.clearAllCachedAuthTokens) {
      try {
        await new Promise((resolve) =>
          chrome.identity.clearAllCachedAuthTokens(() => resolve())
        );
      } catch (e) {
        err("Failed to clear all cached auth tokens:", e);
      }
    }
  } catch (e) {
    err("Error in clearAuth:", e);
  }

  // Drop any local state that assumes an authenticated session
  try {
    await chrome.storage.local.remove([
      "qt_selected_list",
      "qt_google_index",
      "qt_google_authed",
    ]);
  } catch (e) {
    err("Failed to clear local storage:", e);
  }
  
  return true;
}
