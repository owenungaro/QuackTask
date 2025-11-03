(() => {
  console.log("QuackTask Listening");

  let lastScrape = "";

  function scrapeTasks() {
    const cards = document.querySelectorAll(
      ".ic-DashboardCard, [data-testid='planner-item']"
    );

    if (!cards || cards.length === 0) return [];

    const tasks = [];
    const seen = new Set();

    cards.forEach((card) => {
      // Try different structures since Canvas sometimes changes them
      const course =
        card
          .querySelector(".ic-DashboardCard__header-title")
          ?.textContent?.trim() ||
        card
          .querySelector("[data-testid='planner-context-name']")
          ?.textContent?.trim() ||
        "Unknown Course";

      const title =
        card.querySelector("a.ic-DashboardCard__link")?.textContent?.trim() ||
        card
          .querySelector("[data-testid='planner-item-title']")
          ?.textContent?.trim() ||
        "Untitled";

      const href =
        card.querySelector("a.ic-DashboardCard__link")?.href ||
        card.querySelector("a[href*='/assignments/']")?.href ||
        null;

      const due =
        card
          .querySelector(".ic-DashboardCard__header-subtitle")
          ?.textContent?.trim() ||
        card
          .querySelector("[data-testid='planner-item-date']")
          ?.textContent?.trim() ||
        "No Due Date";

      if (title && href && !seen.has(href)) {
        seen.add(href);
        tasks.push({
          course,
          assignment: title,
          href,
          dueDate: due,
          completed: false,
        });
      }
    });

    return tasks;
  }

  // Run immediately once the page has loaded
  function update() {
    const tasks = scrapeTasks();
    const serialized = JSON.stringify(tasks);

    if (serialized !== lastScrape) {
      lastScrape = serialized;
      console.log("QuackTask scraped:", tasks);

      // Send to background for storage
      chrome.runtime.sendMessage(
        { type: "STORE_SCRAPED_DATA", data: tasks },
        () => {
          console.log("QuackTask: tasks sent to background.");
        }
      );
    }
  }

  // Observe changes (Canvas dashboard uses React, so we need MutationObserver)
  const observer = new MutationObserver(() => update());
  observer.observe(document.body, { childList: true, subtree: true });

  // Periodic backup scrape every few seconds
  setInterval(update, 5000);

  // First run
  update();
})();
