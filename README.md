# 🦆 QuackTask

QuackTask is a Chrome extension that integrates directly into the Canvas dashboard and syncs your assignments to Google Tasks.  
It is designed for students at **Stevens Institute of Technology**, but support for other Canvas schools is planned for future updates.

![QuackTask preview](https://raw.githubusercontent.com/owenungaro/QuackTask/main/assets/icons/quacktask_128.png) 

---

## Overview

QuackTask connects Canvas and Google Tasks so you can manage coursework without switching tabs.  
It automatically detects assignments on your dashboard, lists them in a sidebar, and lets you sync them to Google Tasks with one click.  

The extension detects your current Canvas or BetterCanvas theme and adjusts its colors to match. Most themes work smoothly, though some heavily customized ones may look slightly different.  

At the moment, QuackTask is configured for **Stevens Canvas** (`https://sit.instructure.com/`). Once testing and performance tuning are complete, it will be expanded to work across **all Canvas instances**, so any university using Canvas can install and use it the same way.

---

## Features

**Canvas Integration**  
Automatically pulls assignments and due dates from the Canvas dashboard. Each item links directly to its Canvas assignment page.

**Google Tasks Sync**  
Send or remove assignments from Google Tasks with a single click. Everything stays synced to the list you choose.

**Persistent Google Login**  
Once connected, your Google account stays signed in through Chrome’s identity API. No repeated logins.

**Blacklist System**  
Hide assignments you do not want to see. You can restore hidden items later through the Blacklist panel.

**Dynamic Theme Detection**  
Supports light and dark modes in Canvas and most BetterCanvas themes. Colors and text adapt instantly when you switch themes without needing a reload.

**Draggable Overlays**  
The Help and Blacklist windows can be dragged anywhere on the screen and automatically match your current theme colors.

**Consistent Hover Styling**  
Hover outlines and shadows have been standardized across all supported modes for a balanced look and better readability.

---

## How to Use

1. **Open Canvas**  
   Go to [https://sit.instructure.com/](https://sit.instructure.com/) (Stevens students only for now).

2. **Launch QuackTask**  
   The sidebar loads automatically when you open the Canvas dashboard.

3. **Login with Google**  
   Click **Login** to connect your Google account through Chrome.

4. **Select a Task List**  
   Choose which Google Tasks list you want to use for your assignments.

5. **Manage Assignments**  
   - **Add:** Send an assignment to Google Tasks  
   - **Delete:** Remove it from Google Tasks  
   - **Hide:** Temporarily remove it from the sidebar  

6. **Open Blacklist and Help**  
   - **Blacklist:** View or restore hidden assignments  
   - **Help:** Read a short guide inside Canvas  

7. **Change Themes**  
   Switch between Canvas or BetterCanvas themes and watch QuackTask automatically adapt its styling.

---

## Theming Demo

Below is a preview of QuackTask reacting to multiple Canvas and BetterCanvas themes in real time.  
No page reloads are needed. Everything updates as soon as the theme changes.

![Theme demo](https://raw.githubusercontent.com/owenungaro/QuackTask/main/assets/images/quacktask_themes_gif.gif)

---

## Technical Details

**Core Stack**
- Chrome Extension (Manifest V3)  
- Google Tasks REST API  
- `chrome.identity` for authentication  
- `chrome.storage.local` for local caching  
- Mutation Observers for live Canvas and BetterCanvas updates  
- Vanilla JavaScript  

**Key Files**
- `sidebar.js` – main logic, theming, and UI rendering  
- `sidebar.css` – layout and responsive styling  
- `tasksApi.js` – Google Tasks API requests  
- `auth.js` – Google OAuth integration  
- `storage.js` – local storage management  
- `index.js` – background service worker  
- `router.js` – background message routing  

---

## Design Philosophy

QuackTask is meant to blend into Canvas as if it were built-in.  
The design is simple, with the maroon (`#9D1535`) accent color used consistently across buttons and highlights.  
It prioritizes readability and alignment with each user’s current theme.  

Because Canvas themes vary across institutions, full universal compatibility will be introduced once cross-domain support is tested and verified.  
This upcoming expansion will allow students from any Canvas-based university to use QuackTask on their dashboard.

---

## Installation for Developers

1. Clone this repository:
   ```bash
   git clone https://github.com/owenungaro/QuackTask.git
   cd QuackTask
