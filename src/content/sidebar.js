// src/content/sidebar.js
// QuackTask Canvas sidebar (content script)

(() => {
  /* ---------------------- constants / ids ---------------------- */
  const WIDGET_ID = "quacktask-sidebar";
  const BODY_ID = "quacktask-body";
  const SELECT_ID = "qt-folder-select";
  const BTN_BLACKLIST_ID = "qt-open-blacklist";
  const BTN_AUTH_ID = "qt-auth-toggle";

  // Overlay panel for blacklist (new, reliable)
  const BL_OVERLAY_ID = "qt-bl-overlay";
  const BL_PANEL_ID = "qt-bl-panel";
  const BL_HEAD_ID = "qt-bl-head";
  const BL_LIST_ID = "qt-bl-list";

  const DASH_URLS = [
    "https://sit.instructure.com/",
    "https://sit.instructure.com/?login_success=1",
  ];

  const LOG = (...a) => console.log("[QuackTask]", ...a);
  const $ = (sel, root = document) => root.querySelector(sel);

  /* ---------------------- small utils ---------------------- */
  const onDashboard = () => DASH_URLS.some((u) => location.href === u);
  const rightAside = () => document.getElementById("right-side");

  const sendBg = (payload) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => resolve(resp));
      } catch {
        resolve(null);
      }
    });

  const escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );

  const taskKey = (t) =>
    `${t.course || t.courseCode || ""} → ${t.assignment || ""}`;

  const greyRowButtons = (row, on) =>
    row.querySelectorAll(".qtask-btn").forEach((b) => (b.disabled = on));

  /* ---------------------- mount / shell ---------------------- */
  function mountShell(parent) {
    const old = document.getElementById(WIDGET_ID);
    if (old && old.parentElement) old.parentElement.removeChild(old);

    const wrap = document.createElement("div");
    wrap.id = WIDGET_ID;
    wrap.innerHTML = `
      <header>
        <h3>QuackTask</h3>
      </header>

      <div class="qtask-controls">
        <div class="qt-select-row">
          <select id="${SELECT_ID}" class="qtask-select" aria-label="Google Task list"></select>
        </div>
        <div class="qt-actions-row">
          <button id="${BTN_BLACKLIST_ID}" type="button" class="qtask-btn qtask-del">Blacklist</button>
          <button id="${BTN_AUTH_ID}" type="button" class="qtask-btn qtask-del" data-mode="login">Login</button>
        </div>
      </div>

      <div id="${BODY_ID}">
        <div class="qtask-empty">Loading...</div>
      </div>
    `;

    parent.prepend(wrap);
    LOG("sidebar boot @", location.href);

    // Make the body scrollable so the page doesn't grow forever
    const body = document.getElementById(BODY_ID);
    if (body) {
      body.style.maxHeight = "60vh";
      body.style.overflow = "auto";
    }

    wireControls();
  }

  function updateAuthUI(authed) {
    const btn = document.getElementById(BTN_AUTH_ID);
    const sel = document.getElementById(SELECT_ID);
    if (!btn) return;

    if (authed) {
      btn.textContent = "Logout";
      btn.dataset.mode = "logout";
      if (sel) sel.disabled = false;
    } else {
      btn.textContent = "Login";
      btn.dataset.mode = "login";
      if (sel) sel.disabled = true;
    }
  }

  async function wireControls() {
    const blBtn = document.getElementById(BTN_BLACKLIST_ID);
    if (blBtn) blBtn.onclick = () => openBlacklistOverlay();

    const authBtn = document.getElementById(BTN_AUTH_ID);
    if (authBtn) {
      authBtn.onclick = async () => {
        const mode = authBtn.dataset.mode;
        LOG("auth button clicked:", mode);
        if (mode === "login") {
          const resp = await sendBg({ type: "LOGIN" });
          if (resp?.success) {
            updateAuthUI(true);
            const sel = document.getElementById(SELECT_ID);
            if (sel) await fillTaskLists(sel);
          }
        } else {
          await sendBg({ type: "LOGOUT" });
          updateAuthUI(false);
          const sel = document.getElementById(SELECT_ID);
          if (sel) {
            sel.innerHTML = "";
            const opt = document.createElement("option");
            opt.textContent = "Login required";
            sel.appendChild(opt);
          }
        }
      };
    }

    const sel = document.getElementById(SELECT_ID);
    if (sel) {
      const authed = await fillTaskLists(sel);
      updateAuthUI(authed);
    }
  }

  // returns boolean authed?
  async function fillTaskLists(sel) {
    try {
      sel.innerHTML = "";
      const loading = document.createElement("option");
      loading.textContent = "Loading lists…";
      sel.appendChild(loading);

      const resp = await sendBg({ type: "GET_GOOGLE_LISTS" });
      sel.innerHTML = "";

      if (!resp || resp.authed === false) {
        const opt = document.createElement("option");
        opt.textContent = "Login required";
        sel.appendChild(opt);
        return false;
      }

      const lists = Array.isArray(resp?.lists) ? resp.lists : [];
      if (!lists.length) {
        const opt = document.createElement("option");
        opt.textContent = "No Google Task lists";
        sel.appendChild(opt);
        return true;
      }

      for (const l of lists) {
        const opt = document.createElement("option");
        opt.value = l.id;
        opt.textContent = l.title || "(untitled)";
        sel.appendChild(opt);
      }

      // choose saved or default to first, then persist it
      chrome.storage.local.get({ qt_selected_list: null }, (st) => {
        const chosen = st.qt_selected_list || (lists[0] && lists[0].id);
        if (chosen) {
          sel.value = chosen;
          chrome.storage.local.set({ qt_selected_list: chosen });
        }
      });

      sel.addEventListener("change", async () => {
        chrome.storage.local.set({ qt_selected_list: sel.value });
        // Sync when list changes
        try {
          await sendBg({ type: "SYNC_WITH_GOOGLE_TASKS" });
          renderFromStorage(); // Refresh the display
        } catch (e) {
          LOG("Sync after list change failed:", e);
        }
      });

      // Trigger initial sync if authed
      if (lists.length > 0) {
        try {
          await sendBg({ type: "SYNC_WITH_GOOGLE_TASKS" });
          renderFromStorage();
        } catch (e) {
          LOG("Initial sync failed:", e);
        }
      }

      return true;
    } catch (e) {
      LOG("fillTaskLists error", e);
      return false;
    }
  }

  /* ---------------------- render tasks ---------------------- */
  function renderFromStorage() {
    const body = document.getElementById(BODY_ID);
    if (!body) return;

    chrome.storage.local.get(
      ["qt_tasks", "scrapedData", "qt_blacklist"],
      (st) => {
        const tasks = Array.isArray(st.qt_tasks)
          ? st.qt_tasks
          : Array.isArray(st.scrapedData)
          ? st.scrapedData
          : [];

        const blacklist = new Set(st.qt_blacklist || []);
        LOG("render tasks count:", tasks.length, "blacklist:", blacklist.size);

        if (!tasks.length) {
          body.innerHTML = `<div class="qtask-empty">Nothing to show.</div>`;
          return;
        }

        // Filter out blacklisted items and completed tasks
        const visible = tasks.filter((t) => {
          return !blacklist.has(taskKey(t)) && !t._completed_in_google;
        });
        body.innerHTML =
          visible.map(taskRowHTML).join("") ||
          `<div class="qtask-empty">Nothing to show.</div>`;

        body.querySelectorAll("[data-act='add']").forEach((btn) => {
          btn.addEventListener("click", onAddClick);
        });
        body.querySelectorAll("[data-act='del']").forEach((btn) => {
          btn.addEventListener("click", onDeleteClick);
        });
        body.querySelectorAll("[data-act='hide']").forEach((btn) => {
          btn.addEventListener("click", onHideClick);
        });
      }
    );
  }

  function taskRowHTML(t) {
    const inTasks = !!t._in_google_tasks;
    return `
      <div class="qtask-row" data-key="${taskKey(t)}" data-href="${
      t.href || ""
    }">
        <div>
          <div class="qtask-title"><a href="${t.href || "#"}">${escapeHtml(
      t.assignment || "Untitled"
    )}</a></div>
          <div class="qtask-subtle">${escapeHtml(t.course || "")}${
      t.dueText ? " • " + escapeHtml(t.dueText) : ""
    }</div>
        </div>
        <div class="qtask-actions">
          ${
            inTasks
              ? `<button class="qtask-btn qtask-del" data-act="del">Delete</button>`
              : `<button class="qtask-btn qtask-add" data-act="add">Add</button>
                 <button class="qtask-btn qtask-hide" data-act="hide">Hide</button>`
          }
        </div>
      </div>
    `;
  }

  /* ---------------------- row handlers ---------------------- */
  async function onAddClick(e) {
    const row = e.currentTarget.closest(".qtask-row");
    if (!row) return;
    greyRowButtons(row, true);

    try {
      const listId = $("#" + SELECT_ID)?.value || null;
      const key = row.dataset.key;
      // Notes should only be the URL link
      const notes = row.dataset.href
        ? new URL(row.dataset.href, location.origin).href
        : "";

      const resp = await sendBg({
        type: "ADD_TO_GOOGLE_TASKS",
        listId,
        notes, // Only the link
        key, // The key will be used as the title in the router
      });
      if (resp && resp.ok) {
        row.querySelector(
          ".qtask-actions"
        ).innerHTML = `<button class="qtask-btn qtask-del" data-act="del">Delete</button>`;
        row
          .querySelector("[data-act='del']")
          .addEventListener("click", onDeleteClick);
      }
    } catch (err) {
      LOG("add error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  async function onDeleteClick(e) {
    const row = e.currentTarget.closest(".qtask-row");
    if (!row) return;
    greyRowButtons(row, true);

    try {
      const listId = $("#" + SELECT_ID)?.value || null;
      const key = row.dataset.key;
      const resp = await sendBg({
        type: "DELETE_FROM_GOOGLE_TASKS",
        listId,
        key,
      });
      if (resp && resp.ok) {
        row.querySelector(
          ".qtask-actions"
        ).innerHTML = `<button class="qtask-btn qtask-add" data-act="add">Add</button>
           <button class="qtask-btn qtask-hide" data-act="hide">Hide</button>`;
        row
          .querySelector("[data-act='add']")
          .addEventListener("click", onAddClick);
        row
          .querySelector("[data-act='hide']")
          .addEventListener("click", onHideClick);
      } else {
        LOG("delete failed:", resp?.error || "Unknown error");
        const errTxt = String(resp?.error || "");
        // treat not-found or 404/410 as already-deleted
        if (
          errTxt.includes("Not found") ||
          errTxt.includes("404") ||
          errTxt.includes("410")
        ) {
          row.querySelector(
            ".qtask-actions"
          ).innerHTML = `<button class="qtask-btn qtask-add" data-act="add">Add</button>
             <button class="qtask-btn qtask-hide" data-act="hide">Hide</button>`;
          row
            .querySelector("[data-act='add']")
            .addEventListener("click", onAddClick);
          row
            .querySelector("[data-act='hide']")
            .addEventListener("click", onHideClick);
        }
      }
    } catch (err) {
      LOG("delete error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  async function onHideClick(e) {
    const row = e.currentTarget.closest(".qtask-row");
    if (!row) return;
    greyRowButtons(row, true);

    try {
      const key = row.dataset.key;
      const resp = await sendBg({ type: "ADD_BLACKLIST", assignment: key });
      if (resp && resp.ok) {
        row.remove();
      } else {
        LOG("hide error", resp?.error || "Unknown error");
      }
    } catch (err) {
      LOG("hide error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  /* ---------------------- blacklist overlay (reliable) ---------------------- */
  function ensureOverlay() {
    let overlay = document.getElementById(BL_OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = BL_OVERLAY_ID;
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483646;
      background: rgba(17,24,39,0.28);
      display: none;
    `;

    const panel = document.createElement("div");
    panel.id = BL_PANEL_ID;
    panel.style.cssText = `
      position: fixed; top: 12vh; left: 50%;
      transform: translateX(-50%);
      width: min(480px, 92vw);
      max-height: 70vh; overflow: auto;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      user-select: none;
    `;

    panel.innerHTML = `
      <div id="${BL_HEAD_ID}" style="cursor:move; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-bottom:1px solid #eee; background:#fafafa; border-top-left-radius:12px; border-top-right-radius:12px;">
        <h4 style="margin:0; font-size:13px; font-weight:800; color:#111827;">Hidden (Blacklist)</h4>
        <button type="button" id="qt-bl-close" class="qtask-btn qtask-del">Close</button>
      </div>
      <div style="padding:10px 12px 12px;">
        <div id="${BL_LIST_ID}" style="display:flex; flex-direction:column; gap:8px;"></div>
      </div>
    `;

    overlay.appendChild(panel);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.id === "qt-bl-close") {
        overlay.style.display = "none";
      }
    });

    makeDraggable(panel, $("#" + BL_HEAD_ID, panel));

    return overlay;
  }

  function openBlacklistOverlay() {
    LOG("open blacklist popup");
    const overlay = ensureOverlay();
    overlay.style.display = "block";
    renderBlacklistList();
  }

  async function renderBlacklistList() {
    const list = document.getElementById(BL_LIST_ID);
    if (!list) return;
    list.innerHTML = `<div class="qtask-subtle">Loading…</div>`;

    try {
      const items = await sendBg({ type: "GET_BLACKLIST" });
      LOG("renderBlacklistPopup: items =", items);

      if (!items || !items.length) {
        list.innerHTML = `<div class="qtask-subtle">No hidden items.</div>`;
        return;
      }

      list.innerHTML = items
        .map(
          (name) => `
          <div class="qt-bl-item" style="display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; padding:8px 10px; border:1px solid #eee; border-radius:10px; background:#fafafa;">
            <div class="qt-bl-name" style="font-size:12px; color:#111827; font-weight:600; word-break:break-word;">${escapeHtml(
              name
            )}</div>
            <button class="qtask-btn qtask-del" data-name="${escapeHtml(
              name
            )}">Unhide</button>
          </div>`
        )
        .join("");

      list.querySelectorAll("button[data-name]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const name = e.currentTarget.getAttribute("data-name");
          e.currentTarget.disabled = true;
          await sendBg({ type: "REMOVE_BLACKLIST", assignment: name });
          renderBlacklistList(); // refresh
        });
      });
    } catch (e) {
      LOG("renderBlacklistPopup error", e);
      list.innerHTML = `<div class="qtask-subtle">Failed to load blacklist.</div>`;
    }
  }

  function makeDraggable(panel, handle) {
    if (!handle) return;
    let dragging = false;
    let sx = 0,
      sy = 0,
      startLeft = 0,
      startTop = 0;

    const getNumbers = (s) => parseFloat(s || "0") || 0;

    const onDown = (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panel.style.transform = "none";
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;

      sx = e.clientX;
      sy = e.clientY;
      startLeft = getNumbers(panel.style.left);
      startTop = getNumbers(panel.style.top);

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { once: true });
    };

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
    };

    const onUp = () => {
      dragging = false;
      document.removeEventListener("mousemove", onMove);
    };

    handle.addEventListener("mousedown", onDown);
  }

  /* ---------------------- observers ---------------------- */
  function watchForRerender() {
    const obs = new MutationObserver(() => {
      const parent = rightAside();
      if (parent && !document.getElementById(WIDGET_ID) && onDashboard()) {
        LOG("sidebar re-attaching after Canvas re-render");
        mountShell(parent);
        renderFromStorage();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function watchStorage() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.qt_tasks || changes.scrapedData || changes.qt_blacklist) {
        renderFromStorage();
        const overlay = document.getElementById(BL_OVERLAY_ID);
        if (overlay && overlay.style.display === "block") {
          renderBlacklistList();
        }
      }
    });
  }

  /* ---------------------- boot ---------------------- */
  function boot() {
    if (!onDashboard()) return;
    const parent = rightAside();
    if (!parent) return;
    mountShell(parent);
    renderFromStorage();
    // ensure we always refresh from Google after mount
    sendBg({ type: "SYNC_WITH_GOOGLE_TASKS" }).then(() => renderFromStorage());
    watchForRerender();
    watchStorage();
  }

  try {
    boot();
  } catch (e) {
    LOG("boot error", e);
  }
})();
