/**
 *
 * All IPC handlers in one place.
 *
 * Design:
 *   - ipcMain.handle() for request/response (renderer awaits)
 *   - ipcMain.on() for fire-and-forget commands
 *   - All streaming pushed from main → renderer via win.webContents.send()
 *   - No raw Node APIs exposed — only named, validated operations
 *
 * Channels:
 *   Renderer → Main (handle):
 *     'app:get-modes'         → returns prompt modes array
 *     'app:generate'          → start AI generation (streams back via events)
 *     'app:copy-result'       → copy last result to clipboard
 *     'app:get-selection'     → read PRIMARY X11 selection
 *
 *   Renderer → Main (on):
 *     'window:close'          → hide the window
 *     'window:ready'          → renderer fully loaded
 *
 *   Main → Renderer (send):
 *     'window:show'           → trigger entrance animation + pre-fill
 *     'window:hide'           → trigger exit animation
 *     'ai:start'              → generation began
 *     'ai:chunk'              → streaming text chunk
 *     'ai:done'               → generation complete
 *     'ai:error'              → error message
 */

const { ipcMain } = require("electron");
const windowManager = require("./window");
const aiService = require("../services/ai");
const selectionService = require("../services/selection");
const logger = require("../utils/logger");

function registerHandlers() {
  // ─── Query prompt modes ────────────────────────────────────────────────────
  ipcMain.handle("app:get-modes", () => {
    return {
      modes: aiService.getModes(),
      defaultMode: aiService.getDefaultMode(),
    };
  });

  // ─── Trigger AI generation ─────────────────────────────────────────────────
  ipcMain.handle("app:generate", async (_event, { text, modeId }) => {
    logger.debug("IPC app:generate mode=%s", modeId);
    // Fire and forget — results come back via streaming events
    aiService.generate(text, modeId).catch((err) => {
      logger.error("IPC app:generate unhandled:", err);
    });
    return { ok: true };
  });

  // ─── Copy last result to clipboard ─────────────────────────────────────────
  ipcMain.handle("app:copy-result", async (_event, { text }) => {
    try {
      await selectionService.writeClipboard(text);
      logger.debug("IPC app:copy-result: copied %d chars", text?.length);
      return { ok: true };
    } catch (err) {
      logger.error("IPC app:copy-result:", err.message);
      return { ok: false, error: "Failed to copy to clipboard" };
    }
  });

  // ─── Read X11 PRIMARY selection ────────────────────────────────────────────
  ipcMain.handle("app:get-selection", async () => {
    try {
      const text = await selectionService.readSelection();
      return { text };
    } catch (err) {
      logger.error("IPC app:get-selection:", err.message);
      return { text: "" };
    }
  });

  // ─── Window close request from renderer ────────────────────────────────────
  ipcMain.on("window:close", () => {
    windowManager.hide();
  });

  // ─── Renderer signals it's ready (first load) ──────────────────────────────
  ipcMain.on("window:ready", () => {
    logger.debug("IPC window:ready: renderer loaded");
  });

  logger.info("IPC handlers registered");
}

module.exports = { registerHandlers };
