function checkLoginStatus() {
  const savedToken = localStorage.getItem("access_token");

  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (chrome.runtime.lastError || !token) {
      if (!savedToken) {
        switchScreen("login");
        return;
      }

      fetch(
        "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" +
          savedToken
      )
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            switchScreen("login");
          } else {
            localStorage.setItem("access_token", savedToken);
            switchScreen("main");
            loadAssignments();
            loadGoogleTaskLists();
          }
        })
        .catch(() => switchScreen("login"));
    } else {
      localStorage.setItem("access_token", token);
      switchScreen("main");
      loadAssignments();
      loadGoogleTaskLists();
    }
  });
}

function loginUser() {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError || !token) {
      console.log("Login failed.");
      return;
    }

    localStorage.setItem("access_token", token);
    switchScreen("main");
  });
}

function logoutUser() {
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (chrome.runtime.lastError || !token) {
      finishLogout();
      return;
    }

    // Remove token from Chrome Identity API cache
    chrome.identity.removeCachedAuthToken({ token }, () => {
      fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
        .then(() => finishLogout())
        .catch(() => finishLogout());
    });
  });
}

function finishLogout() {
  localStorage.removeItem("access_token"); //remove token from storage
  switchScreen("login");
}
