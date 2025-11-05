// src/background/router.js
import {
  listTaskLists,
  createTask,
  deleteTask,
  getTasksInList,
} from "./tasksApi.js";
import { ensureTokenInteractive, clearAuth } from "./auth.js";

// Keys
const nameKeyOf = (t) => `${t.course || t.courseCode || ""} → ${t.assignment || ""}`;
const codeKeyOf = (t) =>
  t && t.courseCode ? `${t.courseCode} → ${t.assignment || ""}` : null;

// Selected list
async function getSelectedListId() {
  const st = await chrome.storage.local.get({ qt_selected_list: null });
  return st.qt_selected_list;
}

// Mark present in Google + index (active only)
async function markInGoogleAndIndex(key, listId, taskId) {
  const st = await chrome.storage.local.get(["qt_tasks", "scrapedData", "qt_google_index"]);
  const tasks = Array.isArray(st.qt_tasks)
    ? st.qt_tasks
    : Array.isArray(st.scrapedData)
    ? st.scrapedData
    : [];

  for (const t of tasks) {
    if (nameKeyOf(t) === key || codeKeyOf(t) === key) {
      t._in_google_tasks = true;
      delete t._completed_in_google;
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

// Unmark from Google + index
async function unmarkInGoogleAndIndex(key) {
  const st = await chrome.storage.local.get(["qt_tasks", "scrapedData", "qt_google_index"]);
  const tasks = Array.isArray(st.qt_tasks)
    ? st.qt_tasks
    : Array.isArray(st.scrapedData)
    ? st.scrapedData
    : [];

  for (const t of tasks) {
    if (nameKeyOf(t) === key || codeKeyOf(t) === key) {
      delete t._in_google_tasks;
      delete t._completed_in_google;
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

// Pull all Google tasks with status (active + completed)
async function getAllGoogleTasksWithStatus() {
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
          status: (t.status || "needsAction").toLowerCase(), // "completed" or "needsaction"
        });
      }
    } catch { /* ignore per-list errors */ }
  }
  return all;
}

// Reconcile local Canvas tasks with Google
async function syncWithGoogleTasks() {
  const st = await chrome.storage.local.get(["qt_tasks", "scrapedData", "qt_google_index"]);
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
    googleItems = await getAllGoogleTasksWithStatus();
  } catch {
    // Not authed or API issue → clear flags so UI shows Add (but no completed tag)
    for (const t of tasks) {
      delete t._in_google_tasks;
      delete t._completed_in_google;
      delete t._google_taskId;
      delete t._google_listId;
    }
    await chrome.storage.local.set({ qt_tasks: tasks, qt_google_index: {} });
    return { ok: true, synced: tasks.length, found: 0, authed: false };
  }

  const index = {}; // only active items go here
  let found = 0;

  for (const t of tasks) {
    const nameKey = nameKeyOf(t);
    const codeKey = codeKeyOf(t);
    const href = (t.href || "").trim();

    // helper: does notes contain our Canvas link?
    const notesMatch = (gi) => href && gi.notes && gi.notes.indexOf(href) !== -1;

    // Active match (incomplete only)
    const hitActive = googleItems.find(
      (g) =>
        g.status !== "completed" &&
        (g.title === nameKey || (codeKey && g.title === codeKey) || notesMatch(g))
    );

    // Completed match
    const hitCompleted = !hitActive
      ? googleItems.find(
          (g) =>
            g.status === "completed" &&
            (g.title === nameKey || (codeKey && g.title === codeKey) || notesMatch(g))
        )
      : null;

    if (hitActive) {
      t._in_google_tasks = true;
      delete t._completed_in_google;
      t._google_taskId = hitActive.id;
      t._google_listId = hitActive.listId;

      // store whichever title matched
      const matchedKey =
        hitActive.title === nameKey ? nameKey : (hitActive.title === codeKey ? codeKey : nameKey);
      index[matchedKey] = { listId: hitActive.listId, taskId: hitActive.id };
      found++;
    } else if (hitCompleted) {
      // Hide completed items in UI
      delete t._in_google_tasks;
      t._completed_in_google = true;
      delete t._google_taskId;
      delete t._google_listId;
      delete index[nameKey];
      if (codeKey) delete index[codeKey];
    } else {
      // Not in Google
      delete t._in_google_tasks;
      delete t._completed_in_google;
      delete t._google_taskId;
      delete t._google_listId;
      delete index[nameKey];
      if (codeKey) delete index[codeKey];
    }
  }

  await chrome.storage.local.set({ qt_tasks: tasks, qt_google_index: index });
  return { ok: true, synced: tasks.length, found };
}

