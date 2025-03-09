function switchScreen(screen) {
    const screens = {
        login: document.getElementById("loginScreen"),
        main: document.getElementById("mainScreen"),
        settings: document.getElementById("settingsScreen")
    };

    Object.values(screens).forEach(s => s.style.display = "none");
    screens[screen].style.display = "block";

    // Update CSS file dynamically
    const cssFile = {
        login: "login.css",
        main: "main.css",
        settings: "settings.css"
    };

    document.getElementById("dynamicCSS").setAttribute("href", cssFile[screen]);
}

function displayAssignments(assignments) {
    const canvasOutput = document.getElementById("canvasOutput");
    canvasOutput.innerHTML = ""; // Clear previous assignments

    if (!assignments || assignments.length === 0) {
        canvasOutput.innerHTML = "<p>No assignments found.</p>";
        return;
    }

    assignments.forEach((assignment) => {
        const assignmentCard = document.createElement("div");
        assignmentCard.classList.add("assignment-card");

        assignmentCard.innerHTML = `
            <div>
                <div class="assignment-title">
                    <a href="${assignment.href}" target="_blank">${assignment.assignment}</a>
                </div>
                <div class="assignment-course">${assignment.course}</div>
                <div class="assignment-date">${assignment.dueDate}</div>
            </div>
        `;

        assignmentCard.addEventListener("click", (event) => {
            if (event.target.tagName !== "A") {
                assignmentCard.classList.toggle("selected");
            }
        });

        canvasOutput.appendChild(assignmentCard);
    });
}
