// src/content/content.js
(() => {
  const TAG = "[QuackTask/content]";
  const HOME_OK = (() => {
    try {
      const u = new URL(location.href);
      // Check that host is a Canvas instance (for now, Instructure-hosted)
      const isCanvasHost = u.hostname.endsWith(".instructure.com");
      if (!isCanvasHost) return false;
      
      // Check that we're on the dashboard path
      const isDashboardPath = u.pathname === "/";
      if (!isDashboardPath) return false;
      
      // Additional safety: check for Canvas DOM markers if available
      // This helps avoid false positives on non-Canvas pages
      if (document.body) {
        const hasCanvasBody = document.body.classList.contains("ic-app");
        const hasDashboardCards = document.querySelector(".ic-DashboardCard") !== null;
        // If DOM is loaded, require at least one Canvas marker
        if (document.readyState !== "loading") {
          return hasCanvasBody || hasDashboardCards;
        }
      }
      
      // If DOM isn't ready yet, trust the URL check
      return true;
    } catch {
      return false;
    }
  })();

  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  if (!HOME_OK) {
    log("Not on Canvas home, skipping scrape. url=", location.href);
    return;
  }

  run().catch((e) => err("initial run() failed:", e));
  setTimeout(() => run().catch((e) => err("delayed run() failed:", e)), 1200);

  // ---------- Extract course name mapping ----------
  async function extractCourseNameMapping({ waitMs = 1000, tries = 5 } = {}) {
    for (let i = 0; i < tries; i++) {
      const cards = document.querySelectorAll(".ic-DashboardCard");
      if (cards.length) break;
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const byId = Object.create(null);
    const byCode = Object.create(null);

    document.querySelectorAll(".ic-DashboardCard").forEach((card) => {
      const header = card.querySelector(".ic-DashboardCard__header_content");
      if (!header) return;

      const codeEl = header.querySelector(
        'h2[data-testid="dashboard-card-title"]'
      );
      const nameEl = header.querySelector(".ic-DashboardCard__header-subtitle");
      const a = card.querySelector("a[href*='/courses/']");

      const courseCode = (codeEl?.textContent || "").trim();
      const courseName = (nameEl?.textContent || "").trim();

      if (a) {
        const m = a.getAttribute("href")?.match(/\/courses\/(\d+)/);
        if (m) {
          const cid = m[1];
          if (courseName) byId[cid] = courseName;
        }
      }
      if (courseCode && courseName) {
        byCode[courseCode] = courseName;
      }
    });

    return { byId, byCode };
  }

  // ---------- Main scrape ----------
  async function run() {
    log("Scrape start…");

    const courseNameMapping = await extractCourseNameMapping();
    if (
      Object.keys(courseNameMapping.byId).length ||
      Object.keys(courseNameMapping.byCode).length
    ) {
      log("Course name mapping extracted:", courseNameMapping);
    }

    let planner = [];
    try {
      planner = await fetchPlannerAssignmentsWindow(14, 90, {
        verbose: true,
        courseNameMapping,
      });
      log("Planner API items total:", planner.length, planner);
    } catch (e) {
      err("Planner API failed:", e);
    }

    let domFallback = [];
    if (planner.length === 0) {
      try {
        domFallback = scrapeDomTodo({ verbose: true });
        log("DOM fallback items:", domFallback.length, domFallback);
      } catch (e) {
        err("DOM fallback failed:", e);
      }
    }

    let grading = [];
    try {
      grading = await fetchGradingTodos({ verbose: true, courseNameMapping });
      log("Grading todos items:", grading.length, grading);
    } catch (e) {
      err("Grading todos failed:", e);
    }

    const baseAssignments = planner.length ? planner : domFallback;
    const data = baseAssignments.concat(grading);
    log("Final scraped set:", data.length);

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
    { verbose = false, courseNameMapping = { byId: {}, byCode: {} } } = {}
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

    const filteredOut = [];
    const keptTasks = [];

    const filtered = items.filter((it) => {
      const plannableType = it?.plannable_type?.toLowerCase();
      const hasPlannable = !!it?.plannable;
      const isAnnouncement = plannableType === "announcement";

      if (isAnnouncement || !hasPlannable) {
        if (verbose)
          filteredOut.push({
            type: plannableType,
            title: it?.plannable?.title || "N/A",
          });
        return false;
      }

      if (verbose)
        keptTasks.push({
          type: plannableType,
          title: it?.plannable?.title || "N/A",
          course: it?.context_name || "N/A",
        });
      return true;
    });

    if (verbose && filteredOut.length) log("Filtered out items:", filteredOut);
    if (verbose && keptTasks.length) log("All kept tasks:", keptTasks);

    const mapped = filtered.map((item) =>
      mapPlannerToCard(item, courseNameMapping)
    );
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
      page++;
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

  function mapPlannerToCard(
    item,
    courseNameMapping = { byId: {}, byCode: {} }
  ) {
    const p = item.plannable || {};
    const title = (p.title || "").trim();
    const href = absolutize(p.html_url || item.html_url || "");
    const dueISO = p.due_at || item.plannable_date || null;

    const courseCode = (item.context_name || "").trim();
    const courseId = (String(item.context_code || "").match(/course_(\d+)/) ||
      [])[1];

    let courseName =
      (courseId && courseNameMapping.byId[courseId]) ||
      (courseCode && courseNameMapping.byCode[courseCode]) ||
      (item.course_name || "").trim();

    if (!courseName)
      courseName = courseCode || fromContextCode(item.context_code) || "";

    return {
      course: courseName,
      courseCode,
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

  function scrapeDomTodo({ verbose = false } = {}) {
    const items = [];
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
        rfc3339Due: null,
        dueText,
      });
    });

    return items;
  }

  async function fetchGradingTodos({
    verbose = false,
    courseNameMapping = { byId: {}, byCode: {} },
  } = {}) {
    const base = `${location.origin}/api/v1/users/self/todo?per_page=100`;

    let items = [];
    try {
      items = await getAllPages(base, { verbose });
    } catch (e) {
      if (verbose) err("Grading todos API failed:", e);
      return [];
    }

    if (verbose) log("Todo API raw length:", items.length, items.slice(0, 5));

    const gradingItems = items.filter(
      (it) => it.type && it.type.toLowerCase() === "grading"
    );

    if (verbose) log("Grading items filtered:", gradingItems.length);

    const mapped = gradingItems.map((item) =>
      mapGradingTodoToCard(item, courseNameMapping)
    );
    if (verbose)
      log("Grading todos mapped length:", mapped.length, mapped.slice(0, 5));
    return mapped;
  }

  function mapGradingTodoToCard(
    item,
    courseNameMapping = { byId: {}, byCode: {} }
  ) {
    const assignmentObj = item.assignment || {};
    const title = (assignmentObj.name || "").trim();
    const href = absolutize(assignmentObj.html_url || item.html_url || "");
    const rfc3339Due = assignmentObj.due_at || null;

    const courseId = String(assignmentObj.course_id || "");
    let course =
      (courseId && courseNameMapping.byId[courseId]) ||
      (item.context_name || "").trim() ||
      "";

    const courseCode = (item.context_name || "").trim();

    return {
      course,
      courseCode,
      assignment: `Grade: ${title}`,
      href,
      rfc3339Due,
      dueText: rfc3339Due ? prettyDate(rfc3339Due) : "Grading needed",
      isGrading: true,
    };
  }
})();
