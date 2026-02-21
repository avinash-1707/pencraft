/**
 *
 * Electron main process entry point.
 *
 * Boot sequence:
 *   1. app 'ready' fires
 *   2. Pre-initialize Gemini client (warm SDK, no API call)
 *   3. Create hidden window (preloads renderer HTML + JS)
 *   4. Register global shortcut
 *   5. On shortcut: read selection → show window → send text to renderer
 *
 * Single instance enforced — second launch focuses existing window.
 */

const { app, globalShortcut, ipcMain } = require("electron");
const path = require("path");

// ── Load config first (resolves .env) ────────────────────────────────────────
const config = require("../config/app");
const logger = require("../utils/logger");

// ── Services ─────────────────────────────────────────────────────────────────
const geminiClient = require("../gemini/client");
const aiService = require("../services/ai");
const selectionService = require("../services/selection");
const windowManager = require("./window");
const { registerHandlers } = require("./ipc");

// ── Enforce single instance ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.warn("Pencraft: another instance is running. Exiting.");
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  // Second launch → toggle window like a shortcut press
  windowManager.toggle();
});

// ── Startup ───────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  logger.info("Pencraft starting up...");

  // 1. Verify xclip is available
  const xclipOk = await selectionService.checkXclip();
  if (!xclipOk) {
    logger.warn("xclip not found! Install with: sudo apt install xclip");
    // Don't exit — app still works without selection read
  }

  // 2. Pre-initialize Gemini SDK (no network call, just warms the client object)
  try {
    geminiClient.init();
  } catch (err) {
    // API key missing — app will still open, error shown on first generate attempt
    logger.warn("GeminiClient init warning:", err.message);
  }

  // 3. Register IPC handlers before creating window
  registerHandlers();

  // 4. Create preloaded hidden window
  const win = windowManager.createWindow();

  // 5. Wire AI service to the window for streaming IPC events
  aiService.setWindow(win);

  // 6. Register global shortcut
  const shortcutRegistered = globalShortcut.register(
    config.shortcut.toggle,
    async () => {
      logger.debug("Global shortcut triggered");

      if (windowManager.isVisible()) {
        windowManager.hide();
        return;
      }

      // Read selection BEFORE showing window (avoid focus-stealing clearing selection)
      const selectionText = await selectionService.readSelection();

      windowManager.show();

      // Send selection text to renderer after a short delay (let show animation start)
      setTimeout(() => {
        win.webContents.send("window:prefill", { text: selectionText });
      }, 50);
    },
  );

  if (!shortcutRegistered) {
    logger.error("Failed to register global shortcut:", config.shortcut.toggle);
    logger.error(
      "Another app may be using this shortcut. Change it in src/config/app.js",
    );
  } else {
    logger.info("Global shortcut registered:", config.shortcut.toggle);
  }

  logger.info("Pencraft ready.");
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  logger.info("Global shortcuts unregistered. Goodbye.");
});

// Keep app alive even with all windows closed (tray/daemon behavior)
app.on("window-all-closed", (e) => {
  // Don't quit on window close — we run as a background service
  e.preventDefault();
});

// Prevent navigation / new window opening
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
