document.addEventListener("DOMContentLoaded", () => {
    let scrapedData = [];
    
    //checks if there is anything in storage else, scrape assignments
    chrome.storage.local.get("scrapedData", (result) => {
      if(result.scrapedData && result.scrapedData.length > 0) {
        console.log("Using stored assingments from chrome storage");
        scrapedData = result.scrapedData;
        displayAssignments(scrapedData);
      } else {
        console.log("No assignments found in chrome storage, scraping...");
        scrapeAssignments();
      }
  });

  function displayAssignments(data) {
    const outputDiv = document.getElementById("output");
    outputDiv.innerHTML = "<ul>" + data.map(item => `
        <li>
            <strong>${item.course}</strong>: ${item.assignment} 
            (Due: ${item.dueDate})<br>
            <a href="${item.href}" target="_blank">${item.href ? "View Assignment" : "No Link Available"}</a>
        </li>`).join("") + "</ul>";
  }

  function scrapeAssignments() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"]
        });
    });
  }


  //sends info to tasks (just message)
  document.getElementById("sendTasks").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "SEND_TO_TASKS", data: scrapedData });
  });

});