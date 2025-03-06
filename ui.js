function switchScreen(screen) {
    const screens = {
        login: document.getElementById("loginScreen"),
        main: document.getElementById("mainScreen"),
        settings: document.getElementById("settingsScreen")
    };

    Object.values(screens).forEach(s => s.style.display = "none");
    screens[screen].style.display = "block";
}

function displayAssignments(data) {
    const outputDiv = document.getElementById("canvasOutput");
    if(data.length === 0) {
        outputDiv.innerHTML = "<p>No assignments found.</p>";
        return;
    }

    outputDiv.innerHTML = data.map((item) => `
        <div class="assignment-card">
            <input type="checkbox" class="assignment-checkbox" data-title="${item.assignment}">
            <p class="assignment-title">${item.assignment}</p>
            <p class="assignment-course"><strong>Course:</strong> ${item.course}</p>
            <p class="assignment-date">${item.dueDate ? `<strong>Due:</strong> ${item.dueDate}` : "<strong>Due:</strong> No Due Date"}</p>
            <a href="${item.href}" target="_blank">${item.href ? "View Assignment" : "No Link Available"}</a>
        </div>
    `).join("");
}
