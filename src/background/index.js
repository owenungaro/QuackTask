// Service worker entry
import { route as handleMessage } from "./router.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      console.log("[QuackTask/bg] msg in:", message?.type, message);
      const result = await handleMessage(message, sender);
      console.log("[QuackTask/bg] msg out:", message?.type, result);
      sendResponse(result);
    } catch (e) {
      console.error("[QuackTask/bg] msg error:", message?.type, e);
      sendResponse({ ok: false, error: e?.message || "Unhandled" });
    }
  })();
  return true; // keep channel open for async
});

// Handle extension icon click
chrome.action.onClicked.addListener(async () => {
  const defaultCanvasUrl = "https://canvas.instructure.com/";
  
  try {
    // Query for existing tabs with any Canvas instance
    const tabs = await chrome.tabs.query({ url: "*://*.instructure.com/*" });
    
    if (tabs.length > 0) {
      // If Canvas tabs exist, focus the most recently active one
      // Sort by last accessed time (if available) or just use the first one
      const sortedTabs = tabs.sort((a, b) => {
        // Prefer tabs with lastAccessed (Chrome API)
        if (a.lastAccessed && b.lastAccessed) {
          return b.lastAccessed - a.lastAccessed;
        }
        return 0;
      });
      const tab = sortedTabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      console.log("[QuackTask/bg] Focused existing Canvas tab:", tab.id, tab.url);
    } else {
      // Otherwise, open a new tab to default Canvas URL
      const newTab = await chrome.tabs.create({ url: defaultCanvasUrl });
      console.log("[QuackTask/bg] Opened new Canvas tab:", newTab.id);
    }
  } catch (e) {
    console.error("[QuackTask/bg] Error handling icon click:", e);
  }
});
