/**
 *
 * The ONLY bridge between the sandboxed renderer and Node/Electron.
 * Exposes a narrow, typed API via contextBridge — no raw Node globals.
 *
 * Everything exposed here is intentional and auditable.
 * The renderer never gets ipcRenderer directly.
 */

const { contextBridge, ipcRenderer } = require("electron");

// ─── Whitelist of valid IPC channels ─────────────────────────────────────────
const VALID_SEND = new Set(["window:close", "window:ready"]);
const VALID_HANDLE = new Set([
  "app:get-modes",
  "app:generate",
  "app:copy-result",
  "app:get-selection",
]);
const VALID_EVENTS = new Set([
  "window:show",
  "window:hide",
  "window:prefill",
  "ai:start",
  "ai:chunk",
  "ai:done",
  "ai:error",
]);

contextBridge.exposeInMainWorld("pencraft", {
  // ── Invoke (request → response) ──────────────────────────────────────────
  invoke(channel, data) {
    if (!VALID_HANDLE.has(channel)) {
      throw new Error(
        `[preload] Blocked invoke on unknown channel: ${channel}`,
      );
    }
    return ipcRenderer.invoke(channel, data);
  },

  // ── Fire-and-forget send ─────────────────────────────────────────────────
  send(channel, data) {
    if (!VALID_SEND.has(channel)) {
      throw new Error(`[preload] Blocked send on unknown channel: ${channel}`);
    }
    ipcRenderer.send(channel, data);
  },

  // ── Subscribe to main-process events ────────────────────────────────────
  on(channel, callback) {
    if (!VALID_EVENTS.has(channel)) {
      throw new Error(
        `[preload] Blocked listener on unknown channel: ${channel}`,
      );
    }
    const wrapped = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    // Return cleanup function
    return () => ipcRenderer.off(channel, wrapped);
  },

  // ── Remove all listeners (called on cleanup) ─────────────────────────────
  removeAllListeners(channel) {
    if (VALID_EVENTS.has(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
});
