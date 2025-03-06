(() => {
    console.log("Content script loaded.");
    setTimeout(() => { //delaying scraping to ensure all necissary extensions load
        console.log("Scraping after delay..");

        const dashboardCards = document.querySelectorAll(".ic-DashboardCard"); //gets all class elements

        const data = [];
        dashboardCards.forEach((card) => { //goes through each course element
            let ariaLabel = card.getAttribute("aria-label") || "Unknown Course"; //Gets the course name, defaults to unknown

            const words = ariaLabel.split(" ");
            let courseName= "unknownCourse";
            if(words.length >= 3) {
                const secondWord = words[1]; //course name
                let thirdWord = words[2]; //course number
                if(thirdWord.includes("-")) { //removes course section (ex; CS 101-A would be CS 101)
                    thirdWord = thirdWord.split("-")[0];
                }
                courseName = secondWord + " " + thirdWord;
            }

            const assignments = card.querySelectorAll(".bettercanvas-assignment-link"); //gets all assignments

            assignments.forEach((assignment) => {
                const dueDateElement = assignment.closest(".bettercanvas-assignment-container").querySelector(".bettercanvas-assignment-dueat"); //gets due date
                const dueDate = dueDateElement ? dueDateElement.textContent.trim() : "No Due Date"; //dueDate defaults to no due date


                data.push({
                    course: courseName, //course name
                    assignment: assignment.textContent.trim(), //assignment name
                    href: assignment.href || null, //hyperlink to assignment, defaults to null
                    dueDate: dueDate //assignment due date
                });
            });
        });

        const filteredData = data.filter(item => item.assignment !== 'None'); //Gets rid off all elements with 'None' as datatype (to get rid of trash that scraper picks up)
        
        chrome.runtime.sendMessage({ type: "STORE_SCRAPED_DATA", data: filteredData }, () => {
            console.log("Filtered data sent to background script:", filteredData);
        });
    }, 3000) //delay time (3s)
})();