// content.js
(() => {
  console.log("QuackTask: scraping assignments via Canvas API…");

  const fmtDue = (iso) => {
    if (!iso) return "No Due Date";
    const d = new Date(iso);
    const mon = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][d.getMonth()];
    const day = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${mon} ${day} at ${h}:${m} ${ampm}`;
  };

  const withOrigin = (url) =>
    url ? (url.startsWith("http") ? url : `${location.origin}${url}`) : null;

  Promise.all([
    // All todo items for the logged-in user
    fetch("/api/v1/users/self/todo?per_page=100", {
      credentials: "include",
    }).then((r) => (r.ok ? r.json() : [])),
    // Course names for nice labels (optional, but helps build "Course → Assignment")
    fetch("/api/v1/courses?enrollment_state=active&per_page=100", {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ])
    .then(([todos, courses]) => {
      const courseNameById = {};
      for (const c of courses || []) {
        courseNameById[c.id] = c.name || c.course_code || `Course ${c.id}`;
      }

      const tasks = [];
      const seen = new Set();

      for (const t of todos || []) {
        // Canvas returns a mix; we care about assignments
        const a = t.assignment || t;
        const title = a.name || t.title;
        const url = withOrigin(a.html_url || t.html_url || t.url);

        // Try to get a course id from either the object or the URL
        let courseId = a.course_id || t.course_id;
        if (!courseId && url) {
          const m = url.match(/\/courses\/(\d+)\//);
          if (m) courseId = Number(m[1]);
        }
        const course = courseNameById[courseId] || `Course ${courseId ?? "?"}`;

        const dueISO = a.due_at || t.due;
        const dueText = fmtDue(dueISO);

        if (title && url) {
          const key = `${course}||${title}||${url}`;
          if (!seen.has(key)) {
            seen.add(key);
            tasks.push({
              course,
              assignment: title,
              href: url,
              dueDate: dueText, // your popup parses this string
              completed: false,
            });
          }
        }
      }

      console.log("QuackTask assignments scraped from Canvas API:", tasks);
      chrome.runtime.sendMessage(
        { type: "STORE_SCRAPED_DATA", data: tasks },
        () => console.log("QuackTask: tasks saved to storage.")
      );
    })
    .catch((err) => {
      console.warn("QuackTask: Canvas API scrape failed:", err);
    });
})();
