// Google Tasks REST wrappers (no auth UI here)
// Fetch helpers loop through pagination

import { getToken } from "./auth.js";

const BASE = "https://tasks.googleapis.com/tasks/v1";

async function authedFetch(path, opts = {}, tokenOverride) {
  const token = tokenOverride || (await getToken(false));
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt}`);
  }
  return res;
}

export async function listTaskLists() {
  let items = [];
  let pageToken;
  do {
    const qs = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "";
    const res = await authedFetch(`/users/@me/lists${qs}`);
    const data = await res.json();
    if (Array.isArray(data.items)) items = items.concat(data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export async function listTasksForList(listId, { showCompleted = true } = {}) {
  let items = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: showCompleted ? "true" : "false",
      showHidden: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await authedFetch(
      `/lists/${encodeURIComponent(listId)}/tasks?${params}`
    );
    const data = await res.json();
    if (Array.isArray(data.items)) items = items.concat(data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export async function getTasksInList(listId, opts = {}) {
  return listTasksForList(listId, opts);
}

export async function createTask({ listId, title, notes, dueRFC3339 }) {
  const body = {
    title: title || "Untitled",
    notes: notes || "",
    // Google Tasks 'due' expects RFC3339 date-time; undefined means omit
    ...(dueRFC3339 ? { due: dueRFC3339 } : {}),
  };
  const res = await authedFetch(`/lists/${encodeURIComponent(listId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function deleteTask(listId, taskId) {
  await authedFetch(
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" }
  );
  return true;
}
