document.addEventListener("DOMContentLoaded", () => {
  const loginScreen = document.getElementById("loginScreen");
  const mainScreen = document.getElementById("mainScreen");
  const settingsScreen = document.getElementById("settingsScreen");

  // Buttons
  const loginButton = document.getElementById("login");
  const sendTasksButton = document.getElementById("sendTasks");
  const goToSettingsButton = document.getElementById("goToSettings");
  const backToMainButton = document.getElementById("backToMain");
  const logoutButton = document.getElementById("logoutButton");

  const taskListsDropdown = document.getElementById("taskLists");
  let scrapedData = []; //formated as "title": x, "notes": y, "due": z
  let filteredData = [] // ^

  loginScreen.style.display = "block"; //defaults user to login screen

  //checks if user is already logged in
  chrome.runtime.sendMessage({type: "LOGIN"}, (response) => {
      if(response.success) {
          console.log("User already logged in.");
          switchToMainScreen();
      } else {
          console.log("User not logged in. Showing login screen.");
      }
  });

  //login function
  loginButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "LOGIN" }, (response) => {
          if(response.success) {
              console.log("User logged in:", response.token);
              localStorage.setItem("access_token", response.token); //adds access token and redirects
              switchToMainScreen();
          } else {
              console.error("Login failed:", response.error);
          }
      });
  });

  function switchToMainScreen() {
    const token = localStorage.getItem("access_token");
    if(!token) { //checks to see if token is valid
        console.log("No valid token, redirecting to login...");
        switchToLoginScreen();
        return;
    }

    loginScreen.style.display = "none";
    mainScreen.style.display = "block";
    fetchUserInfo();
    scrapeAssignments();
    fetchTaskLists();
  }

  function switchToLoginScreen() {
    console.log("Redirecting to login.");
    loginScreen.style.display = "block";
    mainScreen.style.display = "none";
    settingsScreen.style.display = "none";
  }

  function fetchUserInfo() {
    refreshAuthToken((token) => {
        fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${token}` }
        })
        .then(res => {
            if(!res.ok) { //res.ok sees if token is valid
                if(res.status === 401) { 
                    localStorage.removeItem("access_token");
                    switchToLoginScreen();
                }
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            document.getElementById("userInfo").textContent = `Logged in as: ${data.name}`;
        })
        .catch(error => {
            console.log("Failed to fetch user info:", error);
            switchToLoginScreen();
        });
    });
  }

  function scrapeAssignments() {
    chrome.runtime.sendMessage({ type: "SCRAPE_ASSIGNMENTS" });
    chrome.runtime.sendMessage({ type: "GET_SCRAPED_DATA" }, (response) => {
        scrapedData = response || [];
        //displayAssignments(scrapedData);
        filterAssignments((uniqueTasks) => {
          console.log("test1");
          console.log("unique", uniqueTasks);
          displayAssignments(uniqueTasks);
        });
    });
  }

  function filterAssignments(callback) {
    console.log("🚀 Filtering assignments for all lists...");

    fetchAllTaskNames((existingTaskNames) => {
        if(!existingTaskNames || existingTaskNames.length === 0) {
            callback(scrapedData);
            return;
        }
        if(!scrapedData || scrapedData.length === 0) {
            callback([]);
            return;
        }

        //normalize task names for comparison
        const formattedExistingTasks = new Set(existingTaskNames.map(task => (task ? task.toLowerCase().trim() : "")));

        //set to `COURSE → ASSIGNMENT` format before filtering
        filteredData = scrapedData.filter(item => {
            if(!item.course || !item.assignment) return true; //keep if missing data

            const formattedTaskName = `${item.course} → ${item.assignment}`.toLowerCase().trim();
            return !formattedExistingTasks.has(formattedTaskName);
        });

        //console.log("Filtered Assignments (Not in Any Google Task List):", filteredData);
        callback(filteredData);
    });
  }

  function fetchAllTasks(callback) {
    const token = localStorage.getItem("access_token");
    if (!token) {
        return callback([]);
    }

    fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", { headers: { Authorization: `Bearer ${token}` } })
    .then(res => res.json())
    .then(data => {
        if (!data.items || !Array.isArray(data.items)) {
            return callback([]);
        }
        
        let allTasks = [];
        let listsProcessed = 0;

        data.items.forEach(list => {
            fetchTasksFromList(list.id, (tasks) => {
                if (tasks) {
                    allTasks = allTasks.concat(tasks);
                }

                if (++listsProcessed === data.items.length) {
                    callback(allTasks);
                }
            });
        });
    })
    .catch((error) => {
        callback([]);
    });
  }


  function fetchTasksFromList(taskListId, callback, pageToken = null, allTasks = []) {
      const token = localStorage.getItem("access_token");
      if(!token) return callback([]);

      let url = `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks?showCompleted=true&showHidden=true&maxResults=100`;
      if(pageToken) url += `&pageToken=${pageToken}`;

      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
          if(data.items) allTasks = allTasks.concat(data.items);
          data.nextPageToken ? fetchTasksFromList(taskListId, callback, data.nextPageToken, allTasks) : callback(allTasks);
      })
      .catch(() => callback(allTasks));
  }

  function fetchAllTaskNames(callback) {
    fetchAllTasks((tasks) => {
        if (!tasks || !Array.isArray(tasks)) {
            return callback([]);  // Ensure no undefined errors
        }

        const taskNames = tasks
            .map(task => task.title?.trim()) // Use optional chaining `?.`
            .filter(title => title); // Remove empty task titles

        console.log("Updated Task Names from Google:", taskNames);
        callback(taskNames);
    });
  }


  function refreshTaskList() { //not yet used
    fetchAllTaskNames((existingTaskNames) => {
        filterAssignments((uniqueTasks) => {
            console.log("Filtered Assignments (Updated):", uniqueTasks);
            displayAssignments(uniqueTasks);
        });
    });
  }


  function displayAssignments(data) {
    const outputDiv = document.getElementById("canvasOutput");
    if(data.length === 0) { //base case
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
    `).join(""); //assignment card information (very big IK)
  }

  function refreshAuthToken(callback) {
    chrome.identity.getAuthToken({ interactive: false }, (newToken) => {
        if(chrome.runtime.lastError || !newToken) {
            console.log("Failed to refresh token. Redirecting to login.");
            localStorage.removeItem("access_token");
            switchToLoginScreen();
        } else {
            console.log("Token refreshed:", newToken);
            localStorage.setItem("access_token", newToken);
            if(callback) callback(newToken);
        }
    });
  }

  function fetchTaskLists() { //adds different task lists to choose from
      const token = localStorage.getItem("access_token");
      if(!token) return; //base case

      fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
          headers: {Authorization: `Bearer ${token}`} //permissions
      })
      .then(res => res.json())
      .then(data => {
          taskListsDropdown.innerHTML = "";
          if(data.items) {
              data.items.forEach(list => {
                  const option = document.createElement("option");
                  option.value = list.id;
                  option.textContent = list.title;
                  taskListsDropdown.appendChild(option);
              });
          }
      })
      .catch(error => console.log("Error fetching task lists:", error));
  }

  sendTasksButton.addEventListener("click", () => {
    const selectedTaskList = taskListsDropdown.value;
    if(!selectedTaskList) {
        alert("Please select a task list first!");
        return;
    }

    const token = localStorage.getItem("access_token");
    if(!token) return; //base case

    //gets all checked boxes
    const checkedIndexes = [...document.querySelectorAll(".assignment-checkbox:checked")]
        .map(checkbox => parseInt(checkbox.dataset.index));

    if(checkedIndexes.length === 0) { //base case
        alert("No assignments selected!");
        return;
    }

    //filters checked assignments
    const selectedAssignments = [...document.querySelectorAll(".assignment-checkbox:checked")]
    .map(checkbox => scrapedData.find(item => item.assignment === checkbox.dataset.title));


    selectedAssignments.forEach((item) => {
        const taskTitle = `${item.course} → ${item.assignment}`; //formats title
        const taskNotes = `${item.href ? item.href : ""}`; //formats description

        //date conversion (if date was given)
        let dueDateISO = null;
        const parsedDate = parseCanvasDate(item.dueDate);
        if(parsedDate) {
            dueDateISO = parsedDate.toISOString(); //converts to ISO
        }

        const task = {
            title: taskTitle,
            notes: taskNotes,
        };

        if(dueDateISO) {
            task.due = dueDateISO;
        }

        fetch(`https://tasks.googleapis.com/tasks/v1/lists/${selectedTaskList}/tasks`, { //permissions
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(task) //adds tasks
        })
        .then(res => res.json())
        .then(data => console.log("Task added:", data))
        .catch(error => console.log("Error adding task:", error));
    });

    alert("Selected tasks sent to Google Tasks!");
  });

  function parseCanvasDate(canvasDate) {
    if(!canvasDate || canvasDate.toLowerCase() === "no due date") {
        return null; //returns null if no valid date
    }
    //hands date formats (MM/YY)
    const dateParts = canvasDate.split("/");
    if(dateParts.length === 2 || dateParts.length === 3) {
        let month = parseInt(dateParts[0], 10) - 1; //0-11 inclusive
        let day = parseInt(dateParts[1], 10);
        let year = new Date().getFullYear(); //defaults to current year

        if(dateParts.length === 3) {
            year = parseInt(dateParts[2], 10); //uses year
        }

        const parsedDate = new Date(year, month, day);
        return isNaN(parsedDate.getTime()) ? null : parsedDate;
    }

    //hands formats
    const months = {Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11};

    const words = canvasDate.split(" ");
    if(words.length === 2 || words.length === 3) {
        let month = months[words[0]];
        let day = parseInt(words[1], 10);
        let year = new Date().getFullYear(); //defaults to current

        if(words.length === 3) {
            year = parseInt(words[2], 10);
        }

        if(month !== undefined && !isNaN(day)) {
            const parsedDate = new Date(year, month, day);
            return isNaN(parsedDate.getTime()) ? null : parsedDate;
        }
    }

    console.log(`Could not parse date: ${canvasDate}`);
    return null;
  }

  goToSettingsButton.addEventListener("click", () => {
      mainScreen.style.display = "none";
      settingsScreen.style.display = "block";
  });

  backToMainButton.addEventListener("click", () => {
      settingsScreen.style.display = "none";
      mainScreen.style.display = "block";
  });

  function testFetchTasksFromList(taskListId) {
    fetchTasksFromList(taskListId, (tasks) => {
        console.log(`Tasks from List (${taskListId}):`, tasks);
    });
  }

  logoutButton.addEventListener("click", () => {
    logoutUser();
  });

  function logoutUser() {
    console.log("Logging out user...");

    chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) {
            console.warn("No valid token found, redirecting to login...");
            finishLogout();
            return;
        }

        chrome.identity.removeCachedAuthToken({ token }, () => {
            console.log("Token removed from cache.");

            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
                .then(() => {
                    console.log("Google OAuth token revoked.");
                    finishLogout();
                })
                .catch(() => {
                    console.warn("Failed to revoke token, but logging out anyway.");
                    finishLogout();
                });
        });
    });
  }

  function finishLogout() {
      localStorage.removeItem("access_token"); // Remove stored token
      switchToLoginScreen();
  }
});