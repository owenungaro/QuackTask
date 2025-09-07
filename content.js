(() => {
    console.log("Content script loaded.");
    setTimeout(() => {
        console.log("Scraping after delay..");

        const dashboardCards = document.querySelectorAll(".ic-DashboardCard");
        const data = [];
        const seen = new Set(); // dedupe by course+title+href

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

            // NEW LAYOUT: <div class="bettercanvas-card-assignments"> with <a><span>title</span><span>due</span></a>
            const assignmentsContainer = card.querySelector(".bettercanvas-card-assignments");
            if (assignmentsContainer) {
                const newAssignments = assignmentsContainer.querySelectorAll("a[href]");
                newAssignments.forEach((a) => {
                    const spans = a.querySelectorAll("span");
                    const assignmentText = (spans[0]?.textContent || a.textContent || "").trim();
                    const dueDate = (spans[1]?.textContent || "").trim() || "No Due Date";
                    const href = a.href || null;
                    const isCompleted = href && href.includes("/submissions/");

                    if (courseName && assignmentText && href) {
                        const key = `${courseName}||${assignmentText}||${href}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            data.push({
                                course: courseName,
                                assignment: assignmentText,
                                href: href,
                                dueDate: dueDate,
                                completed: isCompleted
                            });
                        }
                    } else {
                        console.log("Skipping invalid (new) assignment:", { courseName, assignmentText, href });
                    }
                });
            }

            // OLD LAYOUT: .bettercanvas-assignment-link inside a container that also has .bettercanvas-assignment-dueat
            const oldAssignments = card.querySelectorAll(".bettercanvas-assignment-link");
            oldAssignments.forEach((assignment) => {
                if (!assignment) return;

                const container = assignment.closest(".bettercanvas-assignment-container");
                const dueDateElement = container?.querySelector(".bettercanvas-assignment-dueat");
                const dueDate = dueDateElement ? dueDateElement.textContent.trim() : "No Due Date";

                const href = assignment.href || null;
                const isCompleted = href && href.includes("/submissions/");
                const assignmentText = assignment.textContent.trim();

                if (courseName && assignmentText && href) {
                    const key = `${courseName}||${assignmentText}||${href}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        data.push({
                            course: courseName,
                            assignment: assignmentText,
                            href: href,
                            dueDate: dueDate,
                            completed: isCompleted
                        });
                    }
                } else {
                    console.log("Skipping invalid (old) assignment:", { courseName, assignmentText, href });
                }
            });
        });

        const filteredData = data.filter(item => item.assignment !== 'None' && !item.completed);

        chrome.runtime.sendMessage({ type: "STORE_SCRAPED_DATA", data: filteredData }, () => {
            console.log("Filtered data sent to background script:", filteredData);
        });
    }, 3000);
})();
