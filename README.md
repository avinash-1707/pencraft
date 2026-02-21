# Pencraft ✦

> A native AI writing command palette for Linux. Press a shortcut, improve your text, done.

![Dark glass palette UI](assets/screenshot-placeholder.png)

---

## What it does

Press **Ctrl + Alt + Space** anywhere on your desktop. Pencraft appears as a floating glass panel, auto-filled with whatever text you have selected. Hit **Enter** to stream an improved version using Gemini. Copy or replace. Press **Escape**. Gone.

It works across every app — browser, VS Code, Obsidian, IntelliJ, terminal, email. Anything you can select.

---

## Quick start

### Prerequisites

```bash
# Node.js 18+ (or Bun)
sudo apt install xclip          # X11 clipboard bridge (required)
npm install -g electron         # if running without bundling
```

### Setup

```bash
git clone <repo>
cd pencraft

# Install dependencies
bun install       # or: npm install

# Configure API key
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your_key_here
# Get a key at: https://aistudio.google.com/apikey
```

### Run

```bash
bun run start     # or: npm start
# Dev mode with DevTools:
bun run dev       # or: npm run dev
```

The app starts silently in the background. Press **Ctrl + Alt + Space** to open the palette.

---

## Keyboard shortcuts

| Key                  | Action                         |
| -------------------- | ------------------------------ |
| `Ctrl + Alt + Space` | Toggle palette (global)        |
| `Enter`              | Generate (when in input)       |
| `Ctrl + Enter`       | Force generate (from anywhere) |
| `Escape`             | Close palette                  |
| `Tab`                | Cycle to next writing mode     |
| `Shift + Tab`        | Cycle to previous mode         |

---

## Writing modes

| Mode              | Shortcut key  | What it does                        |
| ----------------- | ------------- | ----------------------------------- |
| **Improve** ✦     | Default       | Clarity, structure, professionalism |
| **Shorten** ↙     | Tab to switch | Condenses to essentials             |
| **Expand** ↗      | Tab to switch | Adds depth and detail               |
| **Email** ✉       | Tab to switch | Rewrites as professional email      |
| **Fix Grammar** ✓ | Tab to switch | Corrects errors, preserves style    |

---

## Project structure

```
pencraft/
├── src/
│   ├── main/
│   │   ├── index.js        # Electron main process entry — app lifecycle
│   │   ├── window.js       # BrowserWindow factory & show/hide manager
│   │   └── ipc.js          # All IPC channel registrations
│   │
│   ├── preload/
│   │   └── index.js        # contextBridge API — only bridge to Node
│   │
│   ├── renderer/
│   │   ├── index.html      # Shell HTML (no inline scripts)
│   │   ├── style.css       # Dark glass design system
│   │   └── app.js          # All UI logic — state, IPC, keyboard, DOM
│   │
│   ├── gemini/
│   │   └── client.js       # Gemini SDK singleton — warm client, streaming
│   │
│   ├── services/
│   │   ├── ai.js           # Business logic: concurrency, error norm, caching
│   │   └── selection.js    # X11 PRIMARY selection read via xclip
│   │
│   ├── config/
│   │   └── app.js          # All constants — env vars resolved here once
│   │
│   └── utils/
│       └── logger.js       # Level-gated structured logger
│
├── assets/                 # Icons, screenshots
├── .env.example            # Config template
├── package.json
└── README.md
```

### Architecture decisions

**Why Electron?**
Global shortcuts + native window management + X11 clipboard access require OS integration. Electron provides the lowest-friction path for this on Linux while keeping web-tech rendering.

**Why preload window + hide/show (not destroy/create)?**
Re-creating a BrowserWindow takes ~200-400ms. Hiding/showing a preloaded window takes ~10ms. For a command palette, this is non-negotiable.

**Why contextIsolation + preload bridge (no nodeIntegration)?**
Security. The renderer can only call the 13 named operations exposed in `preload/index.js`. No renderer code can access the filesystem, spawn processes, or call arbitrary Node APIs.

