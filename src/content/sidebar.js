// src/content/sidebar.js
// QuackTask Canvas sidebar (content script)

(() => {
  /* ---------------------- constants / ids ---------------------- */
  const WIDGET_ID = "quacktask-sidebar";
  const BODY_ID = "quacktask-body";
  const SELECT_ID = "qt-folder-select";
  const BTN_BLACKLIST_ID = "qt-open-blacklist";
  const BTN_AUTH_ID = "qt-auth-toggle";
  const BTN_HELP_ID = "qt-help";

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

  /* ---------------------- theme engine ---------------------- */
  function hexToRgb(hex) {
    const c = hex.replace('#', '');
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  }

  function parseColorToRgb(color) {
    if (!color) return null;
    color = color.trim();
    
    // Handle hex
    if (color.startsWith('#')) {
      if (color.length >= 7) {
        return hexToRgb(color);
      }
      return null;
    }
    
    // Handle rgb/rgba
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    }
    
    return null;
  }

  function luminance([r, g, b]) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function mix(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function lighten(color, t = 0.08) {
    const rgb = parseColorToRgb(color);
    if (!rgb) return color;
    const [r, g, b] = rgb;
    return `#${[mix(r, 255, t), mix(g, 255, t), mix(b, 255, t)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  }

  function darken(color, t = 0.08) {
    const rgb = parseColorToRgb(color);
    if (!rgb) return color;
    const [r, g, b] = rgb;
    return `#${[mix(r, 0, t), mix(g, 0, t), mix(b, 0, t)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  }

  // Slightly darken very light button backgrounds to improve contrast
  function adjustButtonColorForReadability(color) {
    const rgb = parseColorToRgb(color);
    if (!rgb) return color;
    const L = luminance(rgb);
    // If background is too bright, darken it slightly
    if (L > 180) {
      return darken(color, 0.1); // adjust by about 10%
    }
    return color;
  }

  function getCssVar(el, name) {
    return getComputedStyle(el).getPropertyValue(name)?.trim();
  }

  function firstColor(value) {
    if (!value) return null;
    const hex = value.match(/#[0-9a-fA-F]{6}/);
    if (hex) return hex[0];
    const rgb = value.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/);
    return rgb ? rgb[0] + ')' : null;
  }

  // Signature for the built-in BetterCanvas Dark preset (normalized to lowercase)
  const BC_DARK_PRESET = {
    '--bcbackground-0': '#161616',
    '--bcbackground-1': '#1e1e1e',
    '--bcbackground-2': '#262626',
    '--bcborders': '#3c3c3c',
    '--bcbuttons': '#3c3c3c',
    '--bclinks': '#56caf0',
    '--bctext-0': '#f5f5f5',
    '--bctext-1': '#e2e2e2'
  };

  // Read & normalize a CSS var
  function readVar(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim().toLowerCase();
  }

  // True only for the built-in BetterCanvas Dark preset
  function isBuiltInBcDark() {
    // Must be a BetterCanvas page
    if (!document.getElementById('bettercanvas-theme-preset')) return false;

    const el = document.body;
    // Anchor keys are enough; avoid overfitting
    const keys = [
      '--bcbackground-0', '--bcbackground-1', '--bcbackground-2',
      '--bcborders', '--bcbuttons', '--bclinks', '--bctext-0', '--bctext-1'
    ];
    return keys.every(k => {
      const actual = readVar(el, k);
      const expected = BC_DARK_PRESET[k];
      return actual && expected && actual === expected;
    });
  }

  function detectBetterCanvas() {
    const s = getComputedStyle(document.body);
    const bg0 = s.getPropertyValue('--bcbackground-0-ungradient')?.trim();
    const t0 = s.getPropertyValue('--bctext-0')?.trim();
    const link = s.getPropertyValue('--bclinks')?.trim();
    return { bg0, t0, link, has: !!(bg0 || t0 || link) };
  }

  function isDarkByText(color) {
    const rgb = parseColorToRgb(color);
    if (!rgb) return false;
    // If text is light (high luminance), background is dark (dark theme)
    return luminance(rgb) > 160;
  }

  function copyTokensToOverlay(sidebar, overlay) {
    if (!sidebar || !overlay) return;
    const computed = getComputedStyle(sidebar);
    const tokens = [
      '--qt-surface', '--qt-border', '--qt-text', '--qt-subtle', '--qt-accent',
      '--qt-accent-contrast', '--qt-row-hover', '--qt-shadow', '--qt-scrim',
      '--qt-btn-bg', '--qt-btn-bg-hover', '--qt-btn-text', '--qt-btn-border',
      '--qt-add-bg', '--qt-add-bg-hover', '--qt-add-text',
      '--qt-dd-bg', '--qt-dd-text', '--qt-scroll-thumb', '--qt-scroll-thumb-hover',
      '--qt-bl-panel-bg', '--qt-bl-head-bg', '--qt-bl-item-bg', '--qt-bl-item-hover-bg', '--qt-bl-head-text', '--qt-bl-item-text', '--qt-bl-close-text'
    ];
    tokens.forEach(token => {
      const value = computed.getPropertyValue(token);
      if (value) {
        overlay.style.setProperty(token, value);
        const panel = document.getElementById(BL_PANEL_ID);
        if (panel) panel.style.setProperty(token, value);
      }
    });
    
    // Ensure accent tokens are explicitly copied for overlay (Close button and header)
    const accentTokens = ['--qt-assignment-name', '--qt-accent', '--qt-add-bg', '--qt-add-bg-hover'];
    accentTokens.forEach(token => {
      const value = computed.getPropertyValue(token);
      if (value) {
        overlay.style.setProperty(token, value);
        const panel = document.getElementById(BL_PANEL_ID);
        if (panel) panel.style.setProperty(token, value);
      }
    });
  }

  function detectDarkModeFallback() {
    // Try multiple methods to detect dark mode
    const body = document.body;
    const html = document.documentElement;
    
    // Method 1: Check computed background color
    try {
      const bodyBg = getComputedStyle(body).backgroundColor;
      if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') {
        const rgb = parseColorToRgb(bodyBg);
        if (rgb) {
          const L = luminance(rgb);
          if (L < 150) return true;
          if (L > 200) return false;
        }
      }
    } catch (e) {}
    
    // Method 2: Check html background
    try {
      const htmlBg = getComputedStyle(html).backgroundColor;
      if (htmlBg && htmlBg !== 'rgba(0, 0, 0, 0)' && htmlBg !== 'transparent') {
        const rgb = parseColorToRgb(htmlBg);
        if (rgb) {
          const L = luminance(rgb);
          if (L < 150) return true;
          if (L > 200) return false;
        }
      }
    } catch (e) {}
    
    // Method 3: Check if body/html has dark class or data attribute
    if (body.classList.contains('dark') || html.classList.contains('dark')) return true;
    if (body.dataset.theme === 'dark' || html.dataset.theme === 'dark') return true;
    
    // Method 4: Check color scheme media query
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    
    // Default to light
    return false;
  }

  function applyTokens(root) {
    const el = root || document.getElementById(WIDGET_ID);
    if (!el) {
      LOG("applyTokens: element not found");
      return;
    }
    
    const bc = detectBetterCanvas();
    LOG("applyTokens: BetterCanvas detected:", bc.has, bc);

    const MAROON = '#9D1535';
    const SURF_LIGHT = '#ffffff';
    const SURF_DARK = '#1f2937'; // neutral dark surface fallback
    const BORDER_L = '#e5e7eb';
    const BORDER_D = '#2d3748';
    const TEXT_L = '#111827';
    const TEXT_D = '#e5e7eb';
    const SUB_L = '#6b7280';
    const SUB_D = '#a3a3a3';

    let surface, text, subtle, accent, ddBg, ddText, border, scrim, shadow;

    if (bc.has) {
      // BetterCanvas mapping
      const bcBg0 = bc.bg0; // --bcbackground-0-ungradient
      const bcBg = getCssVar(document.body, '--bcbackground-0'); // may be a gradient
      const pageBg = getComputedStyle(document.body).backgroundColor;
      surface = bcBg0 || firstColor(bcBg) || pageBg || SURF_LIGHT;
      text = bc.t0 || TEXT_L;
      
      // bc.link is your current BetterCanvas link color mapping
      accent = bc.link || MAROON;
      
      // Special-case ONLY the built-in BC Dark preset
      if (isBuiltInBcDark()) {
        accent = MAROON;
      }
      
      ddBg = getCssVar(document.body, '--bcbackground-0') || surface;
      ddText = getCssVar(document.body, '--bctext-1') || SUB_L;

      const darkMode = isDarkByText(text);
      LOG("applyTokens: BetterCanvas darkMode:", darkMode, "text:", text);
      border = darkMode ? 'rgba(255,255,255,0.12)' : BORDER_L;
      scrim = darkMode ? 'rgba(0,0,0,0.35)' : 'rgba(17,24,39,0.24)';
      shadow = darkMode ? 'rgba(0,0,0,0.35)' : 'rgba(157,21,53,0.12)';

      // Derive neutral button bg from surface
      const btnBg = darkMode ? lighten(surface, 0.06) : darken(surface, 0.06);
      const btnBgHover = darkMode ? lighten(surface, 0.10) : darken(surface, 0.10);
      const btnText = darkMode ? TEXT_D : '#374151';
    } else {
      // Fallback (no BetterCanvas) — detect dark mode from page
      const isDark = detectDarkModeFallback();
      LOG("applyTokens: Fallback mode, isDark:", isDark);

      surface = isDark ? SURF_DARK : SURF_LIGHT;
      text = isDark ? TEXT_D : TEXT_L;
      subtle = isDark ? SUB_D : SUB_L;
      accent = MAROON;
      border = isDark ? 'rgba(255,255,255,0.12)' : BORDER_L;
      scrim = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(17,24,39,0.20)';
      shadow = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(157,21,53,0.12)';

      const btnBg = isDark ? darken(surface, 0.06) : '#f5f5f5';
      const btnBgHover = isDark ? darken(surface, 0.10) : '#eeeeee';
      const btnText = isDark ? TEXT_D : '#374151';
      ddBg = surface;
      ddText = subtle;
    }

    // Ensure we have valid color values
    if (!surface || !text || !accent) {
      LOG("applyTokens: Warning - missing color values", { surface, text, accent });
      return;
    }

    // Apply all tokens - inline styles have high specificity
    el.style.setProperty('--qt-surface', surface);
    el.style.setProperty('--qt-border', border);
    el.style.setProperty('--qt-text', text);
    el.style.setProperty('--qt-subtle', bc.has ? ddText : subtle);
    el.style.setProperty('--qt-accent', accent);
    el.style.setProperty('--qt-accent-contrast', '#ffffff');
    
    // Set assignment name color (default to accent for non-special cases)
    if (!bc.has || !isBuiltInBcDark()) {
      el.style.setProperty('--qt-assignment-name', accent);
    }
    
    // Special-case ONLY the built-in BC Dark preset - override specific tokens
    if (bc.has && isBuiltInBcDark()) {
      el.style.setProperty('--qt-accent', MAROON);
      const adjustedMaroonBg = adjustButtonColorForReadability(MAROON);
      el.style.setProperty('--qt-add-bg', adjustedMaroonBg);
      el.style.setProperty('--qt-add-bg-hover', darken(MAROON, 0.08));
      el.style.setProperty('--qt-assignment-name', MAROON);
    }
    
    const darkMode = bc.has ? isDarkByText(text) : detectDarkModeFallback();
    let rowHover;
    if (!detectDarkModeFallback()) {
      // Light mode – use neutral gray-based highlight and black shadow
      rowHover = '#f9fafb'; // subtle light gray instead of reddish tint
      el.style.setProperty('--qt-shadow', 'rgba(0,0,0,0.15)');
    } else {
      // Dark mode or BetterCanvas dark – keep crimson tones
      rowHover = darken(surface, 0.03);
      el.style.setProperty('--qt-shadow', shadow);
    }
    el.style.setProperty('--qt-row-hover', rowHover);
    el.style.setProperty('--qt-scrim', scrim);

    const btnBg = darkMode ? (bc.has ? lighten(surface, 0.06) : darken(surface, 0.06)) : (bc.has ? darken(surface, 0.06) : '#f5f5f5');
    const btnBgHover = darkMode ? (bc.has ? lighten(surface, 0.10) : darken(surface, 0.10)) : (bc.has ? darken(surface, 0.10) : '#eeeeee');
    const btnText = darkMode ? TEXT_D : '#374151';

    el.style.setProperty('--qt-btn-bg', btnBg);
    el.style.setProperty('--qt-btn-bg-hover', btnBgHover);
    el.style.setProperty('--qt-btn-text', btnText);
    el.style.setProperty('--qt-btn-border', border);

    const adjustedAddBg = adjustButtonColorForReadability(accent);
    el.style.setProperty('--qt-add-bg', adjustedAddBg);
    el.style.setProperty('--qt-add-bg-hover', darken(accent, 0.08));
    el.style.setProperty('--qt-add-text', '#ffffff');

    el.style.setProperty('--qt-dd-bg', bc.has ? ddBg : surface);
    el.style.setProperty('--qt-dd-text', bc.has ? ddText : subtle);
    el.style.setProperty('--qt-scroll-thumb', darkMode ? 'rgba(255,255,255,0.25)' : '#d1d5db');
    el.style.setProperty('--qt-scroll-thumb-hover', darkMode ? 'rgba(255,255,255,0.4)' : accent);

    // Blacklist panel styling - only for fallback (non-BetterCanvas) themes
    if (!bc.has) {
      const isDark = detectDarkModeFallback();
      if (isDark) {
        // Dark mode fallback: dark grey panel, maroon header, white items
        const darkItemBg = darken(SURF_DARK, 0.03); // slightly darker for items
        const darkItemHoverBg = lighten(SURF_DARK, 0.05); // slightly lighter on hover
        el.style.setProperty('--qt-bl-panel-bg', SURF_DARK);
        el.style.setProperty('--qt-bl-head-bg', SURF_DARK); // header background matches panel
        el.style.setProperty('--qt-bl-item-bg', darkItemBg); // item background
        el.style.setProperty('--qt-bl-item-hover-bg', darkItemHoverBg); // item hover background
        el.style.setProperty('--qt-bl-head-text', MAROON);
        el.style.setProperty('--qt-bl-item-text', TEXT_D);
        el.style.setProperty('--qt-bl-close-text', TEXT_D); // white text on maroon button
      } else {
        // Light mode fallback: white panel, default colors, white close button text
        el.style.setProperty('--qt-bl-panel-bg', SURF_LIGHT);
        el.style.setProperty('--qt-bl-head-bg', '#fafafa'); // light grey header background
        el.style.setProperty('--qt-bl-item-bg', '#fafafa'); // light grey item background
        el.style.setProperty('--qt-bl-item-hover-bg', '#fef9fa'); // light item hover background
        el.style.setProperty('--qt-bl-head-text', accent); // use accent/maroon
        el.style.setProperty('--qt-bl-item-text', TEXT_L);
        el.style.setProperty('--qt-bl-close-text', '#ffffff'); // white text on maroon button
      }
    } else {
      // BetterCanvas: use existing variables (don't override)
      // Clear any fallback-specific overrides
      el.style.removeProperty('--qt-bl-panel-bg');
      el.style.removeProperty('--qt-bl-head-bg');
      el.style.removeProperty('--qt-bl-item-bg');
      el.style.removeProperty('--qt-bl-item-hover-bg');
      el.style.removeProperty('--qt-bl-head-text');
      el.style.removeProperty('--qt-bl-item-text');
      el.style.removeProperty('--qt-bl-close-text');
    }

    // Apply or remove text-shadow class depending on theme
    // Text shadow is needed for mid-tone themes where contrast might be low
    // We check button background since that's what the buttons actually render on
    let needsTextShadow = false;
    
    // Check button background luminance (what buttons actually render on)
    const btnBgRgb = parseColorToRgb(btnBg);
    if (btnBgRgb) {
      const btnBgLum = luminance(btnBgRgb);
      const btnTextRgb = parseColorToRgb(btnText);
      const btnTextLum = btnTextRgb ? luminance(btnTextRgb) : 128;
      
      // Check if button background is mid-tone
      // Not clearly light (luminance > 200) and not clearly dark (luminance < 80)
      // Mid-tone range: 80-200
      const isClearlyLight = btnBgLum > 200;
      const isClearlyDark = btnBgLum < 80;
      const isMidTone = !isClearlyLight && !isClearlyDark;
      
      // Also check contrast between button text and background
      const contrast = Math.abs(btnTextLum - btnBgLum);
      const lowContrast = contrast < 130;
      
      // Enable text shadow for mid-tone themes (not clearly light or dark)
      // or when contrast between text and background is low
      needsTextShadow = isMidTone || (lowContrast && btnBgLum > 50 && btnBgLum < 210);
      
      LOG("Text shadow check: btnBg=", btnBg, "btnBgLum=", btnBgLum, 
          "btnTextLum=", btnTextLum, "contrast=", contrast.toFixed(1),
          "isMidTone=", isMidTone, "needsTextShadow=", needsTextShadow);
    }
    
    if (needsTextShadow) {
      el.classList.add('qt-has-textshadow');
      LOG("Added qt-has-textshadow class to sidebar");
    } else {
      el.classList.remove('qt-has-textshadow');
      LOG("Removed qt-has-textshadow class from sidebar");
    }
    
    // Force background update - CSS uses var(--qt-surface) which should pick this up
    // But we'll also set it directly as a backup
    requestAnimationFrame(() => {
      el.style.background = surface;
      el.style.backgroundColor = surface;
    });
    
    LOG("applyTokens: Applied tokens, surface:", surface, "text:", text, "accent:", accent, "darkMode:", darkMode);
  }

  // Per-page gate: base state is "loading". We only allow rendering
  // real content after the first sync returns on THIS page load.
  let PAGE_GATE_OPEN = false;

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

      <!-- Controls are hidden in the BASE state; they appear when ready -->
      <div class="qtask-controls" data-gated="ready" style="display:none">
        <div class="qt-select-row">
          <select id="${SELECT_ID}" class="qtask-select" aria-label="Google Task list"></select>
        </div>
        <div class="qt-actions-row">
          <button id="${BTN_BLACKLIST_ID}" type="button" class="qtask-btn qtask-del">Blacklist</button>
          <button id="${BTN_AUTH_ID}" type="button" class="qtask-btn qtask-del" data-mode="login">Login</button>
          <button id="${BTN_HELP_ID}" type="button" class="qtask-btn qtask-del">Help</button>
        </div>
      </div>

      <div id="${BODY_ID}">
        <!-- BASE state: empty list with loading text -->
        <div class="qtask-empty">Loading tasks…</div>
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

    // Apply theme tokens immediately
    applyTokens(wrap);
    
    // Also apply after a short delay to catch BetterCanvas if it loads late
    setTimeout(() => {
      applyTokens(wrap);
    }, 100);
    
    // And again after a longer delay for BetterCanvas that loads very late
    setTimeout(() => {
      applyTokens(wrap);
    }, 1000);

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

  // Show/hide the entire controls block (dropdown + buttons) when ready
  function setReadyUI(ready) {
    const controls = document.querySelector('[data-gated="ready"]');
    if (controls) controls.style.display = ready ? "" : "none";
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

    const helpBtn = document.getElementById(BTN_HELP_ID);
    if (helpBtn) {
      helpBtn.onclick = () => {
        // Placeholder for help functionality
        LOG("help button clicked");
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

      // Trigger initial sync if authed (dropdown still hidden until ready)
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
      ["qt_tasks", "scrapedData", "qt_blacklist", "qt_ready"],
      (st) => {
        // We only show content after:
        // 1) background says the data is accurate (qt_ready === true), AND
        // 2) the first sync has returned on THIS page load (PAGE_GATE_OPEN)
        const ready = st.qt_ready === true && PAGE_GATE_OPEN;

        // Toggle controls visibility with the same gate
        setReadyUI(ready);

        if (!ready) {
          body.innerHTML = `<div class="qtask-empty">Loading tasks…</div>`;
          return;
        }

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

    const panel = document.createElement("div");
    panel.id = BL_PANEL_ID;

    panel.innerHTML = `
      <div id="${BL_HEAD_ID}">
        <h4>Hidden (Blacklist)</h4>
        <button type="button" id="qt-bl-close" class="qtask-btn qtask-add">Close</button>
      </div>
      <div id="${BL_LIST_ID}"></div>
    `;

    // Immediately sync theme tokens so header color matches assignment titles
    const sidebar = document.getElementById(WIDGET_ID);
    if (sidebar) {
      copyTokensToOverlay(sidebar, overlay);
    }

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
    
    // Ensure overlay has current theme tokens
    const sidebar = document.getElementById(WIDGET_ID);
    if (sidebar) {
      copyTokensToOverlay(sidebar, overlay);
    }
    
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
          <div class="qt-bl-item">
            <div class="qt-bl-name">${escapeHtml(name)}</div>
            <button class="qtask-btn qtask-del" data-name="${escapeHtml(name)}">Unhide</button>
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
        // Tokens are applied in mountShell, but ensure they're applied here too
        setTimeout(() => {
          const sidebar = document.getElementById(WIDGET_ID);
          if (sidebar) applyTokens(sidebar);
        }, 100);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function watchBetterCanvasTheme() {
    const themeStyle = document.getElementById('bettercanvas-theme-preset');
    if (!themeStyle) return;

    const obs = new MutationObserver(() => {
      const sidebar = document.getElementById(WIDGET_ID);
      if (sidebar) {
        applyTokens(sidebar);
        // Also update overlay if it exists
        const overlay = document.getElementById(BL_OVERLAY_ID);
        if (overlay) {
          copyTokensToOverlay(sidebar, overlay);
        }
      }
    });

    obs.observe(themeStyle, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      childList: true,
      subtree: true
    });
  }

  function watchStorage() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes.qt_ready ||
        changes.qt_tasks ||
        changes.scrapedData ||
        changes.qt_blacklist
      ) {
        // We recompute "ready" inside renderFromStorage, which also toggles controls
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

    PAGE_GATE_OPEN = false; // base state - prevents any flash of stale tasks
    mountShell(parent);
    renderFromStorage();

    // Kick off a fresh sync - when it returns, open the page gate and render once
    sendBg({ type: "SYNC_WITH_GOOGLE_TASKS" }).then(() => {
      PAGE_GATE_OPEN = true;
      renderFromStorage();
    });

    watchForRerender();
    watchStorage();
    
    // Watch for BetterCanvas theme changes (delay to ensure style element exists)
    setTimeout(() => {
      watchBetterCanvasTheme();
      // Re-apply tokens one more time after BetterCanvas observer is set up
      const sidebar = document.getElementById(WIDGET_ID);
      if (sidebar) applyTokens(sidebar);
    }, 500);
    
    // Final retry after 2 seconds for slow-loading BetterCanvas
    setTimeout(() => {
      const sidebar = document.getElementById(WIDGET_ID);
      if (sidebar) {
        LOG("Final token application retry");
        applyTokens(sidebar);
      }
    }, 2000);
  }

  try {
    boot();
  } catch (e) {
    LOG("boot error", e);
  }
})();
