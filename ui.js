function switchScreen(screen) {
  const screens = {
    login: document.getElementById("loginScreen"),
    main: document.getElementById("mainScreen"),
    settings: document.getElementById("settingsScreen"),
  };

  Object.values(screens).forEach((s) => (s.style.display = "none"));
  screens[screen].style.display = "block";

  const cssFile = {
    login: "login.css",
    main: "main.css",
    settings: "settings.css",
  };

  document.getElementById("dynamicCSS").setAttribute("href", cssFile[screen]);

  if (screen === "settings") loadBlacklistUI();
}

function loadBlacklistUI() {
  const listEl = document.getElementById("blacklistList");
  if (!listEl) return;

  listEl.innerHTML = "<li>Loading...</li>";

  chrome.runtime.sendMessage({ type: "GET_BLACKLIST" }, (blacklist = []) => {
    listEl.innerHTML = "";

    if (blacklist.length === 0) {
      listEl.innerHTML = "<li>No hidden assignments</li>";
      return;
    }

    blacklist.forEach((assignment) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${assignment}</span>
        <button class="undo-btn">Undo</button>
      `;

      li.querySelector(".undo-btn").addEventListener("click", () => {
        chrome.runtime.sendMessage(
          { type: "REMOVE_BLACKLIST", assignment },
          (response) => {
            if (chrome.runtime.lastError)
              console.warn("Undo failed:", chrome.runtime.lastError.message);
            loadBlacklistUI();
          }
        );
      });

      listEl.appendChild(li);
    });
  });
}

function displayAssignments(assignments) {
  const canvasOutput = document.getElementById("canvasOutput");
  canvasOutput.innerHTML = "";

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
                <button class="hide-btn">Hide</button>
            </div>
        `;

    assignmentCard.addEventListener("click", (event) => {
      if (
        event.target.tagName !== "A" &&
        !event.target.classList.contains("hide-btn")
      ) {
        assignmentCard.classList.toggle("selected");
      }
    });

    const hideBtn = assignmentCard.querySelector(".hide-btn");
    hideBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "ADD_BLACKLIST",
        assignment: assignment.assignment,
      });
      assignmentCard.remove();
    });

    canvasOutput.appendChild(assignmentCard);
  });
}
