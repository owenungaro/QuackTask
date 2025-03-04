// Handle incoming messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SEND_TO_TASKS") {
        console.log("Sending tasks to Google Tasks:", message.data);
        createTaskList(message.data);
    }
});
