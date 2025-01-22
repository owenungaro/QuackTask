chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === "STORE_SCRAPED_DATA") {
        chrome.storage.local.set({ scrapedData: message.data }, () => {
            console.log("✅ Scraped data stored in chrome storage:", message.data);
        });
    }

    if(message.type === "GET_SCRAPED_DATA") {
        chrome.storage.local.get(["scrapedData"], (result) => {
            sendResponse(result.scrapedData || []);
        });
        return true;
    }
});