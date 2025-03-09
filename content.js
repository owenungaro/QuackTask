(() => {
    console.log("Content script loaded.");
    setTimeout(() => {
        console.log("Scraping after delay..");

        const dashboardCards = document.querySelectorAll(".ic-DashboardCard");
        const data = [];

        dashboardCards.forEach((card) => {
            let ariaLabel = card.getAttribute("aria-label") || "Unknown Course";
            const words = ariaLabel.split(" ");
            let courseName = "unknownCourse";

            if (words.length >= 3) {
                const secondWord = words[1];
                let thirdWord = words[2];
                if (thirdWord.includes("-")) {
                    thirdWord = thirdWord.split("-")[0];
                }
                courseName = secondWord + " " + thirdWord;
            }

            const assignments = card.querySelectorAll(".bettercanvas-assignment-link");

            assignments.forEach((assignment) => {
                if (!assignment) return; // Skip undefined elements

                const dueDateElement = assignment.closest(".bettercanvas-assignment-container")?.querySelector(".bettercanvas-assignment-dueat");
                const dueDate = dueDateElement ? dueDateElement.textContent.trim() : "No Due Date";

                const href = assignment.href || null;
                const isCompleted = href && href.includes("/submissions/");

                const assignmentText = assignment.textContent.trim();
                
                if (courseName && assignmentText && href) {
                    data.push({
                        course: courseName,
                        assignment: assignmentText,
                        href: href,
                        dueDate: dueDate,
                        completed: isCompleted
                    });
                } else {
                    console.log("Skipping invalid assignment:", { courseName, assignmentText, href });
                }
            });
        });

        const filteredData = data.filter(item => item.assignment !== 'None' && !item.completed);

        chrome.runtime.sendMessage({ type: "STORE_SCRAPED_DATA", data: filteredData }, () => {
            console.log("Filtered data sent to background script:", filteredData);
        });
    }, 3000);
})();
