document.addEventListener("DOMContentLoaded", () => {
    let scrapedData = [];
    
    //checks if there is anything in storage else, scrape assignments
    chrome.storage.local.get("scrapedData", (result) => {
      if(result.scrapedData && result.scrapedData.length > 0) {
        console.log("Using stored assingments from Chrome storage");
        scrapedData = result.scrapedData;
        displayAssignments(scrapedData);
      } else {
        console.log("No assignments found in Chrome storage, scraping...");
        scrapeAssignments();
      }
  });

  function displayAssignments(data) {
    const outputDiv = document.getElementById("output");
    outputDiv.innerHTML = "<ul>" + data.map((item, index) => `
        <li>
            <strong>${item.course}</strong>: ${item.assignment} 
            (Due: ${item.dueDate})<br>
            <a href="${item.href}" target="_blank">${item.href ? "View Assignment" : "No Link Available"}</a>
            <button class="remove-task" data-index="${index}">Delete</button>
        </li>`).join("") + "</ul>";

        document.querySelectorAll(".remove-task").forEach(button => {
          button.addEventListener("click", (event) => {
              const index = event.target.getAttribute("data-index");
              removeAssignment(index);
          });
      });
  }

  function scrapeAssignments() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"]
        });
    });
  }

  function removeAssignment(index) {
    console.log("Removing task at index:", index);
    scrapedData.splice(index, 1); //removes task from array

    chrome.storage.local.set({ scrapedData: scrapedData }, () => {
      console.log("Task has been successfuly removed from Chrome cloud storage.")
      displayAssignments(scrapedData); //resets data visualization
    });


  }


  //sends info to tasks (just message)
  document.getElementById("sendTasks").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "SEND_TO_TASKS", data: scrapedData });
  });

});