let scrapedData = [];
let filteredData = [];

function scrapeAssignments() {
    chrome.runtime.sendMessage({ type: "SCRAPE_ASSIGNMENTS" });
    chrome.runtime.sendMessage({ type: "GET_SCRAPED_DATA" }, (response) => {
        scrapedData = response || [];
        filterAssignments((uniqueTasks) => displayAssignments(uniqueTasks));
    });
}

function filterAssignments(callback) {
    fetchAllTaskNames((existingTaskNames) => {

        if(!existingTaskNames || existingTaskNames.length === 0) {
            return callback(scrapedData);
        }

        if(!scrapedData || scrapedData.length === 0) {
            return callback([]);
        }

        const formattedExistingTasks = new Set(
            existingTaskNames.map(task => task?.toLowerCase().trim())
        );

        filteredData = scrapedData.filter(item => {
            if(!item.course || !item.assignment) return true;
            const formattedTaskName = `${item.course} → ${item.assignment}`.toLowerCase().trim();
            return !formattedExistingTasks.has(formattedTaskName);
        });

        callback(filteredData);
    });
}