export async function route(msg) {
  const log = (...a) => console.log("[QuackTask/bg]", ...a);

  switch (msg?.type) {
    case "LOGIN":
      await ensureTokenInteractive(true);
      return { success: true };

    case "LOGOUT":
      await clearAuth();
      return { success: true };

    case "GET_GOOGLE_LISTS":
      try {
        await ensureTokenInteractive(false);
        const lists = await listTaskLists();
        return { success: true, authed: true, lists };
      } catch (e) {
        log("GET_GOOGLE_LISTS error:", e);
        return { success: false, authed: false, lists: [] };
      }

    case "STORE_SCRAPED_DATA":
      try {
        const data = Array.isArray(msg?.data) ? msg.data : [];
        await chrome.storage.local.set({ qt_tasks: data, scrapedData: data });
        const res = await syncWithGoogleTasks().catch((e) => ({
          ok: false,
          error: String(e),
        }));
        return { ok: true, synced: res?.synced || 0, found: res?.found || 0 };
      } catch (e) {
        log("STORE_SCRAPED_DATA error:", e);
        return { ok: false, error: String(e) };
      }

    case "SYNC_WITH_GOOGLE_TASKS":
      try {
        return await syncWithGoogleTasks();
      } catch (e) {
        log("SYNC_WITH_GOOGLE_TASKS error:", e);
        return { ok: false, error: String(e) };
      }

    case "ADD_TO_GOOGLE_TASKS": {
      const { listId: incomingListId, key, notes } = msg;
      try {
        await ensureTokenInteractive(true);
        const listId = incomingListId || (await getSelectedListId());

        // Find the task in local cache to grab due date
        const st = await chrome.storage.local.get(["qt_tasks", "scrapedData"]);
        const tasks = Array.isArray(st.qt_tasks)
          ? st.qt_tasks
          : Array.isArray(st.scrapedData)
          ? st.scrapedData
          : [];
        const found = tasks.find((t) => nameKeyOf(t) === key || codeKeyOf(t) === key);
        const dueRFC3339 =
          found?.rfc3339Due && typeof found.rfc3339Due === "string"
            ? found.rfc3339Due
            : undefined;

        const created = await createTask({
          listId,
          title: key || "Untitled",        // Title is the key
          notes: notes || "",               // Notes should be the Canvas URL
          dueRFC3339,                       // ✅ put date back
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
            (t) => (t.title || "") === key || (t.notes || "").includes(key)
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

    case "ADD_BLACKLIST": {
      const { assignment } = msg;
      try {
        if (!assignment || typeof assignment !== "string") {
          return { ok: false, error: "Invalid assignment key" };
        }
        const st = await chrome.storage.local.get({ qt_blacklist: [] });
        const blacklist = Array.isArray(st.qt_blacklist) ? st.qt_blacklist : [];
        if (!blacklist.includes(assignment)) {
          blacklist.push(assignment);
          await chrome.storage.local.set({ qt_blacklist: blacklist });
        }
        return { ok: true };
      } catch (e) {
        log("ADD_BLACKLIST error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "REMOVE_BLACKLIST": {
      const { assignment } = msg;
      try {
        if (!assignment || typeof assignment !== "string") {
          return { ok: false, error: "Invalid assignment key" };
        }
        const st = await chrome.storage.local.get({ qt_blacklist: [] });
        const blacklist = Array.isArray(st.qt_blacklist) ? st.qt_blacklist : [];
        const filtered = blacklist.filter((item) => item !== assignment);
        await chrome.storage.local.set({ qt_blacklist: filtered });
        return { ok: true };
      } catch (e) {
        log("REMOVE_BLACKLIST error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "GET_BLACKLIST": {
      try {
        const st = await chrome.storage.local.get({ qt_blacklist: [] });
        const blacklist = Array.isArray(st.qt_blacklist) ? st.qt_blacklist : [];
        return blacklist;
      } catch (e) {
        log("GET_BLACKLIST error:", e);
        return [];
      }
    }

    default:
      return { ok: false, error: "Unknown message" };
  }
}
