/**
 *
 * Single source of truth for all app-level constants.
 * Environment variables are resolved here once at startup.
 * Never import dotenv anywhere else — this module owns that.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const isDev = process.env.NODE_ENV === "development";

const config = {
  // ─── App identity ─────────────────────────────────────────────────────────
  app: {
    name: "Pencraft",
    version: "1.0.0",
    isDev,
  },

  // ─── Gemini API ───────────────────────────────────────────────────────────
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    /**
     * Model selection: gemini-1.5-flash is the fastest production model.
     * Swap to gemini-1.5-pro for higher quality if latency allows.
     * Future: make this user-configurable.
     */
    model: "gemini-1.5-flash",
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 2048,
      candidateCount: 1,
    },
    // Safety: minimal blocking for writing assistant use case
    safetySettings: [],
    /** Milliseconds before we give up on an API call */
    timeoutMs: 15_000,
  },

  // ─── Global shortcut ──────────────────────────────────────────────────────
  shortcut: {
    toggle: "Control+Alt+Space",
  },

  // ─── Window geometry ──────────────────────────────────────────────────────
  window: {
    width: 680,
    height: 420,
    minWidth: 480,
    minHeight: 200,
  },

  // ─── Prompts ──────────────────────────────────────────────────────────────
  /**
   * Modular prompt system. Each mode has:
   *   id        — machine identifier
   *   label     — shown in UI
   *   icon      — single emoji glyph
   *   system    — system prompt sent before user content
   *   suffix    — appended to user message (optional)
   *
   * Future modes (not yet wired): /short, /expand, /email, /fix, /tone
   */
  prompts: {
    default: "improve",
    modes: [
      {
        id: "improve",
        label: "Improve",
        icon: "✦",
        system:
          "You are a professional writing editor. Improve the clarity, structure, and professionalism of the following text while strictly preserving the original intent and meaning. Return only the improved text — no explanations, no preamble, no quotes.",
      },
      {
        id: "shorten",
        label: "Shorten",
        icon: "↙",
        system:
          "Condense the following text to its essential meaning. Be concise and clear. Return only the shortened text — no explanations.",
      },
      {
        id: "expand",
        label: "Expand",
        icon: "↗",
        system:
          "Expand the following text with more detail, context, and depth while keeping the same tone and intent. Return only the expanded text — no explanations.",
      },
      {
        id: "email",
        label: "Email",
        icon: "✉",
        system:
          'Rewrite the following as a clear, professional email. Include a subject line prefixed with "Subject:". Return only the email — no explanations.',
      },
      {
        id: "fix",
        label: "Fix Grammar",
        icon: "✓",
        system:
          "Fix all grammar, spelling, and punctuation errors in the following text. Preserve the original style and wording as much as possible. Return only the corrected text — no explanations.",
      },
    ],
  },

  // ─── Logging ──────────────────────────────────────────────────────────────
  log: {
    level: process.env.PENCRAFT_LOG_LEVEL || (isDev ? "debug" : "error"),
  },
};

// Validate critical config at startup — fail fast
if (!config.gemini.apiKey) {
  // Non-fatal at module load time; GeminiClient will surface the error on first use
  console.warn(
    "[Pencraft] GEMINI_API_KEY is not set. Configure .env before use.",
  );
}

module.exports = config;
