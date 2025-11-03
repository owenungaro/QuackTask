chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "STORE_SCRAPED_DATA") {
    console.log("Storing scraped data:", message.data);
    chrome.storage.local.set({ scrapedData: message.data }, () => {
      console.log("Scraped data stored successfully.");
    });
  }

  if (message.type === "GET_SCRAPED_DATA") {
    chrome.storage.local.get(["scrapedData"], (result) => {
      console.log("Sending stored scraped data:", result.scrapedData);
      sendResponse(result.scrapedData || []);
    });
    return true;
  }

  if (message.type === "SCRAPE_ASSIGNMENTS") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];

      //check if valid url
      if (tab && tab.url.includes("sit.instructure.com")) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } else {
        // console.log("SCRAPE_ASSIGNMENTS attempted on an invalid page:", tab ? tab.url : "No active tab");
      }
    });
  }

  if (message.type === "LOGIN") {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        // console.log("Auth Error:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError });
        return;
      }
      // console.log("Token:", token);
      sendResponse({ success: true, token });
    });
    return true;
  }

  // Add near other chrome.runtime.onMessage cases
  if (message.type === "ADD_BLACKLIST") {
    chrome.storage.local.get({ blacklist: [] }, (result) => {
      const updated = Array.from(
        new Set([...(result.blacklist || []), message.assignment])
      );

      chrome.storage.local.set({ blacklist: updated }, () => {
        console.log("Added to blacklist:", message.assignment);
      });
    });
  }

  if (message.type === "GET_BLACKLIST") {
    chrome.storage.local.get({ blacklist: [] }, (result) => {
      sendResponse(result.blacklist);
    });
    return true;
  }

  if (message.type === "REMOVE_BLACKLIST") {
    chrome.storage.local.get({ blacklist: [] }, (result) => {
      const updated = result.blacklist.filter((a) => a !== message.assignment);
      chrome.storage.local.set({ blacklist: updated }, () => {
        console.log("Removed from blacklist:", message.assignment);
        sendResponse({ success: true });
      });
    });
    return true;
  }
});
