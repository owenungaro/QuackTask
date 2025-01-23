function createTaskList(data) {
    if (data.length === 0) {
        console.log("⚠️ No tasks to send to Google Tasks.");
        return;
    }

    const taskListTitle = "Canvas Assignments";

    gapi.client.tasks.tasklists.insert({ title: taskListTitle }).then((response) => {
        const taskListId = response.result.id;

        data.forEach((item) => {
            gapi.client.tasks.tasks.insert({
                tasklist: taskListId,
                resource: {
                    title: `${item.course} - ${item.assignment}`,
                    notes: `Due: ${item.dueDate}\nLink: ${item.href || "No link available"}`,
                },
            }).then((taskResponse) =>
                console.log("✅ Task added:", taskResponse.result)
            ).catch(console.error);
        });
    }).catch(console.error);
}

// Listen for message to send remaining tasks
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SEND_TO_TASKS") {
        console.log("📤 Sending tasks to Google Tasks:", message.data);
        createTaskList(message.data);
    }
});
