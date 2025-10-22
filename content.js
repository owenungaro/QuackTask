(() => {
  console.log("Tasks for Canvas scraper loaded.");
  setTimeout(() => {
    console.log("Scraping Tasks for Canvas...");

    const cards = document.querySelectorAll(".sc-hHftDr.kVpUOE");
    const data = [];
    const seen = new Set();

    cards.forEach((card) => {
      const course =
        card.querySelector(".sc-bBXqnf")?.textContent?.trim() ||
        "Unknown Course";
      const title =
        card.querySelector("a.sc-kfzAmx")?.textContent?.trim() || "Untitled";
      const href = card.querySelector("a.sc-kfzAmx")?.href || null;

      // Extract due date text like "Due Oct 22 at 11:59 PM | 100 points"
      let dueDate = "No Due Date";
      const dueDiv = card.querySelector(".sc-cxFLnm");
      if (dueDiv) {
        const match = dueDiv.textContent.match(
          /Due\s+([A-Za-z]+\s+\d{1,2}(?:\s+at\s+\d{1,2}:\d{2}\s+[AP]M)?)/i
        );
        if (match) dueDate = match[1].trim();
      }

      if (course && title && href) {
        const key = `${course}||${title}||${href}`;
        if (!seen.has(key)) {
          seen.add(key);
          data.push({
            course,
            assignment: title,
            href,
            dueDate,
            completed: false,
          });
        }
      }
    });

    const filteredData = data.filter(
      (item) => item.assignment !== "None" && !item.completed
    );

    chrome.runtime.sendMessage(
      { type: "STORE_SCRAPED_DATA", data: filteredData },
      () => {
        console.log("Tasks for Canvas data sent:", filteredData);
      }
    );
  }, 2500);
})();
