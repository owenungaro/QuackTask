let scrapedData = [];
let filteredData = [];

function scrapeAssignments() {
  chrome.runtime.sendMessage({ type: "SCRAPE_ASSIGNMENTS" });
  chrome.runtime.sendMessage({ type: "GET_SCRAPED_DATA" }, (response) => {
    scrapedData = response || [];
    if (scrapedData.length === 0) {
      document.getElementById("canvasOutput").innerHTML =
        "<p>No assignments found.</p>";
      return;
    }
    filterAssignments((uniqueTasks) => displayAssignments(uniqueTasks));
  });
}

function filterAssignments(callback) {
  chrome.runtime.sendMessage({ type: "GET_BLACKLIST" }, (blacklist = []) => {
    fetchAllTaskNames((existingTaskNames) => {
      if (!scrapedData || scrapedData.length === 0) {
        console.warn("⚠️ No scraped data available.");
        return callback([]);
      }

      const formattedExistingTasks = new Set(
        (existingTaskNames || []).map((task) => task?.toLowerCase().trim())
      );

      filteredData = scrapedData.filter((item) => {
        if (!item || !item.course || !item.assignment) return false;

        const formattedTaskName = `${item.course} → ${item.assignment}`
          .toLowerCase()
          .trim();
        const isBlacklisted = blacklist.some((b) =>
          item.assignment.toLowerCase().includes(b.toLowerCase())
        );

        return (
          !formattedExistingTasks.has(formattedTaskName) &&
          !item.completed &&
          !isBlacklisted
        );
      });

      callback(filteredData);
    });
  });
}
