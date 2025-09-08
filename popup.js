document.addEventListener("DOMContentLoaded", () => {
    // UI elements
    const loginButton = document.getElementById("login");
    const sendTasksButton = document.getElementById("sendTasks");
    const logoutButton = document.getElementById("logoutButton");
    const goToSettingsButton = document.getElementById("goToSettings");
    const backToMainButton = document.getElementById("backToMain");

    loginButton.addEventListener("click", loginUser);
    sendTasksButton.addEventListener("click", sendTasksToGoogle);
    logoutButton.addEventListener("click", logoutUser);
    goToSettingsButton.addEventListener("click", () => switchScreen("settings"));
    backToMainButton.addEventListener("click", () => switchScreen("main"));

    checkLoginStatus();
});


//load after login
function loadAssignments() {
  // console.log("Requesting stored assignments.");
  chrome.runtime.sendMessage({ type: "GET_SCRAPED_DATA" }, (response) => {
      // console.log("Loaded assignments:", response);

      if(!response || response.length === 0) {
          document.getElementById("canvasOutput").innerHTML = "<p>No assignments found.</p>";
          return;
      }

      //stores data and scrapes assignment
      scrapedData = response;
      filterAssignments((uniqueTasks) => {
          // console.log("Filtered Assignments:", uniqueTasks);
          displayAssignments(uniqueTasks);
      });
  });
}


//loads google task list
function loadGoogleTaskLists() {
  const token = localStorage.getItem("access_token");
  if(!token) {
      // console.log("No access token available.");
      return;
  }

  fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
      headers: { Authorization: `Bearer ${token}` }
  })
  .then(res => res.json())
  .then(data => {
      if(!data.items || data.items.length === 0) {
          // console.log("No task lists found.");
          return;
      }

      // console.log("Google Task lists:", data.items);

      //populates dropdown list
      const taskListDropdown = document.getElementById("taskLists");
      taskListDropdown.innerHTML = data.items.map(
          list => `<option value="${list.id}">${list.title}</option>`
      ).join("");
  })
  .catch(error => console.log("Error fetching Google Task lists:", error));
}

// 🔹 Send Assignments to Google Tasks
function fetchAllTaskNames(callback) {
  const token = localStorage.getItem("access_token");
  if(!token) {
      // console.log("No access token found.");
      callback([]);
      return;
  }

  fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
      headers: { Authorization: `Bearer ${token}` }
  })
  .then(res => res.json())
  .then(data => {
      if(!data.items || data.items.length === 0) {
          // console.log("No task lists found.");
          callback([]);
          return;
      }

      let allTaskNames = [];
      let listsProcessed = 0;

      // Fetch tasks from each task list
      data.items.forEach((list) => {
          fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false`, {
              headers: { Authorization: `Bearer ${token}` }
          })
          .then(res => res.json())
          .then(taskData => {
              if(taskData.items) {
                  taskData.items.forEach(task => {
                    allTaskNames.push({
                        title: task.title.trim(),
                        completed: task.status === "completed"
                    });
                  });
              }
              listsProcessed++;
              //when all lists processed, return data
              if(listsProcessed === data.items.length) {
                  // console.log("Loaded Google Task names:", allTaskNames);
                  callback(allTaskNames.filter(task => !task.completed).map(task => task.title));
              }
          })
          .catch(error => {
              // console.log("Error fetching tasks:", error);
              listsProcessed++;
              if (listsProcessed === data.items.length) {
                  callback(allTaskNames);
              }
          });
      });
  })
  .catch(error => {
      // console.log("Error fetching Google Task lists:", error);
      callback([]);
  });
}

// Strict parser -> RFC3339 date (midnight Z). Accepts "Sep 9", "September 9",
// "9/12", "9/12/2025". If no 4-digit year, uses the current year.
function parseCanvasDate(raw) {
  if (!raw) return null;

  let s = raw.replace(/^due\s*/i, "").trim();
  if (/^no due date$/i.test(s)) return null;

  const Y = new Date().getFullYear();

  // 1) Numeric M/D or M/D/YYYY
  const num = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?$/);
  if (num) {
    const m = parseInt(num[1], 10) - 1;
    const d = parseInt(num[2], 10);
    const y = num[3] ? parseInt(num[3], 10) : Y;
    const dt = new Date(Date.UTC(y, m, d));           // midnight UTC
    return isNaN(dt) ? null : dt.toISOString();       // RFC3339
  }

  // 2) Month-name: "Sep 9" / "September 9" / with optional ", YYYY"
  const months = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11
  };
  const name = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (name) {
    const monKey = name[1].toLowerCase().slice(0,4);
    const m = months[monKey];
    if (m == null) return null;
    const d = parseInt(name[2], 10);
    const y = name[3] ? parseInt(name[3], 10) : Y;
    const dt = new Date(Date.UTC(y, m, d));
    return isNaN(dt) ? null : dt.toISOString();
  }

  return null; // anything else is unsupported
}



function sendTasksToGoogle() {
    const token = localStorage.getItem("access_token");
    if (!token) {
        return;
    }

    const selectedTaskList = document.getElementById("taskLists").value;
    if (!selectedTaskList) {
        alert("Select a task list.");
        return;
    }

    const selectedAssignments = [...document.querySelectorAll(".assignment-card.selected")];

    if (selectedAssignments.length === 0) {
        alert("No assignments selected.");
        return;
    }

    selectedAssignments.forEach((card) => {
        const assignmentTitle = card.querySelector(".assignment-title a").textContent;
        const item = scrapedData.find(task => task.assignment === assignmentTitle);

        if (!item) return;

        let dueDateISO = null;
        if (item.dueDate && item.dueDate.toLowerCase() !== "no due date") {
            dueDateISO = parseCanvasDate(item.dueDate);
        }

        const task = {
            title: `${item.course} → ${item.assignment}`,
            notes: item.href ? item.href : "",
        };

        if (dueDateISO) {
            task.due = dueDateISO; //google task needs ISO formatting
        }

        fetch(`https://tasks.googleapis.com/tasks/v1/lists/${selectedTaskList}/tasks`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(task)
        })
        .then(res => res.json())
        .then(() => {
            card.classList.add("removing"); //adds animation class
            setTimeout(() => {
                card.style.display = "none"; //hides
                card.remove(); //removes
            }, 500); //matches the animation with the sending
        })
        .catch(error => console.log("Error adding task:", error));
    });

    // alert("Tasks sent to Google Tasks.");
}




// //ensures tasks load after login
// function checkLoginStatus() {
//   chrome.runtime.sendMessage({ type: "LOGIN" }, (response) => {
//       if(response.success) {
//           // console.log("User logged in.");
//           switchScreen("main");

//           //loads assignments and task list
//           loadAssignments();
//           loadGoogleTaskLists();
//       } else {
//           // console.log("User not logged in.");
//           switchScreen("login");
//       }
//   });
// }
