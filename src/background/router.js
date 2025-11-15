// src/background/router.js
const DEBUG = false; // Set to true for development logging

import {
  listTaskLists,
  createTask,
  deleteTask,
  getTasksInList,
} from "./tasksApi.js";
import { ensureTokenInteractive, clearAuth } from "./auth.js";

// Keys
const nameKeyOf = (t) =>
  `${t.course || t.courseName || t.courseCode || ""} → ${
    t.assignment || t.title || ""
  }`;
const codeKeyOf = (t) =>
  t && t.courseCode
    ? `${t.courseCode} → ${t.assignment || t.title || ""}`
    : null;

// Selected list
async function getSelectedListId() {
  const st = await chrome.storage.local.get({ qt_selected_list: null });
  return st.qt_selected_list;
}

// Produce a local calendar-date RFC3339 (time ignored by Google Tasks, but date stays correct)
function toLocalDateOnlyRFC3339(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return undefined;
    const pad = (n) => String(n).padStart(2, "0");
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const off = d.getTimezoneOffset(); // minutes to add to LOCAL to get UTC
    const sign = off > 0 ? "-" : "+";
    const a = Math.abs(off);
    const oh = pad(Math.floor(a / 60));
    const om = pad(a % 60);
    // Time is ignored by Google Tasks anyway; we send local midnight to lock the *date*
    return `${y}-${m}-${day}T00:00:00${sign}${oh}:${om}`;
  } catch {
    return undefined;
  }
}

// Mark present in Google + index (active only)
async function markInGoogleAndIndex(key, listId, taskId) {
  const st = await chrome.storage.local.get([
    "qt_tasks",
    "scrapedData",
    "qt_google_index",
  ]);

  // Prefer the current flagged cache so we don't lose _completed_in_google
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
  const st = await chrome.storage.local.get([
    "qt_tasks",
    "scrapedData",
    "qt_google_index",
  ]);

  // Same reasoning as above
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
    } catch {
      /* ignore per-list errors */
    }
  }
  return all;
}

