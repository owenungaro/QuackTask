function checkLoginStatus() {
    chrome.runtime.sendMessage({ type: "LOGIN" }, (response) => {
        if(response.success) {
            console.log("User logged in.");
            switchScreen("main");
        } else {
            console.log("User not logged in.");
            switchScreen("login");
        }
    });
}

function loginUser() {
    chrome.runtime.sendMessage({ type: "LOGIN" }, (response) => {
        if(response.success) {
            localStorage.setItem("access_token", response.token);
            switchScreen("main");
        } else {
            console.log("Login failed.");
        }
    });
}

function logoutUser() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if(chrome.runtime.lastError || !token) {
            finishLogout();
            return;
        }

        chrome.identity.removeCachedAuthToken({ token }, () => {
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
                .then(() => finishLogout())
                .catch(() => finishLogout());
        });
    });
}

function finishLogout() {
    localStorage.removeItem("access_token");
    switchScreen("login");
}
