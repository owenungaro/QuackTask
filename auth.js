function checkLoginStatus() {
    const token = localStorage.getItem("access_token");

    if(!token) {
        switchScreen("login");
        return;
    }

    fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + token)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                localStorage.removeItem("access_token");
                switchScreen("login");
            } else {
                switchScreen("main");
                loadAssignments();
                loadGoogleTaskLists();
            }
        })
        .catch(() => {
            localStorage.removeItem("access_token");
            switchScreen("login");
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