// Reconcile local Canvas tasks with Google
async function syncWithGoogleTasks() {
  const st = await chrome.storage.local.get([
    "qt_tasks",
    "scrapedData",
    "qt_google_index",
  ]);
  const tasks = Array.isArray(st.scrapedData)
    ? st.scrapedData
    : Array.isArray(st.qt_tasks)
    ? st.qt_tasks
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
    const notesMatch = (gi) =>
      href && gi.notes && gi.notes.indexOf(href) !== -1;

    // Active match (incomplete only)
    const hitActive = googleItems.find(
      (g) =>
        g.status !== "completed" &&
        (g.title === nameKey ||
          (codeKey && g.title === codeKey) ||
          notesMatch(g))
    );

    // Completed match
    const hitCompleted = !hitActive
      ? googleItems.find(
          (g) =>
            g.status === "completed" &&
            (g.title === nameKey ||
              (codeKey && g.title === codeKey) ||
              notesMatch(g))
        )
      : null;

    if (hitActive) {
      t._in_google_tasks = true;
      delete t._completed_in_google;
      t._google_taskId = hitActive.id;
      t._google_listId = hitActive.listId;

      // store whichever title matched
      const matchedKey =
        hitActive.title === nameKey
          ? nameKey
          : hitActive.title === codeKey
          ? codeKey
          : nameKey;
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
  const info = (...a) => console.log("[QuackTask/bg]", ...a); // Basic operational info - always shown
  const log = (...a) => { if (DEBUG) console.log("[QuackTask/bg]", ...a); }; // Verbose debug - only if DEBUG

  switch (msg?.type) {
    case "LOGIN":
      try {
        await ensureTokenInteractive(true);
        // Set logged-in flag after successful authentication
        await chrome.storage.local.set({ qt_google_authed: true });
        info("Login successful");
        return { success: true };
      } catch (e) {
        console.error("[QuackTask/bg] LOGIN error:", e);
        // Ensure flag is false on failure
        await chrome.storage.local.set({ qt_google_authed: false });
        return { success: false, error: String(e) };
      }

    case "LOGOUT":
      try {
        await clearAuth();
        // Ensure flag is false after logout
        await chrome.storage.local.set({ qt_google_authed: false });
        info("Logout successful");
        return { success: true };
      } catch (e) {
        console.error("[QuackTask/bg] LOGOUT error:", e);
        // Still set flag to false even if clearAuth had issues
        await chrome.storage.local.set({ qt_google_authed: false });
        return { success: false, error: String(e) };
      }

    case "GET_GOOGLE_LISTS":
      try {
        // Check if user is considered logged in
        const st = await chrome.storage.local.get({ qt_google_authed: false });
        if (!st.qt_google_authed) {
          // User is not logged in - don't try to authenticate
          return { success: false, authed: false, lists: [] };
        }
        
        // User is logged in - try to get token and list tasks
        await ensureTokenInteractive(false);
        const lists = await listTaskLists();
        if (DEBUG) log(`Loaded ${lists.length} Google Task lists`);
        return { success: true, authed: true, lists };
      } catch (e) {
        console.error("[QuackTask/bg] GET_GOOGLE_LISTS error:", e);
        // Token is bad or API failed - mark as logged out
        await chrome.storage.local.set({ qt_google_authed: false });
        return { success: false, authed: false, lists: [] };
      }

    case "STORE_SCRAPED_DATA": {
      try {
        const data = Array.isArray(msg?.data) ? msg.data : [];

        // 1) Save only the raw scrape and mark UI as not-ready
        await chrome.storage.local.set({ scrapedData: data, qt_ready: false });

        // 2) Reconcile with Google (adds flags like _in_google_tasks / _completed_in_google)
        let res;
        try {
          res = await syncWithGoogleTasks();
        } catch (e) {
          res = { ok: false, error: String(e) };
        } finally {
          // 3) Mark ready so the UI renders once with accurate data
          await chrome.storage.local.set({ qt_ready: true });
        }

        info(`Stored ${data.length} scraped items, synced ${res?.synced || 0}, found ${res?.found || 0} in Google Tasks`);
        return { ok: true, synced: res?.synced || 0, found: res?.found || 0 };
      } catch (e) {
        console.error("[QuackTask/bg] STORE_SCRAPED_DATA error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "SYNC_WITH_GOOGLE_TASKS":
      try {
        // Check if user is considered logged in
        const st = await chrome.storage.local.get({ qt_google_authed: false });
        if (!st.qt_google_authed) {
          // User is not logged in - return early without trying to sync
          return { ok: true, synced: 0, found: 0, authed: false };
        }
        
        const result = await syncWithGoogleTasks();
        info(`Sync complete: ${result.found || 0} tasks found in Google Tasks`);
        return result;
      } catch (e) {
        console.error("[QuackTask/bg] SYNC_WITH_GOOGLE_TASKS error:", e);
        // Token is bad or API failed - mark as logged out
        await chrome.storage.local.set({ qt_google_authed: false });
        return { ok: false, error: String(e), authed: false };
      }

    case "ADD_TO_GOOGLE_TASKS": {
      const { listId: incomingListId, key, notes, dueOverrideDate } = msg;
      try {
        // Check if user is considered logged in
        const authSt = await chrome.storage.local.get({ qt_google_authed: false });
        if (!authSt.qt_google_authed) {
          return { ok: false, error: "Not logged in. Please log in first." };
        }
        
        await ensureTokenInteractive(true);
        const listId = incomingListId || (await getSelectedListId());

        let dueRFC3339 = undefined;

        // If dueOverrideDate is provided, use it (takes priority)
        if (dueOverrideDate !== undefined) {
          if (dueOverrideDate === null) {
            // Explicitly no due date
            dueRFC3339 = undefined;
          } else if (typeof dueOverrideDate === "string" && dueOverrideDate.trim()) {
            // Convert YYYY-MM-DD to RFC3339
            // The date input gives us YYYY-MM-DD, we need to convert to ISO and then to local date-only RFC3339
            const isoString = `${dueOverrideDate.trim()}T00:00:00`;
            dueRFC3339 = toLocalDateOnlyRFC3339(isoString);
          }
        } else {
          // Fall back to original behavior: find the task in local cache to grab due date
          const st = await chrome.storage.local.get(["qt_tasks", "scrapedData"]);
          const tasks = Array.isArray(st.scrapedData)
            ? st.scrapedData
            : Array.isArray(st.qt_tasks)
            ? st.qt_tasks
            : [];
          const found = tasks.find(
            (t) => nameKeyOf(t) === key || codeKeyOf(t) === key
          );
          if (found?.rfc3339Due && typeof found.rfc3339Due === "string") {
            dueRFC3339 = toLocalDateOnlyRFC3339(found.rfc3339Due); // ensures the *day* is correct; Tasks ignores time
          }
        }

        const created = await createTask({
          listId,
          title: key || "Untitled", // Title is the key
          notes: notes || "", // Notes should be the Canvas URL
          dueRFC3339, // put date back
        });

        await markInGoogleAndIndex(key, listId, created.id);
        info(`Added task to Google Tasks: ${key}`);
        return { ok: true, taskId: created.id, listId };
      } catch (e) {
        console.error("[QuackTask/bg] ADD_TO_GOOGLE_TASKS error:", e);
        // Token is bad or API failed - mark as logged out
        await chrome.storage.local.set({ qt_google_authed: false });
        return { ok: false, error: String(e) };
      }
    }

    case "DELETE_FROM_GOOGLE_TASKS": {
      const { key, listId: incomingListId } = msg;
      try {
        // Check if user is considered logged in
        const authSt = await chrome.storage.local.get({ qt_google_authed: false });
        if (!authSt.qt_google_authed) {
          return { ok: false, error: "Not logged in. Please log in first." };
        }
        
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
        info(`Deleted task from Google Tasks: ${key}`);
        return { ok: true };
      } catch (e) {
        console.error("[QuackTask/bg] DELETE_FROM_GOOGLE_TASKS error:", e);
        // Token is bad or API failed - mark as logged out
        await chrome.storage.local.set({ qt_google_authed: false });
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
        if (DEBUG) log("Added to blacklist:", assignment);
        return { ok: true };
      } catch (e) {
        console.error("[QuackTask/bg] ADD_BLACKLIST error:", e);
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
        if (DEBUG) log("Removed from blacklist:", assignment);
        return { ok: true };
      } catch (e) {
        console.error("[QuackTask/bg] REMOVE_BLACKLIST error:", e);
        return { ok: false, error: String(e) };
      }
    }

    case "GET_BLACKLIST": {
      try {
        const st = await chrome.storage.local.get({ qt_blacklist: [] });
        const blacklist = Array.isArray(st.qt_blacklist) ? st.qt_blacklist : [];
        return blacklist;
      } catch (e) {
        console.error("[QuackTask/bg] GET_BLACKLIST error:", e);
        return [];
      }
    }

    default:
      return { ok: false, error: "Unknown message" };
  }
}