**Why vanilla JS in the renderer?**
React/Vue add ~2MB of JS that must parse on every show. With direct DOM manipulation we load once, modify imperatively. The renderer's entire JS is ~4KB. No virtual DOM, no reconciler, no overhead.

**Why a service layer between IPC and Gemini?**
`services/ai.js` owns: concurrency guard, input validation, error normalization, result caching. The IPC handlers are thin — they validate channels, call services, return. Swapping Gemini for local LLaMA or OpenAI means changing only `services/ai.js`.

**Why streaming?**
Streaming shows the first tokens in ~300ms vs waiting 2-4s for a complete response. Users see immediate progress, which eliminates the perception of latency.

**Why xclip for PRIMARY selection?**
Electron's clipboard API only reads CLIPBOARD (Ctrl+C). Reading the X11 PRIMARY selection (highlighted text without Ctrl+C) requires a native tool. `xclip -selection primary` is the standard way. Wayland users need `wl-paste -p` — see Future section.

---

## Performance characteristics

| Operation                   | Target | How                               |
| --------------------------- | ------ | --------------------------------- |
| Shortcut → palette visible  | < 20ms | Pre-created window, CSS animation |
| First token from Gemini     | ~300ms | Warm SDK client, streaming        |
| Full generation (100 words) | 1.5-3s | 1.5-flash model                   |
| Memory footprint            | ~90MB  | No framework, lazy loads          |
| Bundle size (renderer)      | < 20KB | Vanilla JS, no bundler            |

---

## Build & package

```bash
# Build .deb package
bun run build:deb

# Build AppImage
bun run build:appimage

# Both
bun run build
```

Output goes to `dist/`.

---

## Configuration

All settings in `src/config/app.js`. Notable options:

```js
shortcut: {
  toggle: 'Control+Alt+Space',  // Change if conflicting
},

gemini: {
  model: 'gemini-1.5-flash',    // Swap to 'gemini-1.5-pro' for quality
  timeoutMs: 15_000,
},

window: {
  width: 680,                    // Adjust to taste
  height: 420,
},
```

---

## Autostart on login

```bash
# Create a systemd user service
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/pencraft.service << EOF
[Unit]
Description=Pencraft AI Writing Assistant
After=graphical-session.target

[Service]
Type=simple
ExecStart=/path/to/pencraft/node_modules/.bin/electron /path/to/pencraft/src/main/index.js
Restart=on-failure
Environment=DISPLAY=:0

[Install]
WantedBy=default.target
EOF

systemctl --user enable pencraft
systemctl --user start pencraft
```

---

## Future roadmap

Architecture is already designed for these — each requires minimal changes:

- **Slash commands** — `/improve`, `/short`, `/email` in input field → auto-sets mode
- **History panel** — `electron-store` is already a dependency; add a history side panel
- **Custom prompt templates** — user-editable modes stored in electron-store
- **Model switching** — UI dropdown backed by `config.gemini.model`
- **Local LLM fallback** — replace `gemini/client.js` with `ollama/client.js` (same interface)
- **Wayland support** — swap `xclip` calls in `services/selection.js` with `wl-clipboard`
- **Tray icon** — `app.on('ready')` → create `Tray` with context menu
- **Voice input** — add Web Speech API call in renderer before `triggerGenerate()`
- **Tone presets** — extend `config.prompts.modes` array; no other changes

---

## Troubleshooting

**Shortcut not working?**
Another app owns `Ctrl+Alt+Space`. Check output in terminal. Change `config.shortcut.toggle` in `src/config/app.js`.

**"xclip not found"?**

```bash
sudo apt install xclip
```

**Text not auto-filling?**
You must have text _selected_ (highlighted) in another window before pressing the shortcut. Text in clipboard doesn't count — it reads the X11 PRIMARY selection.

**API errors?**
Check your `GEMINI_API_KEY` in `.env`. Verify at https://aistudio.google.com/apikey

**Glass effect not showing?**
Requires a compositor (Picom, KWin, Mutter). Enable it for your window manager.

---

## License

MIT
