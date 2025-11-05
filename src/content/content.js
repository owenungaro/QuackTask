// src/content/content.js
(() => {
  const TAG = "[QuackTask/content]";
  const HOME_OK = (() => {
    try {
      const u = new URL(location.href);
      return (
        u.origin === "https://sit.instructure.com" &&
        (u.pathname === "/" ||
          (u.pathname === "/" && u.search.includes("login_success=1")))
      );
    } catch {
      return false;
    }
  })();

  // simple gated logger
  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);
  const err = (...args) => console.error(TAG, ...args);

  if (!HOME_OK) {
    log("Not on Canvas home, skipping scrape. url=", location.href);
    return;
  }

  // Kick off immediately (and again after SPA re-render)
  run().catch((e) => err("initial run() failed:", e));
  // Canvas re-renders the right rail — try again shortly after load
  setTimeout(() => run().catch((e) => err("delayed run() failed:", e)), 1200);

  async function run() {
    log("Scrape start…");

    // 1) Planner API
    let planner = [];
    try {
      planner = await fetchPlannerAssignmentsWindow(14, 90, { verbose: true });
      log("Planner API items total:", planner.length, planner);
    } catch (e) {
      err("Planner API failed:", e);
    }

    // 2) DOM fallback (To-Do list) if planner looks fishy / empty
    let domFallback = [];
    if (planner.length === 0) {
      try {
        domFallback = scrapeDomTodo({ verbose: true });
        log("DOM fallback items:", domFallback.length, domFallback);
      } catch (e) {
        err("DOM fallback failed:", e);
      }
    }

    const data = planner.length ? planner : domFallback;
    log("Final scraped set:", data.length);

    // 3) Store in background
    try {
      const res = await chrome.runtime.sendMessage({
        type: "STORE_SCRAPED_DATA",
        data,
      });
      log("STORE_SCRAPED_DATA response:", res);
    } catch (e) {
      err("STORE_SCRAPED_DATA message failed:", e);
    }
  }

  // ---------- Helpers ----------
  async function fetchPlannerAssignmentsWindow(
    daysBack = 14,
    daysForward = 90,
    { verbose = false } = {}
  ) {
    const start = new Date();
    start.setDate(start.getDate() - daysBack);
    const end = new Date();
    end.setDate(end.getDate() + daysForward);

    const base =
      `${location.origin}/api/v1/planner/items` +
      `?start_date=${encodeURIComponent(start.toISOString())}` +
      `&end_date=${encodeURIComponent(end.toISOString())}` +
      `&per_page=100`;

    const items = await getAllPages(base, { verbose });

    if (verbose) log("Planner raw length:", items.length, items.slice(0, 5));

    const filtered = items.filter((it) => {
      const keep =
        it?.plannable_type?.toLowerCase() === "assignment" && !!it?.plannable;
      if (verbose && !keep) {
        log("Filtering out non-assignment/plannable:", {
          type: it?.plannable_type,
          plannable: !!it?.plannable,
          title: it?.plannable?.title,
        });
      }
      return keep;
    });

    const mapped = filtered.map(mapPlannerToCard);
    if (verbose)
      log("Planner mapped length:", mapped.length, mapped.slice(0, 5));
    return mapped;
  }

  async function getAllPages(firstUrl, { verbose = false } = {}) {
    const results = [];
    let url = firstUrl;
    let page = 1;
    while (url) {
      if (verbose) log(`GET page ${page}:`, url);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Canvas HTTP ${res.status}`);
      const json = await res.json();
      results.push(...json);
      const next = nextFromLink(res.headers.get("link"));
      if (verbose) log(`page ${page} got ${json.length} items; next:`, !!next);
      url = next;
      page += 1;
    }
    return results;
  }

  function nextFromLink(linkHeader) {
    if (!linkHeader) return null;
    const parts = linkHeader.split(",");
    for (const p of parts) {
      const m = p.match(/<([^>]+)>;\s*rel="next"/i);
      if (m) return m[1];
    }
    return null;
  }

  function mapPlannerToCard(item) {
    const p = item.plannable || {};
    const title = (p.title || "").trim();
    const href = absolutize(p.html_url || item.html_url || "");
    const dueISO = p.due_at || item.plannable_date || null;
    const course =
      item.context_name ||
      item.course_name ||
      fromContextCode(item.context_code) ||
      "";

    return {
      course: (course || "").trim(),
      assignment: title,
      href,
      rfc3339Due: dueISO || null,
      dueText: dueISO ? prettyDate(dueISO) : "No Due Date",
    };
  }

  function fromContextCode(code) {
    if (!code) return "";
    const [kind, id] = String(code).split("_");
    return kind && id
      ? `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${id}`
      : code;
  }

  function absolutize(url) {
    try {
      return new URL(url, location.origin).toString();
    } catch {
      return url;
    }
  }

  function prettyDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Best-effort DOM fallback to the native To-Do list (class names can change)
  function scrapeDomTodo({ verbose = false } = {}) {
    const items = [];
    // Canvas has used both #planner-todosidebar-item-list and data-testid selectors
    const root =
      document.querySelector("#planner-todosidebar-item-list") ||
      document.querySelector('[data-testid="ToDoSidebar"]');

    if (!root) {
      warn("No To-Do DOM root found.");
      return items;
    }

    const links = root.querySelectorAll(
      "a[href*='/assignments/'], a[href*='/quizzes/'], a[href*='/discussion_topics/']"
    );
    if (verbose) log("DOM fallback found link count:", links.length);

    links.forEach((a) => {
      const title = (a.textContent || "").trim();
      const href = absolutize(a.getAttribute("href") || a.href || "");
      const card =
        a.closest("[data-testid='ToDoSidebarItem__Info']") ||
        a.closest(".ToDoSidebarItem") ||
        a.parentElement;

      let course = "";
      let dueText = "No Due Date";

      if (card) {
        const courseEl = card.querySelector(
          "[data-testid='todo-sidebar-item-title'] ~ span, .css-79wf76-text"
        );
        const dueEl = card.querySelector(
          "[data-testid='ToDoSidebarItem__InformationRow'] li, li"
        );
        if (courseEl) course = (courseEl.textContent || "").trim();
        if (dueEl) dueText = (dueEl.textContent || "").trim();
      }

      items.push({
        course,
        assignment: title,
        href,
        rfc3339Due: null, // unknown in DOM fallback
        dueText,
      });
    });

    return items;
  }
})();
