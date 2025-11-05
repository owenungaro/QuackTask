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
