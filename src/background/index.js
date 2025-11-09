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
  const canvasUrl = "https://sit.instructure.com/";
  
  try {
    // Query for existing tabs with sit.instructure.com
    const tabs = await chrome.tabs.query({ url: "https://sit.instructure.com/*" });
    
    if (tabs.length > 0) {
      // If a Canvas tab exists, bring it to the front
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      console.log("[QuackTask/bg] Focused existing Canvas tab:", tab.id);
    } else {
      // Otherwise, open a new tab
      const newTab = await chrome.tabs.create({ url: canvasUrl });
      console.log("[QuackTask/bg] Opened new Canvas tab:", newTab.id);
    }
  } catch (e) {
    console.error("[QuackTask/bg] Error handling icon click:", e);
  }
});
