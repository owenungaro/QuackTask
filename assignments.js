let scrapedData = [];
let filteredData = [];

function scrapeAssignments() {
    chrome.runtime.sendMessage({ type: "SCRAPE_ASSIGNMENTS" });
    chrome.runtime.sendMessage({ type: "GET_SCRAPED_DATA" }, (response) => {
        scrapedData = response || [];
        if (scrapedData.length === 0) {
            document.getElementById("canvasOutput").innerHTML = "<p>No assignments found.</p>";
            return;
        }
        filterAssignments((uniqueTasks) => displayAssignments(uniqueTasks));
    });
}

function filterAssignments(callback) {
    fetchAllTaskNames((existingTaskNames) => {
        // console.log("Google Tasks (Existing Tasks):", existingTaskNames);
        // console.log("Raw Scraped Data Before Filtering:", scrapedData);

        if(!scrapedData || scrapedData.length === 0) {
            console.warn("⚠️ No scraped data available.");
            return callback([]);
        }

        if(!existingTaskNames || existingTaskNames.length === 0) {
            console.log("No existing Google Tasks found.");
            return callback(scrapedData.filter(item => item && !item.completed));
        }

        const formattedExistingTasks = new Set(
            existingTaskNames.map(task => task?.toLowerCase().trim())
        );

        filteredData = scrapedData.filter(item => {
            if(!item || typeof item !== "object" || !item.course || !item.assignment) {
                console.log("Skipping invalid assignment in filter:", item);
                return false;
            }

            const formattedTaskName = `${item.course} → ${item.assignment}`.toLowerCase().trim();
            return !formattedExistingTasks.has(formattedTaskName) && !item.completed;
        });

        // console.log("Filtered Assignments After Processing:", filteredData);
        callback(filteredData);
    });
}


