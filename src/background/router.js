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

async function getAllGoogleTasks() {
  // Try without forcing a login prompt
  const lists = await listTaskLists().catch(() => []);
  const all = [];
  for (const l of lists) {
    try {
      const items = await getTasksInList(l.id, { showCompleted: true });
      for (const t of items) {
        all.push({
          listId: l.id,
          id: t.id,
          title: (t.title || "").trim(),
          notes: (t.notes || "").trim(),
          raw: t,
        });
      }
    } catch {
      // ignore per-list errors
    }
  }
  return all;
}

async function syncWithGoogleTasks() {
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

  if (!tasks.length) {
    await chrome.storage.local.set({ qt_google_index: {} });
    return { ok: true, synced: 0, found: 0 };
  }

  let googleItems = [];
  try {
    googleItems = await getAllGoogleTasks();
  } catch {
    // If we cannot reach Google (not logged in), wipe index flags so UI shows Add
    for (const t of tasks) {
      delete t._in_google_tasks;
      delete t._google_taskId;
      delete t._google_listId;
    }
    await chrome.storage.local.set({ qt_tasks: tasks, qt_google_index: {} });
    return { ok: true, synced: tasks.length, found: 0, authed: false };
  }

  const index = {};
  let found = 0;

  for (const t of tasks) {
    const key = taskKey(t);
    const title = (t.assignment || "").trim();

    // Prefer notes match on our key, otherwise fallback to exact title match
    const hit =
      googleItems.find((g) => g.notes.includes(key)) ||
      googleItems.find((g) => g.title === title);

    if (hit) {
      t._in_google_tasks = true;
      t._google_taskId = hit.id;
      t._google_listId = hit.listId;
      index[key] = { listId: hit.listId, taskId: hit.id };
      found += 1;
    } else {
      delete t._in_google_tasks;
      delete t._google_taskId;
      delete t._google_listId;
      delete index[key];
    }
  }

  await chrome.storage.local.set({ qt_tasks: tasks, qt_google_index: index });
  return { ok: true, synced: tasks.length, found };
}

export async function route(msg /*, sender */) {
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

    case "STORE_SCRAPED_DATA": {
      try {
        const data = Array.isArray(msg?.data) ? msg.data : [];
        await chrome.storage.local.set({ qt_tasks: data, scrapedData: data });
        // Kick a background sync so flags are fresh
        const res = await syncWithGoogleTasks().catch((e) => ({
          ok: false,
          error: String(e),
        }));
        return { ok: true, synced: res?.synced || 0, found: res?.found || 0 };
      } catch (e) {
        log("STORE_SCRAPED_DATA error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "SYNC_WITH_GOOGLE_TASKS": {
      try {
        const res = await syncWithGoogleTasks();
        return res;
      } catch (e) {
        log("SYNC_WITH_GOOGLE_TASKS error:", e);
        return { ok: false, error: String(e) };
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
          // include the QuackTask key first so sync can rediscover by notes
          notes: key ? `${key}${notes ? `\n${notes}` : ""}` : notes || "",
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

        try {
          await deleteTask(entry.listId, entry.taskId);
        } catch (err) {
          const msgTxt = String(err || "");
          if (msgTxt.includes("404") || msgTxt.includes("410")) {
            // already deleted upstream: clean local state
            await unmarkInGoogleAndIndex(key);
            return { ok: true, soft: true };
          }
          throw err;
        }

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
