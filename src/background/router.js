// Routes messages from the content script / sidebar to background actions

import {
  listTaskLists,
  createTask,
  deleteTask,
  getTasksInList,
} from "./tasksApi.js";

import { ensureTokenInteractive, clearAuth } from "./auth.js";

/** Build the storage key we use in the UI and index */
const taskKey = (t) => `${t.course}→${t.assignment}`;

async function getSelectedListId() {
  const st = await chrome.storage.local.get({ qt_selected_list: null });
  return st.qt_selected_list;
}

async function markInGoogleAndIndex(key, listId, taskId) {
  const st = await chrome.storage.local.get([
    "qt_tasks",
    "scrapedData",
    "qt_google_index",
  ]);
  const tasks = Array.isArray(st.qt_tasks)
    ? st.qt_tasks
    : Array.isArray(st.scrapedData)
    ? st.scrapedData
    : [];

  for (const t of tasks) {
    if (taskKey(t) === key) {
      t._in_google_tasks = true;
      t._google_taskId = taskId;
      t._google_listId = listId;
      break;
    }
  }

  const index = st.qt_google_index || {};
  index[key] = { listId, taskId };

  await chrome.storage.local.set({ qt_tasks: tasks, qt_google_index: index });
  return { tasks, index };
}

async function unmarkInGoogleAndIndex(key) {
  const st = await chrome.storage.local.get([
    "qt_tasks",
    "scrapedData",
    "qt_google_index",
  ]);
  const tasks = Array.isArray(st.qt_tasks)
    ? st.qt_tasks
    : Array.isArray(st.scrapedData)
    ? st.scrapedData
    : [];

  for (const t of tasks) {
    if (taskKey(t) === key) {
      delete t._in_google_tasks;
      delete t._google_taskId;
      delete t._google_listId;
      break;
    }
  }

  const index = st.qt_google_index || {};
  delete index[key];

  await chrome.storage.local.set({ qt_tasks: tasks, qt_google_index: index });
  return { tasks, index };
}

export async function route(msg) {
  const log = (...a) => console.log("[QuackTask:bg]", ...a);

  switch (msg?.type) {
    case "LOGIN": {
      await ensureTokenInteractive(true);
      return { success: true };
    }

    case "LOGOUT": {
      await clearAuth();
      return { success: true };
    }

    case "GET_GOOGLE_LISTS": {
      try {
        await ensureTokenInteractive(false);
        const lists = await listTaskLists();
        return { success: true, authed: true, lists };
      } catch (e) {
        log("GET_GOOGLE_LISTS error:", e);
        return { success: false, authed: false, lists: [] };
      }
    }

    case "ADD_TO_GOOGLE_TASKS": {
      const { listId: incomingListId, title, notes, key } = msg;
      try {
        await ensureTokenInteractive(true);
        const listId = incomingListId || (await getSelectedListId());

        const st = await chrome.storage.local.get(["qt_tasks", "scrapedData"]);
        const tasks = Array.isArray(st.qt_tasks)
          ? st.qt_tasks
          : Array.isArray(st.scrapedData)
          ? st.scrapedData
          : [];
        const found = tasks.find((t) => taskKey(t) === key);

        const dueRFC3339 =
          found?.rfc3339Due && typeof found.rfc3339Due === "string"
            ? found.rfc3339Due
            : undefined;

        const created = await createTask({
          listId,
          title: title || found?.assignment || "Untitled",
          notes: notes || "",
          dueRFC3339,
        });

        await markInGoogleAndIndex(key, listId, created.id);
        return { ok: true, taskId: created.id, listId };
      } catch (e) {
        log("ADD_TO_GOOGLE_TASKS error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "DELETE_FROM_GOOGLE_TASKS": {
      const { key, listId: incomingListId } = msg;
      try {
        await ensureTokenInteractive(true);

        const st = await chrome.storage.local.get(["qt_google_index"]);
        const idx = st.qt_google_index || {};
        const entry = idx[key];

        if (!entry) {
          const listId = incomingListId || (await getSelectedListId());
          const items = await getTasksInList(listId, { showCompleted: true });
          const hit = items.find(
            (t) => (t.notes || "").includes(key) || (t.title || "") === key
          );
          if (hit) {
            await deleteTask(listId, hit.id);
            await unmarkInGoogleAndIndex(key);
            return { ok: true };
          }
          return { ok: false, error: "Not found in Google Tasks" };
        }

        await deleteTask(entry.listId, entry.taskId);
        await unmarkInGoogleAndIndex(key);
        return { ok: true };
      } catch (e) {
        log("DELETE_FROM_GOOGLE_TASKS error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "GET_BLACKLIST": {
      const st = await chrome.storage.local.get({ qt_blacklist: [] });
      return st.qt_blacklist || [];
    }

    case "ADD_BLACKLIST": {
      const st = await chrome.storage.local.get({ qt_blacklist: [] });
      const arr = new Set(st.qt_blacklist || []);
      arr.add(msg.assignment);
      await chrome.storage.local.set({ qt_blacklist: Array.from(arr) });
      return { ok: true };
    }

    case "REMOVE_BLACKLIST": {
      const st = await chrome.storage.local.get({ qt_blacklist: [] });
      const arr = new Set(st.qt_blacklist || []);
      arr.delete(msg.assignment);
      await chrome.storage.local.set({ qt_blacklist: Array.from(arr) });
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unknown message" };
  }
}
