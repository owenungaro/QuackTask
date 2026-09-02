// src/content/sidebar.js
// QuackTask Canvas sidebar (content script)

(() => {
  const DEBUG = false; // Set to true for development logging
  
  /* ---------------------- constants / ids ---------------------- */
  const WIDGET_ID = "quacktask-sidebar";
  const BODY_ID = "quacktask-body";
  const SELECT_ID = "qt-folder-select";
  const FILTER_BTN_ID = "qt-filter-btn";
  const FILTER_MENU_ID = "qt-filter-menu";
  const BTN_BLACKLIST_ID = "qt-open-blacklist";
  const BTN_AUTH_ID = "qt-auth-toggle";
  const BTN_HELP_ID = "qt-help";

  // Overlay panel for blacklist (new, reliable)
  const BL_OVERLAY_ID = "qt-bl-overlay";
  const BL_PANEL_ID = "qt-bl-panel";
  const BL_HEAD_ID = "qt-bl-head";
  const BL_LIST_ID = "qt-bl-list";

  // Overlay panel for help
  const HELP_OVERLAY_ID = "qt-help-overlay";
  const HELP_PANEL_ID = "qt-help-panel";
  const HELP_HEAD_ID = "qt-help-head";
  const HELP_CONTENT_ID = "qt-help-content";

  const INFO = (...a) => console.log("[QuackTask]", ...a); // Basic operational info - always shown
  const LOG = (...a) => { if (DEBUG) console.log("[QuackTask]", ...a); }; // Verbose debug - only if DEBUG
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
    // Check if BetterCanvas style element exists (more reliable than CSS vars)
    const themeStyle = document.getElementById('bettercanvas-theme-preset');
    const hasStyleElement = !!themeStyle;
    
    // Check for BetterCanvas CSS variables on body
    const s = getComputedStyle(document.body);
    const bg0 = s.getPropertyValue('--bcbackground-0-ungradient')?.trim();
    const t0 = s.getPropertyValue('--bctext-0')?.trim();
    const link = s.getPropertyValue('--bclinks')?.trim();
    
    // BetterCanvas is present if style element exists OR if CSS variables are present
    // Prefer style element check as it's more reliable
    const has = hasStyleElement || !!(bg0 || t0 || link);
    
    return { bg0, t0, link, has, hasStyleElement };
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
      '--qt-bl-panel-bg', '--qt-bl-head-bg', '--qt-bl-item-bg', '--qt-bl-item-hover-bg', '--qt-bl-head-text', '--qt-bl-item-text', '--qt-bl-close-text',
      '--qt-help-panel-bg', '--qt-help-head-bg'
    ];
    tokens.forEach(token => {
      const value = computed.getPropertyValue(token);
      if (value) {
        overlay.style.setProperty(token, value);
        // Copy to both blacklist and help panels if they exist
        const blPanel = document.getElementById(BL_PANEL_ID);
        if (blPanel) blPanel.style.setProperty(token, value);
        const helpPanel = document.getElementById(HELP_PANEL_ID);
        if (helpPanel) helpPanel.style.setProperty(token, value);
      }
    });
    
    // Ensure accent tokens are explicitly copied for overlay (Close button and header)
    const accentTokens = ['--qt-assignment-name', '--qt-accent', '--qt-add-bg', '--qt-add-bg-hover'];
    accentTokens.forEach(token => {
      const value = computed.getPropertyValue(token);
      if (value) {
        overlay.style.setProperty(token, value);
        // Copy to both blacklist and help panels if they exist
        const blPanel = document.getElementById(BL_PANEL_ID);
        if (blPanel) blPanel.style.setProperty(token, value);
        const helpPanel = document.getElementById(HELP_PANEL_ID);
        if (helpPanel) helpPanel.style.setProperty(token, value);
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

  // Clear all theme-related CSS variables to ensure clean reset
  function clearThemeVariables(el) {
    if (!el) return;
    
    const allThemeVars = [
      '--qt-surface', '--qt-border', '--qt-text', '--qt-subtle', '--qt-accent',
      '--qt-accent-contrast', '--qt-row-hover', '--qt-shadow', '--qt-scrim',
      '--qt-btn-bg', '--qt-btn-bg-hover', '--qt-btn-text', '--qt-btn-border',
      '--qt-add-bg', '--qt-add-bg-hover', '--qt-add-text',
      '--qt-dd-bg', '--qt-dd-text', '--qt-scroll-thumb', '--qt-scroll-thumb-hover',
      '--qt-assignment-name',
      '--qt-bl-panel-bg', '--qt-bl-head-bg', '--qt-bl-item-bg', '--qt-bl-item-hover-bg',
      '--qt-bl-head-text', '--qt-bl-item-text', '--qt-bl-close-text',
      '--qt-help-panel-bg', '--qt-help-head-bg', '--qt-row-hover-mode'
    ];
    
    // Remove all theme variables to ensure clean slate
    allThemeVars.forEach(varName => {
      el.style.removeProperty(varName);
    });
    
    // Also clear data-dark-mode attribute
    el.removeAttribute('data-dark-mode');
  }

  function applyTokens(root) {
    const el = root || document.getElementById(WIDGET_ID);
    if (!el) {
      if (DEBUG) LOG("applyTokens: element not found");
      return;
    }
    
    // Clear all old theme variables first to ensure clean reset
    clearThemeVariables(el);
    
    // Force fresh detection - re-read all computed styles
    const bc = detectBetterCanvas();
    if (DEBUG) LOG("applyTokens: BetterCanvas detected:", bc.has, bc);

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
      if (DEBUG) LOG("applyTokens: BetterCanvas darkMode:", darkMode, "text:", text);
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
      if (DEBUG) LOG("applyTokens: Fallback mode, isDark:", isDark);

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

    // Panel and decorate modes sit among Canvas's own widgets, so take their
    // card color.
    // The new dashboard has its own dark theme independent of BetterCanvas, so
    // adopting the surface can legitimately flip us light<->dark; when it does,
    // the inherited text colour has to come with it or it turns invisible.
    let adoptedDark = null;
    if (
      (el.dataset.mode === "panel" || el.dataset.mode === "decorate") &&
      hostIsThemed()
    ) {
      const hostBg = hostSurface();
      const rgb = parseColorToRgb(hostBg);
      if (rgb) {
        surface = hostBg;
        adoptedDark = luminance(rgb) < 128;
        const inherited = parseColorToRgb(bc.has ? ddText : subtle);
        // Only override when the inherited text would be unreadable on it
        if (!inherited || adoptedDark === luminance(inherited) < 128) {
          text = adoptedDark ? TEXT_D : TEXT_L;
          subtle = adoptedDark ? SUB_D : SUB_L;
          ddText = subtle;
        }
      }
    }

    // Ensure we have valid color values
    if (!surface || !text || !accent) {
      // Keep this as a warning since it indicates a real problem
      console.warn("[QuackTask] applyTokens: Warning - missing color values", { surface, text, accent });
      return;
    }

    // Apply all tokens - inline styles have high specificity
    el.style.setProperty('--qt-surface', surface);
    el.style.setProperty('--qt-border', border);
    el.style.setProperty('--qt-text', text);
    el.style.setProperty('--qt-subtle', bc.has ? ddText : subtle);
    el.style.setProperty('--qt-accent', accent);
    el.style.setProperty('--qt-accent-contrast', '#ffffff');
    
    const darkMode =
      adoptedDark !== null
        ? adoptedDark
        : bc.has
        ? isDarkByText(text)
        : detectDarkModeFallback();
    
    // Set assignment name color - ensure MAROON in all fallback modes
    if (!bc.has) {
      // Fallback mode (no BetterCanvas): always use MAROON for assignment names
      // accent is already set to MAROON in fallback mode (line 341)
      el.style.setProperty('--qt-assignment-name', MAROON);
      el.style.setProperty('--qt-accent', MAROON); // Ensure it's set explicitly
    } else if (!isBuiltInBcDark()) {
      // BetterCanvas but not built-in dark: use detected accent
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
    
    let rowHover;
    if (!darkMode) {
      // Light mode – use neutral gray-based highlight and black shadow
      rowHover = '#f9fafb'; // subtle light gray instead of reddish tint
      el.style.setProperty('--qt-shadow', 'rgba(0,0,0,0.15)');
    } else {
      // Dark mode – don't change background, just use outline
      rowHover = surface; // Keep same background, no color change
      el.style.setProperty('--qt-shadow', shadow);
    }
    el.style.setProperty('--qt-row-hover', rowHover);
    el.style.setProperty('--qt-scrim', scrim);
    
    // Set data attribute for dark mode to enable outline hover effect
    if (darkMode) {
      el.setAttribute('data-dark-mode', 'true');
    } else {
      el.removeAttribute('data-dark-mode');
    }

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

    // Sitting inside Canvas's own chrome, maroon-on-teal reads as a foreign
    // object. adoptedDark is non-null only when we adopted the host's surface.
    if (adoptedDark !== null) {
      const step = darkMode ? lighten : darken;
      const add = hostAccent() || step(surface, 0.22);
      const addRgb = parseColorToRgb(add);
      el.style.setProperty('--qt-add-bg', add);
      el.style.setProperty('--qt-add-bg-hover', step(add, 0.12));
      // Canvas puts dark text on its own mid-tone pills; match that
      el.style.setProperty('--qt-add-text', addRgb && luminance(addRgb) > 128 ? TEXT_L : TEXT_D);
      el.style.setProperty('--qt-accent', add);
      el.style.setProperty('--qt-assignment-name', text);
    }

    el.style.setProperty('--qt-dd-bg', bc.has ? ddBg : surface);
    el.style.setProperty('--qt-dd-text', bc.has ? ddText : subtle);
    el.style.setProperty('--qt-scroll-thumb', darkMode ? 'rgba(255,255,255,0.25)' : '#d1d5db');
    el.style.setProperty('--qt-scroll-thumb-hover', darkMode ? 'rgba(255,255,255,0.4)' : accent);

    // Blacklist and help panel styling
    if (!bc.has) {
      // Not BetterCanvas - use fallback theme
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
        // Help panel uses same background as blacklist in dark mode
        el.style.setProperty('--qt-help-panel-bg', SURF_DARK);
        el.style.setProperty('--qt-help-head-bg', SURF_DARK);
      } else {
        // Light mode fallback: white panel, default colors, white close button text
        el.style.setProperty('--qt-bl-panel-bg', SURF_LIGHT);
        el.style.setProperty('--qt-bl-head-bg', '#fafafa'); // light grey header background
        el.style.setProperty('--qt-bl-item-bg', '#fafafa'); // light grey item background
        el.style.setProperty('--qt-bl-item-hover-bg', '#fef9fa'); // light item hover background
        el.style.setProperty('--qt-bl-head-text', MAROON); // use maroon in light mode
        el.style.setProperty('--qt-bl-item-text', TEXT_L);
        el.style.setProperty('--qt-bl-close-text', '#ffffff'); // white text on maroon button
        // Help panel uses same background as blacklist in light mode
        el.style.setProperty('--qt-help-panel-bg', SURF_LIGHT);
        el.style.setProperty('--qt-help-head-bg', '#fafafa');
      }
    } else {
      // BetterCanvas: use surface color for panels
      el.style.setProperty('--qt-bl-panel-bg', surface);
      el.style.setProperty('--qt-bl-head-bg', darkMode ? lighten(surface, 0.03) : darken(surface, 0.02));
      // Help panel uses surface for BetterCanvas themes
      el.style.setProperty('--qt-help-panel-bg', surface);
      el.style.setProperty('--qt-help-head-bg', darkMode ? lighten(surface, 0.03) : darken(surface, 0.02));
      // Explicitly clear any fallback-specific overrides that might have been set
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
      
      if (DEBUG) LOG("Text shadow check: btnBg=", btnBg, "btnBgLum=", btnBgLum, 
          "btnTextLum=", btnTextLum, "contrast=", contrast.toFixed(1),
          "isMidTone=", isMidTone, "needsTextShadow=", needsTextShadow);
    }
    
    if (needsTextShadow) {
      el.classList.add('qt-has-textshadow');
      if (DEBUG) LOG("Added qt-has-textshadow class to sidebar");
    } else {
      el.classList.remove('qt-has-textshadow');
      if (DEBUG) LOG("Removed qt-has-textshadow class from sidebar");
    }
    
    // Force background update - CSS uses var(--qt-surface) which should pick this up
    // But we'll also set it directly as a backup
    requestAnimationFrame(() => {
      // Decorate mode sits directly on Canvas's card; painting a background
      // here would draw a panel we deliberately do not want.
      if (el.dataset.mode !== "decorate" && el.dataset.mode !== "cards") {
        el.style.background = surface;
        el.style.backgroundColor = surface;
      }
      propagateTokens(el);
    });
    
    if (DEBUG) LOG("applyTokens: Applied tokens, surface:", surface, "text:", text, "accent:", accent, "darkMode:", darkMode, "bc.has:", bc.has);
  }

  // Per-page gate: base state is "loading". We only allow rendering
  // real content after the first sync returns on THIS page load.
  let PAGE_GATE_OPEN = false;

  /* ---------------------- small utils ---------------------- */
  const onDashboard = () => {
    try {
      const u = new URL(location.href);
      // Check that host is a Canvas instance (for now, Instructure-hosted)
      const isCanvasHost = u.hostname.endsWith(".instructure.com");
      if (!isCanvasHost) return false;
      
      // Check that we're on the dashboard path
      const isDashboardPath = u.pathname === "/";
      if (!isDashboardPath) return false;
      
      // Additional safety: check for Canvas DOM markers if available
      if (document.body) {
        const hasCanvasBody = document.body.classList.contains("ic-app");
        // Only the classic dashboard has these
        const hasDashboardCards = document.querySelector(".ic-DashboardCard") !== null;
        // Canvas app shell, present on both the classic and the new dashboard
        const hasAppShell = document.getElementById("application") !== null;
        // If DOM is loaded, require at least one Canvas marker
        if (document.readyState !== "loading") {
          return hasCanvasBody || hasDashboardCards || hasAppShell;
        }
      }
      
      // If DOM isn't ready yet, trust the URL check
      return true;
    } catch {
      return false;
    }
  };
  /* ---------------------- mount host ---------------------- */
  // Classic Canvas puts us in the right sidebar. The new customizable dashboard
  // has no #right-side, so we sit inline next to its Coursework widget instead.
  let HOST = null;

  // Confirmed against the new dashboard. Prefix matches so the "-combined-"
  // naming (and any future variant of it) keeps working.
  const NEW_DASH_SEL = '[data-testid="widget-columns"]';
  const WORK_BOX_SEL = '[data-testid^="widget-container-course-work"]';
  const WORK_CARD_SEL = '[data-testid^="widget-course-work"]';
  const COURSEWORK_TESTID = /^(course-?work|assignments?-widget)/i;

  const isCardish = (el) => {
    const st = getComputedStyle(el);
    return parseFloat(st.borderRadius) >= 4 || st.boxShadow !== "none";
  };

  // Climb from a marker to the widget's own card: the outermost rounded or
  // shadowed box between the marker and the page content wrapper. Landing on a
  // layout container instead just puts us lower down the page, which is fine;
  // landing inside the widget would not be, so we never stop short of a card.
  function widgetCardOf(el) {
    const cap = document.getElementById("content") || document.body;
    let node = el;
    // Seed with el itself: the data-testid path already starts on the card
    let card = isCardish(el) ? el : null;
    for (let i = 0; i < 8; i++) {
      const parent = node.parentElement;
      if (!parent || parent === cap || parent === document.body) break;
      node = parent;
      if (isCardish(node)) card = node;
    }
    return card || node;
  }

  function courseWorkWidget() {
    for (const el of document.querySelectorAll("[data-testid]")) {
      if (COURSEWORK_TESTID.test(el.getAttribute("data-testid") || "")) {
        return widgetCardOf(el);
      }
    }
    const head = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,[role='heading']")
    ).find((h) => /^course\s*work$/i.test((h.textContent || "").trim()));
    return head ? widgetCardOf(head) : null;
  }

  // { el, sample, mode, place } — el is the anchor, sample is what we read the
  // background off, place() does the insertion.
  function resolveHost() {
    // Check this FIRST: the new dashboard still ships an unused #right-side,
    // so its presence no longer means we are on the classic dashboard.
    const grid = document.querySelector(NEW_DASH_SEL);
    if (grid) {
      // Preferred: live inside the Coursework widget, decorating its own rows.
      // Our controls strip goes directly under the widget heading.
      const card = document.querySelector(WORK_CARD_SEL);
      const heading = card && card.querySelector('h2[id$="-heading"]');
      const headRow = heading && heading.parentElement && heading.parentElement.parentElement;
      if (headRow && headRow.parentElement) {
        return {
          el: headRow,
          sample: card,
          mode: "decorate",
          place: (w) => headRow.after(w),
        };
      }

      // After the container, not the card: that makes us a sibling of the
      // other widget boxes instead of a child of React's widget subtree.
      const box = document.querySelector(WORK_BOX_SEL);
      if (box && box.parentElement) {
        return {
          el: box,
          sample: box.querySelector(WORK_CARD_SEL) || box,
          mode: "panel",
          place: (w) => box.after(w),
        };
      }
      // Coursework widget removed, or renamed out from under us
      const work = courseWorkWidget();
      if (work && work.parentElement) {
        return { el: work, sample: work, mode: "panel", place: (w) => work.after(w) };
      }
      const col = grid.querySelector('[data-testid^="widget-column-"]') || grid;
      return {
        el: col,
        // Any neighbouring widget card will do for the surface colour
        sample:
          col.querySelector(WORK_CARD_SEL) ||
          col.querySelector('section[data-testid^="widget-"]') ||
          col,
        mode: "panel",
        place: (w) => col.appendChild(w),
      };
    }

    // The new dashboard also renders #right-side, collapsed to zero width. It
    // may be the only thing present at document_idle, before React has drawn
    // the widgets, so size is what tells the real sidebar from the leftover.
    // New dashboard, but the widget grid is absent: we are on the Courses tab,
    // which is a card grid with nothing to attach a task list to. Badge the
    // cards instead. body is the token carrier since the shell stays hidden.
    if (document.querySelector('[data-testid="dashboard-tabs"]')) {
      const content = document.getElementById("content") || document.body;
      return {
        el: content,
        sample: document.body,
        mode: "cards",
        place: (w) => content.appendChild(w),
      };
    }

    const aside = document.getElementById("right-side");
    if (aside && aside.getBoundingClientRect().width > 0) {
      return { el: aside, sample: aside, mode: "aside", place: (w) => aside.prepend(w) };
    }

    const content = document.getElementById("content");
    if (content) {
      return { el: content, sample: content, mode: "panel", place: (w) => content.appendChild(w) };
    }
    return null;
  }

  // Nearest opaque background behind the panel, so inline mode matches the
  // Canvas widgets it sits between instead of guessing white.
  // Tokens the injected row buttons need. They live in Canvas's DOM, outside
  // our element, so they cannot inherit anything we set on it.
  const DECORATE_TOKENS = [
    "--qt-surface", "--qt-border", "--qt-text", "--qt-subtle", "--qt-accent",
    "--qt-row-hover", "--qt-shadow", "--qt-btn-bg", "--qt-btn-bg-hover",
    "--qt-btn-text", "--qt-btn-border", "--qt-add-bg", "--qt-add-bg-hover",
    "--qt-add-text", "--qt-assignment-name",
  ];

  function propagateTokens(from) {
    const decorates = HOST && (HOST.mode === "decorate" || HOST.mode === "cards");
    const card = decorates && HOST.sample;
    if (!card || !from) return;
    const cs = getComputedStyle(from);
    DECORATE_TOKENS.forEach((t) => {
      const v = cs.getPropertyValue(t);
      if (v) card.style.setProperty(t, v);
    });
  }

  const opaque = (bg) => {
    const m = /^rgba?\(([^)]+)\)/.exec(bg || "");
    if (!m) return null;
    const parts = m[1].split(",").map((v) => parseFloat(v));
    return parts.length < 4 || parts[3] > 0.1 ? bg : null;
  };

  // Canvas's due-date pills carry the dashboard's own accent. Borrowing it beats
  // painting QuackTask maroon buttons onto a teal widget.
  function hostAccent() {
    const card = HOST && HOST.sample;
    const pill = card && card.querySelector('[data-testid*="status-pill"]');
    return pill ? opaque(getComputedStyle(pill).backgroundColor) : null;
  }

  // Borrow Canvas's palette only when Canvas has one worth matching. On a
  // default, unthemed dashboard the card is near-white and its controls are
  // grey, so sampling it would strip QuackTask of its own identity.
  function hostIsThemed() {
    if (detectBetterCanvas().has) return true;
    const rgb = parseColorToRgb(hostSurface());
    return !!(rgb && luminance(rgb) < 235);
  }

  function hostSurface() {
    let node = HOST && (HOST.sample || HOST.el);
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      const bg = opaque(getComputedStyle(node).backgroundColor);
      if (bg) return bg;
    }
    return null;
  }

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

  /* ---------------------- task types ---------------------- */
  // icon = inner markup of a 16x16 stroke icon; it inherits the surrounding color
  const TYPE_META = {
    assignment: {
      label: "Assignments",
      icon: `<path d="M2.5 4.5 4 6l2.5-2.5"/><path d="M9 5h4.5"/><path d="M2.5 11 4 12.5 6.5 10"/><path d="M9 11.5h4.5"/>`,
    },
    quiz: {
      label: "Quizzes",
      icon: `<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.75 1.75 0 1 1 1.9 2v1.1"/><path d="M8.2 12h.01"/>`,
    },
    discussion: {
      label: "Discussions",
      icon: `<path d="M14 9.5a2 2 0 0 1-2 2H6.5L3.5 14V4a2 2 0 0 1 2-2H12a2 2 0 0 1 2 2z"/>`,
    },
    page: {
      label: "Pages",
      icon: `<path d="M4 2h5.5L12.5 5v9H4z"/><path d="M9.5 2v3h3"/><path d="M6.5 9h3.5"/>`,
    },
    note: {
      label: "To-Do Notes",
      icon: `<path d="M4 2.5h8v11l-4-3-4 3z"/>`,
    },
    event: {
      label: "Events",
      icon: `<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>`,
    },
    peer_review: {
      label: "Peer Reviews",
      icon: `<circle cx="6" cy="6" r="2.5"/><circle cx="11.75" cy="6.75" r="1.75"/><path d="M1.5 13.5c0-2.4 2-4 4.5-4 1.4 0 2.6.5 3.4 1.3"/><path d="M9.75 13.5c0-1.9.9-3 2.25-3s2.5 1.1 2.5 3"/>`,
    },
    grading: {
      label: "To Grade",
      icon: `<path d="M8 2.5 15 6l-7 3.5L1 6z"/><path d="M4 7.6V11c0 1.1 1.8 2 4 2s4-.9 4-2V7.6"/>`,
    },
    other: {
      label: "Other",
      icon: `<path d="M3 4.5h10M3 8h10M3 11.5h7"/>`,
    },
  };

  const GEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

  // Ticked checkbox: distinct from Canvas's own assignment/discussion icons
  const MARK_ICON = `<svg class="qtask-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3"/><path d="M5.4 8.2 7.2 10l3.4-3.7"/></svg>`;

  // Real checkboxes: this menu is a multi-select, and a highlight alone does
  // not say so. Leading position is where people look for checked state.
  const BOX_EMPTY = `<svg class="qt-box" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="3"/></svg>`;
  const BOX_CHECKED = `<svg class="qt-box" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="3"/><path d="M5.4 8.2 7.1 9.9 10.7 6.2"/></svg>`;


  const typeIcon = (type) =>
    `<svg class="qtask-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><title>${escapeHtml(
      TYPE_META[type].label
    )}</title>${TYPE_META[type].icon}</svg>`;

  // Stored as an array of types; empty means no filter. Older builds stored a string.
  const normalizeFilter = (v) =>
    Array.isArray(v) ? v : typeof v === "string" && v !== "all" ? [v] : [];

  // Falls back for cached items scraped before types existed
  const typeOf = (t) => {
    const type =
      t.type ||
      (t.isGrading || (t.assignment || "").startsWith("Grade: ")
        ? "grading"
        : "assignment");
    return TYPE_META[type] ? type : "other";
  };

  const greyRowButtons = (row, on) =>
    row.querySelectorAll(".qtask-btn").forEach((b) => (b.disabled = on));

  /* ---------------------- mount / shell ---------------------- */
  /* ---------------------- first-paint gate ---------------------- */
  // Mounting can happen two or three times on the way in: document_idle finds
  // only the #content fallback, then React draws the widgets and we move. And
  // applyTokens re-reads the theme on a schedule as Canvas/BetterCanvas CSS
  // lands, so an early read can differ from the final one. Stay hidden until
  // the data is ready AND the host has held still, then paint once.
  const SETTLE_MS = 300;
  const MAX_WAIT_MS = 2500; // never wait forever on a widget that keeps polling
  let lastMountAt = 0;
  let lastChurnAt = 0;
  let injecting = false;
  let painted = false; // has anything of ours actually been made visible yet
  let pendingSettle = [];
  let settleTimer = null;

  // Our own DOM writes must not count as churn or we would reset the clock on
  // ourselves forever. Mutation records are delivered as microtasks, which run
  // before a 0ms timeout, so the flag is still set when the observer sees them.
  function markInjecting() {
    injecting = true;
    setTimeout(() => {
      injecting = false;
    }, 0);
  }

  // Where Canvas's own rendering counts: the Coursework card in decorate mode,
  // the content column in cards mode. Anything wider and an unrelated widget
  // still loading would hold us back.
  const churnScope = () => {
    if (!HOST) return null;
    const s = HOST.sample;
    return s && s !== document.body ? s : HOST.el || null;
  };

  // Quiet for SETTLE_MS since the last of (our remount, Canvas redrawing the
  // host), or MAX_WAIT_MS since mounting, whichever comes first.
  const settled = () => {
    const now = performance.now();
    return (
      now - Math.max(lastMountAt, lastChurnAt) >= SETTLE_MS ||
      now - lastMountAt >= MAX_WAIT_MS
    );
  };

  // Queues fn until the host has held still. A queue rather than one timer per
  // caller: several callers wait at once, and a shared timer handle would let
  // the last one cancel the others. After the opening moments settled() is
  // already true, so page turns and filter changes stay instant.
  function whenSettled(fn) {
    if (settled()) return fn();
    if (!pendingSettle.includes(fn)) pendingSettle.push(fn);
    if (settleTimer) return;
    const quietIn = SETTLE_MS - (performance.now() - Math.max(lastMountAt, lastChurnAt));
    const capIn = MAX_WAIT_MS - (performance.now() - lastMountAt);
    settleTimer = setTimeout(flushSettle, Math.max(0, Math.min(quietIn, capIn)));
  }

  // A remount mid-wait resets lastMountAt, so re-queue rather than run
  function flushSettle() {
    settleTimer = null;
    const queued = pendingSettle;
    pendingSettle = [];
    queued.forEach((fn) => whenSettled(fn));
  }

  function paintWidget() {
    const el = document.getElementById(WIDGET_ID);
    if (!el || !el.hasAttribute("data-qt-loading")) return;
    applyTokens(el); // settle the colours while it is still invisible
    requestAnimationFrame(() => {
      el.removeAttribute("data-qt-loading");
      painted = true;
    });
  }

  function revealWidget() {
    const el = document.getElementById(WIDGET_ID);
    if (!el || !el.hasAttribute("data-qt-loading")) return;
    whenSettled(paintWidget);
  }

  // decorate and cards paint into Canvas's markup, outside our element, so the
  // display:none gate cannot cover them. They wait on the same settle instead,
  // and take the theme tokens before injecting so nothing appears mis-coloured.
  function paintReady() {
    if (!settled()) return false;
    propagateTokens(document.getElementById(WIDGET_ID));
    return true;
  }

  function mountShell(host) {
    const old = document.getElementById(WIDGET_ID);
    if (old && old.parentElement) old.parentElement.removeChild(old);

    HOST = host;
    markInjecting();

    const wrap = document.createElement("div");
    wrap.id = WIDGET_ID;
    wrap.dataset.mode = host.mode;
    wrap.setAttribute("data-qt-loading", "");
    lastMountAt = performance.now();
    wrap.innerHTML =
      host.mode === "cards" ? "" :
      host.mode === "decorate" ? decorateShellHTML() : `
      <header>
        <h3>QuackTask</h3>
        <div class="qt-filter" data-gated="ready" style="display:none">
          <button id="${FILTER_BTN_ID}" type="button" class="qt-icon-btn" aria-haspopup="true" aria-expanded="false" title="Filter by task type">${GEAR_ICON}</button>
          <div id="${FILTER_MENU_ID}" class="qt-filter-menu" role="menu" hidden></div>
        </div>
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

    host.place(wrap);
    INFO(`sidebar boot (${host.mode}) @`, location.href);

    // Every mode that renders its own list needs it capped and scrolling;
    // decorate mode has no list of its own.
    const body = document.getElementById(BODY_ID);
    if (body && host.mode !== "decorate" && host.mode !== "cards") {
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

  // Show/hide everything gated on ready (header gear + controls block) when ready
  function setReadyUI(ready) {
    document.querySelectorAll('[data-gated="ready"]').forEach((el) => {
      el.style.display = ready ? "" : "none";
    });
  }

  async function wireControls() {
    const blBtn = document.getElementById(BTN_BLACKLIST_ID);
    if (blBtn) blBtn.onclick = () => openBlacklistOverlay();

    const authBtn = document.getElementById(BTN_AUTH_ID);
    if (authBtn) {
      authBtn.onclick = async () => {
        const mode = authBtn.dataset.mode;
        if (DEBUG) LOG("auth button clicked:", mode);
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
      helpBtn.onclick = () => openHelpOverlay();
    }

    const gear = document.getElementById(FILTER_BTN_ID);
    const menu = document.getElementById(FILTER_MENU_ID);
    if (gear && menu) {
      gear.onclick = () => {
        menu.hidden = !menu.hidden;
        gear.setAttribute("aria-expanded", String(!menu.hidden));
      };
      // Stays open so several types can be picked in one go
      menu.onclick = (e) => {
        if (e.target.closest(".qt-menu-clear")) {
          chrome.storage.local.set({ qt_type_filter: [] });
          renderFromStorage();
          return;
        }

        const item = e.target.closest(".qt-filter-item");
        if (!item) return;

        if (item.dataset.toggle === "added") {
          chrome.storage.local.get({ qt_hide_added: false }, (st) => {
            chrome.storage.local.set({ qt_hide_added: !st.qt_hide_added });
            renderFromStorage();
          });
          return;
        }

        const type = item.dataset.type;
        chrome.storage.local.get({ qt_type_filter: [] }, (st) => {
          const cur = normalizeFilter(st.qt_type_filter);
          const next =
            type === "all"
              ? [] // "All types" clears the rest rather than joining them
              : cur.includes(type)
              ? cur.filter((k) => k !== type)
              : cur.concat(type);
          chrome.storage.local.set({ qt_type_filter: next });
          renderFromStorage();
        });
      };
    }

    // Document-level handlers survive re-mounts, so only attach them once
    if (!filterMenuWired) {
      filterMenuWired = true;
      document.addEventListener("click", (e) => {
        if (!e.target.closest || !e.target.closest(".qt-filter")) closeFilterMenu();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeFilterMenu();
      });
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
          console.error("[QuackTask] Sync after list change failed:", e);
        }
      });

      // Trigger initial sync if authed (dropdown still hidden until ready)
      if (lists.length > 0) {
        try {
          INFO("Syncing with Google Tasks...");
          await sendBg({ type: "SYNC_WITH_GOOGLE_TASKS" });
          renderFromStorage();
        } catch (e) {
          console.error("[QuackTask] Initial sync failed:", e);
        }
      }

      return true;
    } catch (e) {
      console.error("[QuackTask] fillTaskLists error", e);
      return false;
    }
  }

  /* ---------------------- coursework widget decoration ---------------------- */
  const ROW_SEL = '[data-testid^="listed-course-work-item-"]';
  const COURSE_LINK_SEL = '[data-testid^="course-work-item-course-link-"]';

  let LAST_TASKS = [];
  let LAST_BLACKLIST = new Set();

  const norm = (v) => (v || "").replace(/\s+/g, " ").trim().toLowerCase();

  function decorateShellHTML() {
    return `
      <div class="qtask-controls" data-gated="ready" style="display:none">
        <div class="qt-field">
          <label for="${SELECT_ID}">Google Tasks list:</label>
          <select id="${SELECT_ID}" class="qtask-select" aria-label="Google Task list"></select>
        </div>
        <div class="qt-field qt-field--actions">
          <div class="qt-strip-actions">
            <button id="${BTN_BLACKLIST_ID}" type="button" class="qtask-btn qtask-del">Blacklist</button>
            <button id="${BTN_AUTH_ID}" type="button" class="qtask-btn qtask-del" data-mode="login">Login</button>
            <button id="${BTN_HELP_ID}" type="button" class="qtask-btn qtask-del">Help</button>
          </div>
        </div>
      </div>
    `;
  }

  // Canvas lists a row by its full title plus its course code, which is the
  // same pair codeKeyOf builds from. Match on those rather than on the row id:
  // graded discussions are listed under an /assignments/ URL, so matching by
  // id or href misses them without ever looking wrong.
  function matchTask(row, tasks) {
    const title = norm(row.getAttribute("aria-label"));
    if (!title) return null;

    const hits = tasks.filter((t) => norm(t.assignment) === title);
    if (hits.length < 2) return hits[0] || null;

    // Same title in two courses: separate them on the course label
    const link = row.querySelector(COURSE_LINK_SEL);
    const code = norm(
      (link && link.getAttribute("aria-label") || "").replace(/^\S+\s+to\s+/i, "")
    );
    return (
      hits.find((t) => norm(t.courseCode) === code || norm(t.course) === code) ||
      hits[0]
    );
  }

  const BRAND_HEADING = "QuackTask Course Work";

  // React rewrites the heading on re-render, so re-assert it every pass. Colour
  // comes from --qt-assignment-name: maroon when unthemed, the card's own text
  // colour when we have adopted a Canvas theme.
  function brandWidget() {
    const card = HOST && HOST.sample;
    const h = card && card.querySelector('h2[id$="-heading"]');
    if (!h) return;
    if (h.textContent !== BRAND_HEADING) h.textContent = BRAND_HEADING;
    h.style.color = "var(--qt-assignment-name, var(--qt-accent, #9d1535))";
  }

  const rowActionsHTML = (inTasks) =>
    inTasks
      ? `<div class="qtask-actions"><button class="qtask-btn qtask-del" data-act="del">Remove</button></div>`
      : `<div class="qtask-actions"><button class="qtask-btn qtask-add" data-act="add">Add</button>` +
        `<button class="qtask-btn qtask-hide" data-act="hide">Hide</button></div>`;

  // Idempotent: safe to re-run on every Canvas re-render, filter and page turn
  function decorateCoursework() {
    if (!paintReady()) return whenSettled(decorateCoursework);
    markInjecting();
    brandWidget();
    document.querySelectorAll(ROW_SEL).forEach((row) => {
      const task = matchTask(row, LAST_TASKS);
      const li = row.closest("li") || row;

      if (!task) {
        li.style.removeProperty("display"); // not ours; leave Canvas alone
        return;
      }

      const key = taskKey(task);
      if (LAST_BLACKLIST.has(key)) {
        li.style.display = "none";
        return;
      }
      li.style.removeProperty("display");

      const state = task._in_google_tasks ? "in" : "out";
      let host = row.querySelector(".qt-row-host");
      if (host && host.dataset.key === key && host.dataset.state === state) return;

      if (!host) {
        // direction="row" is InstUI's own attribute, steadier than its hashed
        // class names; the outer row flex is the first one in the row.
        const flex = row.querySelector('[direction="row"]') || row.firstElementChild;
        if (!flex) return;
        host = document.createElement("span");
        host.className = "qt-row-host";
        flex.appendChild(host);
      }

      host.dataset.key = key;
      host.dataset.href = task.href || "";
      host.dataset.grading = "false";
      host.dataset.state = state;
      host.innerHTML = rowActionsHTML(state === "in");

      const add = host.querySelector("[data-act='add']");
      const del = host.querySelector("[data-act='del']");
      const hide = host.querySelector("[data-act='hide']");
      if (add) add.addEventListener("click", onAddClick);
      if (del) del.addEventListener("click", onDeleteClick);
      if (hide) hide.addEventListener("click", onHideClick);
    });

    painted = true;
  }

  /* ---------------------- course card badges ---------------------- */
  // The Courses tab renders classic-looking dashboard cards; fall through a
  // couple of alternatives in case that markup is not what it appears to be.
  const CARD_SELS = [
    ".ic-DashboardCard",
    '[data-testid^="course-card"]',
    '[data-testid^="dashboard-card"]',
  ];

  const courseIdOf = (t) =>
    t.courseId || ((t.href || "").match(/\/courses\/(\d+)/) || [])[1] || null;

  function courseCards() {
    for (const sel of CARD_SELS) {
      const found = document.querySelectorAll(sel);
      if (found.length) return Array.from(found);
    }
    return [];
  }

  /* ---- hover preview of a course's tasks ---- */
  const POP_ID = "qt-card-pop";
  let popWired = false;

  // Lives on <body>, not inside the card: cards clip their overflow, and body
  // is also where propagateTokens puts the theme in cards mode.
  function cardPopover() {
    let el = document.getElementById(POP_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = POP_ID;
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  // Delegated, not per-badge: mouseenter does not bubble, so a badge that was
  // created before wiring (or re-created by a later pass) would have no
  // listener at all. mouseover/mouseout do bubble, so one pair covers every
  // badge on the page, now and later.
  function wireBadgeHover() {
    if (popWired) return;
    popWired = true;

    const badgeOf = (e) =>
      e.target && e.target.closest ? e.target.closest(".qt-card-badge") : null;

    document.addEventListener("mouseover", (e) => {
      const b = badgeOf(e);
      if (b) showCardTasks(b);
    });
    document.addEventListener("mouseout", (e) => {
      if (badgeOf(e)) hideCardTasks();
    });
    document.addEventListener("focusin", (e) => {
      const b = badgeOf(e);
      if (b) showCardTasks(b);
    });
    document.addEventListener("focusout", hideCardTasks);
    window.addEventListener("scroll", hideCardTasks, true);
  }

  function hideCardTasks() {
    const el = document.getElementById(POP_ID);
    if (el) el.hidden = true;
  }

  function showCardTasks(badge) {
    const id = badge.dataset.courseId;
    const list = LAST_TASKS.filter(
      (t) =>
        courseIdOf(t) === id &&
        !t._completed_in_google &&
        !LAST_BLACKLIST.has(taskKey(t))
    );
    if (!list.length) return hideCardTasks();

    const pop = cardPopover();
    const shown = list.slice(0, 8);
    pop.innerHTML =
      shown
        .map(
          (t) =>
            `<div class="qt-pop-row">${typeIcon(typeOf(t))}<span>${escapeHtml(
              t.assignment || "Untitled"
            )}</span><em>${escapeHtml(t.dueText || "")}</em></div>`
        )
        .join("") +
      (list.length > shown.length
        ? `<div class="qt-pop-more">+${list.length - shown.length} more</div>`
        : "");

    // Measure at a known origin, then place; fixed with auto offsets would
    // otherwise report its static position and could add a scrollbar.
    pop.hidden = false;
    pop.style.left = "0px";
    pop.style.top = "0px";
    const r = badge.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const gap = 8;

    let top = r.bottom + gap;
    if (top + pr.height > window.innerHeight - 8) {
      top = Math.max(8, r.top - gap - pr.height); // flip above
    }
    let left = r.left;
    if (left + pr.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - pr.width);
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }

  function onBadgeClick(e) {
    e.preventDefault();
    e.stopPropagation(); // the whole card is a link to the course
    const tab = document.querySelector('[data-testid="tab-dashboard"]');
    if (tab) tab.click();
  }

  function decorateCourseCards() {
    if (!paintReady()) return whenSettled(decorateCourseCards);
    markInjecting();
    wireBadgeHover();
    const cards = courseCards();
    if (!cards.length) return;

    const counts = {};
    LAST_TASKS.forEach((t) => {
      if (t._completed_in_google || LAST_BLACKLIST.has(taskKey(t))) return;
      const id = courseIdOf(t);
      if (id) counts[id] = (counts[id] || 0) + 1;
    });

    cards.forEach((card) => {
      const link = card.querySelector('a[href*="/courses/"]');
      const id =
        link && ((link.getAttribute("href") || "").match(/\/courses\/(\d+)/) || [])[1];
      const n = (id && counts[id]) || 0;
      let badge = card.querySelector(".qt-card-badge");

      if (!n) {
        if (badge) badge.remove(); // course cleared out since the last pass
        return;
      }

      if (!badge) {
        badge = document.createElement("button");
        badge.type = "button";
        badge.className = "qt-card-badge";
        badge.addEventListener("click", onBadgeClick);
        // The coloured banner is empty space with nothing to collide with or
        // clip against, unlike the action row along the bottom.
        const slot =
          card.querySelector(".ic-DashboardCard__header_hero") ||
          card.querySelector(".ic-DashboardCard__header") ||
          card;
        slot.appendChild(badge);
      }

      badge.dataset.courseId = id;
      if (badge.dataset.count === String(n)) return;
      badge.dataset.count = String(n);
      // No title attribute: the native tooltip would race our own popover
      badge.setAttribute(
        "aria-label",
        `${n} ${n === 1 ? "task" : "tasks"} in QuackTask`
      );
      badge.innerHTML = `${MARK_ICON}<span>${n}</span>`;
    });

    painted = true;
  }

  /* ---------------------- render tasks ---------------------- */
  function renderFromStorage() {
    const body = document.getElementById(BODY_ID);
    // decorate and cards render into Canvas's own markup, so they have no body
    const mode = HOST ? HOST.mode : "aside";
    const decorating = mode === "decorate";
    if (!body && decorating === false && mode !== "cards") return;

    chrome.storage.local.get(
      [
        "qt_tasks", "scrapedData", "qt_blacklist", "qt_ready",
        "qt_type_filter", "qt_hide_added",
      ],
      (st) => {
        // We only show content after:
        // 1) background says the data is accurate (qt_ready === true), AND
        // 2) the first sync has returned on THIS page load (PAGE_GATE_OPEN)
        const ready = st.qt_ready === true && PAGE_GATE_OPEN;

        // content.js scrapes twice on load, and each scrape flips qt_ready
        // false->true. Once we are up, ride out those dips on the last good
        // render rather than blanking and re-showing.
        if (!ready && painted) return;

        // Toggle controls visibility with the same gate
        setReadyUI(ready);

        if (!ready) {
          if (body) body.innerHTML = `<div class="qtask-empty">Loading tasks…</div>`;
          return;
        }

        const tasks = Array.isArray(st.qt_tasks)
          ? st.qt_tasks
          : Array.isArray(st.scrapedData)
          ? st.scrapedData
          : [];

        const blacklist = new Set(st.qt_blacklist || []);
        if (DEBUG) LOG("render tasks count:", tasks.length, "blacklist:", blacklist.size);

        // These modes write into Canvas's own markup rather than a list of ours
        if (decorating || mode === "cards") {
          LAST_TASKS = tasks;
          LAST_BLACKLIST = blacklist;
          if (decorating) decorateCoursework();
          else decorateCourseCards();
          revealWidget();
          return;
        }

        // Filter out blacklisted items and completed tasks
        const visible = tasks.filter((t) => {
          return !blacklist.has(taskKey(t)) && !t._completed_in_google;
        });

        // Show basic info about what's being rendered
        if (tasks.length > 0 && (visible.length !== tasks.length || DEBUG)) {
          INFO(`Rendering ${visible.length} of ${tasks.length} tasks`);
        }

        // Drop the already-added first, so the type counts match what is shown
        const hideAdded = st.qt_hide_added === true;
        const addedCount = visible.filter((t) => t._in_google_tasks).length;
        const pool = hideAdded
          ? visible.filter((t) => !t._in_google_tasks)
          : visible;

        // Then narrow to the selected task types
        const types = fillTypeFilter(pool, st.qt_type_filter, hideAdded, addedCount);
        const shown = types.length
          ? pool.filter((t) => types.includes(typeOf(t)))
          : pool;

        body.innerHTML =
          shown.map(taskRowHTML).join("") ||
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

        revealWidget();
      }
    );
  }

  let filterMenuWired = false;

  function closeFilterMenu() {
    const menu = document.getElementById(FILTER_MENU_ID);
    const gear = document.getElementById(FILTER_BTN_ID);
    if (menu) menu.hidden = true;
    if (gear) gear.setAttribute("aria-expanded", "false");
  }

  // Rebuilds the menu from the types actually present; returns the types in effect
  function fillTypeFilter(tasks, wanted, hideAdded, addedCount) {
    const counts = {};
    tasks.forEach((t) => {
      const k = typeOf(t);
      counts[k] = (counts[k] || 0) + 1;
    });

    // Drop any saved type that has nothing left to show
    const types = normalizeFilter(wanted).filter((k) => counts[k]);

    const menu = document.getElementById(FILTER_MENU_ID);
    if (!menu) return types;

    // Counts belong only where they mean "how many of these exist". The hide
    // toggle's number means something else, so it goes inside its label rather
    // than sharing a column with numbers it cannot be compared against.
    const row = (attrs, on, label, count) =>
      `<button type="button" class="qt-filter-item" role="menuitemcheckbox" aria-checked="${on}" ${attrs}>` +
      `${on ? BOX_CHECKED : BOX_EMPTY}<span>${escapeHtml(label)}</span>` +
      (count == null ? "" : `<em>${count}</em>`) +
      `</button>`;

    const present = Object.keys(TYPE_META).filter((k) => counts[k]);

    // No "All types" pseudo-option: nothing checked already means no filter,
    // and resetting is an action rather than a state you can be filtered to.
    menu.innerHTML =
      `<div class="qt-menu-head"><span>Task types</span>` +
      `<button type="button" class="qt-menu-clear"${
        types.length ? "" : " disabled"
      }>Clear</button></div>` +
      present
        .map((k) =>
          row(`data-type="${k}"`, types.includes(k), TYPE_META[k].label, counts[k])
        )
        .join("") +
      `<div class="qt-menu-head"><span>Options</span></div>` +
      row(
        `data-toggle="added"`,
        !!hideAdded,
        addedCount ? `Hide ${addedCount} already added` : "Hide already added",
        null
      );

    const gear = document.getElementById(FILTER_BTN_ID);
    if (gear) gear.classList.toggle("qt-active", types.length > 0 || !!hideAdded);

    return types;
  }

  function taskRowHTML(t) {
    const inTasks = !!t._in_google_tasks;
    const type = typeOf(t);
    const isGrading = type === "grading";
    return `
      <div class="qtask-row" data-key="${taskKey(t)}" data-href="${
      t.href || ""
    }" data-type="${type}" data-grading="${isGrading ? "true" : "false"}">
        <div>
          <div class="qtask-title">${typeIcon(type)}<a href="${
      t.href || "#"
    }">${escapeHtml(t.assignment || "Untitled")}</a></div>
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
    const row = e.currentTarget.closest("[data-key]");
    if (!row) return;
    
    const isGrading = row.dataset.grading === "true";
    
    // For grading tasks, show date picker instead of immediately adding
    if (isGrading) {
      showGradingDatePicker(row);
      return;
    }
    
    // Normal flow for non-grading tasks
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
      console.error("[QuackTask] add error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  function showGradingDatePicker(row) {
    // Remove any existing date picker
    const existing = row.querySelector(".qt-grading-date-picker");
    if (existing) {
      existing.remove();
      return;
    }

    const actionsDiv = row.querySelector(".qtask-actions");
    if (!actionsDiv) return;

    // Create date picker container
    const pickerContainer = document.createElement("div");
    pickerContainer.className = "qt-grading-date-picker";
    
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "qt-date-input";
    
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "qt-date-buttons";
    
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "qtask-btn qtask-add";
    confirmBtn.textContent = "Confirm";
    
    const noDateBtn = document.createElement("button");
    noDateBtn.className = "qtask-btn qtask-del";
    noDateBtn.textContent = "No Due Date";
    
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "qtask-btn qtask-hide";
    cancelBtn.textContent = "Cancel";
    
    buttonContainer.appendChild(confirmBtn);
    buttonContainer.appendChild(noDateBtn);
    buttonContainer.appendChild(cancelBtn);
    
    pickerContainer.appendChild(dateInput);
    pickerContainer.appendChild(buttonContainer);
    
    // Insert after the actions div
    actionsDiv.parentNode.insertBefore(pickerContainer, actionsDiv.nextSibling);
    
    // Focus the date input
    setTimeout(() => dateInput.focus(), 10);
    
    // Confirm handler
    confirmBtn.addEventListener("click", async () => {
      const dateValue = dateInput.value.trim();
      
      // Validate date if provided
      if (dateValue) {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) {
          if (DEBUG) LOG("Invalid date:", dateValue);
          return;
        }
      }
      
      await addGradingTask(row, dateValue || null);
      pickerContainer.remove();
    });
    
    // No due date handler
    noDateBtn.addEventListener("click", async () => {
      await addGradingTask(row, null);
      pickerContainer.remove();
    });
    
    // Cancel handler
    cancelBtn.addEventListener("click", () => {
      pickerContainer.remove();
    });
  }

  async function addGradingTask(row, dueOverrideDate) {
    greyRowButtons(row, true);

    try {
      const listId = $("#" + SELECT_ID)?.value || null;
      const key = row.dataset.key;
      const notes = row.dataset.href
        ? new URL(row.dataset.href, location.origin).href
        : "";

      const payload = {
        type: "ADD_TO_GOOGLE_TASKS",
        listId,
        notes,
        key,
      };
      
      // Add dueOverrideDate if provided (null or string)
      if (dueOverrideDate !== undefined) {
        payload.dueOverrideDate = dueOverrideDate;
      }

      const resp = await sendBg(payload);
      if (resp && resp.ok) {
        row.querySelector(
          ".qtask-actions"
        ).innerHTML = `<button class="qtask-btn qtask-del" data-act="del">Delete</button>`;
        row
          .querySelector("[data-act='del']")
          .addEventListener("click", onDeleteClick);
      }
    } catch (err) {
      console.error("[QuackTask] add grading task error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  async function onDeleteClick(e) {
    const row = e.currentTarget.closest("[data-key]");
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
        // Keep error logging for failed deletes
        console.error("[QuackTask] delete failed:", resp?.error || "Unknown error");
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
      console.error("[QuackTask] delete error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  async function onHideClick(e) {
    const row = e.currentTarget.closest("[data-key]");
    if (!row) return;
    greyRowButtons(row, true);

    try {
      const key = row.dataset.key;
      const resp = await sendBg({ type: "ADD_BLACKLIST", assignment: key });
      if (resp && resp.ok) {
        // Panel rows we own outright. A decorated Canvas row belongs to React,
        // so leave it for the next decorate pass to hide.
        if (row.classList.contains("qtask-row")) row.remove();
      } else {
        if (DEBUG) LOG("hide error", resp?.error || "Unknown error");
      }
    } catch (err) {
      if (DEBUG) LOG("hide error", err);
    } finally {
      greyRowButtons(row, false);
    }
  }

  /* ---------------------- blacklist overlay (reliable) ---------------------- */
  let blCloseTimeout = null;

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
        overlay.classList.remove("qt-overlay-visible");
        if (blCloseTimeout) clearTimeout(blCloseTimeout);
        blCloseTimeout = setTimeout(() => {
          overlay.style.display = "none";
          blCloseTimeout = null;
        }, 200); // Wait for animation to complete
      }
    });

    makeDraggable(panel, $("#" + BL_HEAD_ID, panel));

    return overlay;
  }

  function openBlacklistOverlay() {
    if (DEBUG) LOG("open blacklist popup");
    const overlay = ensureOverlay();
    
    // Clear any pending close timeout
    if (blCloseTimeout) {
      clearTimeout(blCloseTimeout);
      blCloseTimeout = null;
    }
    
    // Ensure overlay has current theme tokens
    const sidebar = document.getElementById(WIDGET_ID);
    if (sidebar) {
      copyTokensToOverlay(sidebar, overlay);
    }
    
    overlay.style.display = "block";
    // Trigger animation on next frame
    requestAnimationFrame(() => {
      overlay.classList.add("qt-overlay-visible");
    });
    renderBlacklistList();
  }

  async function renderBlacklistList() {
    const list = document.getElementById(BL_LIST_ID);
    if (!list) return;
    list.innerHTML = `<div class="qtask-subtle">Loading…</div>`;

    try {
      const items = await sendBg({ type: "GET_BLACKLIST" });
      if (DEBUG) LOG("renderBlacklistPopup: items =", items);

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
      console.error("[QuackTask] renderBlacklistPopup error", e);
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
    
      // Capture the panel's current position before we kill the transform
      const rect = panel.getBoundingClientRect();
    
      // Immediately stop any transition so there's no easing snap
      panel.style.transition = "none";
    
      // Wait one frame so the current transform/transition fully settles
      requestAnimationFrame(() => {
        // Disable transform-based centering (so we can use pixel positions)
        panel.style.transform = "none";
    
        // Set explicit pixel-based position so dragging starts smoothly
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
    
        // Force layout reflow to apply changes instantly
        panel.offsetHeight;
    
        // Now safe to start tracking mouse movement
        sx = e.clientX;
        sy = e.clientY;
        startLeft = parseFloat(panel.style.left) || 0;
        startTop = parseFloat(panel.style.top) || 0;
    
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp, { once: true });
      });
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

  /* ---------------------- help overlay ---------------------- */
  let helpCloseTimeout = null;

  function ensureHelpOverlay() {
    let overlay = document.getElementById(HELP_OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = HELP_OVERLAY_ID;

    const panel = document.createElement("div");
    panel.id = HELP_PANEL_ID;

    panel.innerHTML = `
      <div id="${HELP_HEAD_ID}">
        <h4>QuackTask Help</h4>
        <button type="button" id="qt-help-close" class="qtask-btn qtask-add">Close</button>
      </div>
      <div id="${HELP_CONTENT_ID}"></div>
    `;

    // Immediately sync theme tokens
    const sidebar = document.getElementById(WIDGET_ID);
    if (sidebar) {
      copyTokensToOverlay(sidebar, overlay);
    }

    overlay.appendChild(panel);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.id === "qt-help-close") {
        overlay.classList.remove("qt-overlay-visible");
        if (helpCloseTimeout) clearTimeout(helpCloseTimeout);
        helpCloseTimeout = setTimeout(() => {
          overlay.style.display = "none";
          helpCloseTimeout = null;
        }, 200); // Wait for animation to complete
      }
    });

    makeDraggable(panel, $("#" + HELP_HEAD_ID, panel));

    return overlay;
  }

  function openHelpOverlay() {
    if (DEBUG) LOG("open help overlay");
    const overlay = ensureHelpOverlay();
    
    // Clear any pending close timeout
    if (helpCloseTimeout) {
      clearTimeout(helpCloseTimeout);
      helpCloseTimeout = null;
    }
    
    // Ensure overlay has current theme tokens
    const sidebar = document.getElementById(WIDGET_ID);
    if (sidebar) {
      copyTokensToOverlay(sidebar, overlay);
    }
    
    overlay.style.display = "block";
    // Trigger animation on next frame
    requestAnimationFrame(() => {
      overlay.classList.add("qt-overlay-visible");
    });
    renderHelpContent();
  }

  function renderHelpContent() {
    const content = document.getElementById(HELP_CONTENT_ID);
    if (!content) return;

    content.innerHTML = `
      <div class="qt-help-section">
        <h5>What is QuackTask?</h5>
        <p>QuackTask automatically syncs your Canvas assignments to Google Tasks, so you can stay organized without leaving Canvas.</p>
      </div>

      <div class="qt-help-section">
        <h5>How to use</h5>
        <ol class="qt-help-list">
          <li><strong>Login:</strong> Click "Login" to connect your Google account.</li>
          <li><strong>Select a list:</strong> Choose which Google Tasks list to sync assignments to.</li>
          <li><strong>Add tasks:</strong> Click "Add" on any assignment to add it to Google Tasks.</li>
          <li><strong>Manage tasks:</strong> Click "Delete" to remove from Google Tasks, or "Hide" to hide from the sidebar.</li>
        </ol>
      </div>

      <div class="qt-help-section">
        <h5>Features</h5>
        <ul class="qt-help-list">
          <li>Automatic assignment detection from Canvas</li>
          <li>Sync to Google Tasks with one click</li>
          <li>Prevents duplicate tasks</li>
          <li>Hide assignments you don't want to see</li>
          <li>View and restore hidden items from the Blacklist</li>
        </ul>
      </div>

      <div class="qt-help-section">
        <h5>Task types</h5>
        <ul class="qt-help-list">
          ${Object.keys(TYPE_META)
            .map((k) => `<li>${typeIcon(k)}${TYPE_META[k].label}</li>`)
            .join("")}
        </ul>
        <p>Use the gear menu in the QuackTask header to pick which types to show. Select as many as you like, or "All types" to clear. "Hide added to Tasks" drops anything already sitting in Google Tasks, so only what you have not triaged is left.</p>
      </div>

      <div class="qt-help-section">
        <h5>Tips</h5>
        <ul class="qt-help-list">
          <li>Make sure you're on the Canvas home page for assignments to load</li>
          <li>Hidden items are saved and won't reappear until you unhide them</li>
          <li>Tasks are linked back to their Canvas assignment pages</li>
        </ul>
      </div>

      <div class="qt-help-footer">
        <p>Built and maintained by <a href="https://owenungaro.com/" target="_blank">Owen Ungaro</a>.</p>
      </div>
    `;
  }

  /* ---------------------- observers ---------------------- */
  function watchForRerender() {
    let pending = null;
    const check = () => {
      pending = null;
      if (!onDashboard()) return;
      const host = resolveHost();
      if (!host) return;

      // Re-resolve rather than just checking that we exist: at document_idle the
      // new dashboard has not drawn its widgets yet, so the first mount can land
      // in the wrong host and has to move once the real one appears.
      // Same mode and still attached is enough. Comparing element identity
      // remounts every time React reconciles the widget subtree, which reads
      // as the panel blinking out and back in.
      const widget = document.getElementById(WIDGET_ID);
      if (widget && document.contains(widget) && HOST && HOST.mode === host.mode) {
        // Keep the mount, but refresh the references React just replaced
        HOST.el = host.el;
        HOST.sample = host.sample;
        // Canvas redraws its rows on every page turn and filter change
        if (HOST.mode === "decorate") decorateCoursework();
        else if (HOST.mode === "cards") decorateCourseCards();
        return;
      }

      if (DEBUG) LOG("sidebar mounting into", host.mode, host.el);
      mountShell(host);
      renderFromStorage();
      // Tokens are applied in mountShell, but ensure they're applied here too
      setTimeout(() => {
        const sidebar = document.getElementById(WIDGET_ID);
        if (sidebar) applyTokens(sidebar);
      }, 100);
    };

    // The new dashboard is a React app that mutates constantly, so coalesce
    // the callbacks instead of re-checking on every single mutation.
    const obs = new MutationObserver((records) => {
      // Canvas still drawing the host: hold the paint until it stops
      if (!injecting) {
        const scope = churnScope();
        if (scope) {
          for (const r of records) {
            if (scope.contains(r.target)) {
              lastChurnAt = performance.now();
              break;
            }
          }
        }
      }
      if (pending === null) pending = requestAnimationFrame(check);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // Debounced token application to prevent excessive re-applications
  let tokenApplyTimeout = null;
  function debouncedApplyTokens() {
    if (tokenApplyTimeout) {
      clearTimeout(tokenApplyTimeout);
    }
    tokenApplyTimeout = setTimeout(() => {
      const sidebar = document.getElementById(WIDGET_ID);
      if (sidebar) {
        if (DEBUG) LOG("Theme change detected, reapplying tokens");
        applyTokens(sidebar);
        // Also update overlays if they exist
        const blOverlay = document.getElementById(BL_OVERLAY_ID);
        if (blOverlay) {
          copyTokensToOverlay(sidebar, blOverlay);
        }
        const helpOverlay = document.getElementById(HELP_OVERLAY_ID);
        if (helpOverlay) {
          copyTokensToOverlay(sidebar, helpOverlay);
        }
      }
      tokenApplyTimeout = null;
    }, 50); // Small delay to batch rapid changes
  }

  function watchBetterCanvasTheme() {
    // Watch BetterCanvas theme style element if it exists
    const themeStyle = document.getElementById('bettercanvas-theme-preset');
    if (themeStyle) {
      const bcObs = new MutationObserver(() => {
        debouncedApplyTokens();
      });

      bcObs.observe(themeStyle, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        childList: true,
        subtree: true
      });
    }

    // Watch document.body for attribute changes (BetterCanvas may change body styles/classes)
    const bodyObs = new MutationObserver((mutations) => {
      // Check if any mutation affects theme-related attributes
      const hasThemeChange = mutations.some(mutation => {
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          // Watch for style, class, data-theme, or any data-* attribute changes
          return attrName === 'style' || 
                 attrName === 'class' || 
                 attrName === 'data-theme' ||
                 (attrName && attrName.startsWith('data-'));
        }
        return false;
      });
      
      if (hasThemeChange) {
        debouncedApplyTokens();
      }
    });

    bodyObs.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
      subtree: false // Only watch body itself, not children
    });

    // Also watch document.documentElement (html) for theme attributes
    const htmlObs = new MutationObserver((mutations) => {
      const hasThemeChange = mutations.some(mutation => {
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          return attrName === 'style' || 
                 attrName === 'class' || 
                 attrName === 'data-theme' ||
                 (attrName && attrName.startsWith('data-'));
        }
        return false;
      });
      
      if (hasThemeChange) {
        debouncedApplyTokens();
      }
    });

    htmlObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
      subtree: false
    });

    // Watch for BetterCanvas style element being added/removed
    const styleObserver = new MutationObserver(() => {
      const themeStyle = document.getElementById('bettercanvas-theme-preset');
      const sidebar = document.getElementById(WIDGET_ID);
      if (sidebar) {
        // If BetterCanvas style element was added or removed, reapply tokens
        debouncedApplyTokens();
      }
    });

    styleObserver.observe(document.head || document.body, {
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
    const host = resolveHost();
    if (!host) return;

    PAGE_GATE_OPEN = false; // base state - prevents any flash of stale tasks
    mountShell(host);
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
        if (DEBUG) LOG("Final token application retry");
        applyTokens(sidebar);
      }
    }, 2000);
    
    // Periodic check for theme changes (catches cases where observers might miss changes)
    // This helps ensure theme resets when BetterCanvas is disabled
    let lastBetterCanvasState = detectBetterCanvas().has;
    setInterval(() => {
      const sidebar = document.getElementById(WIDGET_ID);
      if (!sidebar) return;
      
      const currentBetterCanvasState = detectBetterCanvas().has;
      if (currentBetterCanvasState !== lastBetterCanvasState) {
        if (DEBUG) LOG("BetterCanvas state changed:", lastBetterCanvasState, "->", currentBetterCanvasState);
        lastBetterCanvasState = currentBetterCanvasState;
        // Force full token reapplication when BetterCanvas state changes
        applyTokens(sidebar);
        // Update overlays
        const blOverlay = document.getElementById(BL_OVERLAY_ID);
        if (blOverlay) {
          copyTokensToOverlay(sidebar, blOverlay);
        }
        const helpOverlay = document.getElementById(HELP_OVERLAY_ID);
        if (helpOverlay) {
          copyTokensToOverlay(sidebar, helpOverlay);
        }
      }
    }, 1000); // Check every second
  }

  try {
    boot();
  } catch (e) {
    console.error("[QuackTask] boot error", e);
  }
})();
