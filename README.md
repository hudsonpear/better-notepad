<p align="center">
  <img src="https://i.imgur.com/pibtyie.png" height="150px">
</p>

# <p align="center">Better Notepad</p>

<p align="center"> A modern, feature-rich text editor built with Tauri. </p>

<p align="center">  <b>Supported Formats:</b> txt, md, log, ini, bat, cfg, vbs, reg, sh, ps1, js, html, htm, css, xml, json </p>

## Features

- 📄 Smart Encoding Detection - Automatically detects and handles UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, and ANSI
- 🤗 Emoji Support - Full Unicode emoji rendering and input
- 🗂️ Multi-Tab Interface - Work on multiple files simultaneously with unlimited tabs
- ✂️ Smart Line Operations - Ctrl+X cuts entire line when no text is selected
- ♻ Reopen Closed Tabs - Ctrl+Shift+T restores recently closed tabs
- 🔍 Find & Replace - Powerful search with regex support and real-time highlighting
- ↪ Go to Line - Jump to any line instantly with Ctrl+G
- ⛶ Zoom Controls - Per-file zoom levels (50% - 300%)
- 🎨 8 Built-in Themes - Dark, Light, Nord, Dark Grey, Light Grey, Dark Blue, Dark Pink, Dark Green
- 🧮 Custom Themes - Import/create your own JSON theme files
- ¹²³ Line Numbers - Optional gutter with current line highlighting
- 📌 Visual Search Map - Scrollbar markers show all match locations at a glance
- ⚙️ Auto-Save Settings - Window position, size, and per-file zoom persist automatically

### Keyboard Shortcuts

#### File Operations
- `Ctrl+N` - New file
- `Ctrl+O` - Open file(s)
- `Ctrl+S` - Save current file
- `Ctrl+Shift+S` - Save As
- `Ctrl+Shift+Alt+S` - Save all tabs
- `Ctrl+W` - Close current tab
- `Ctrl+Shift+T` - Reopen closed tab
- `Ctrl+P` - Print

#### Navigation
- `Ctrl+Tab` - Next tab
- `Ctrl+G` - Go to line
- `Ctrl+F` - Find
- `Ctrl+H` - Replace
- `F3` / `Shift+F3` - Next/Previous match

#### Editing
- `Tab` - Insert 2 spaces
- `Ctrl+X` - Cut line (when nothing selected)
- `Ctrl+Z` / `Ctrl+Y` - Undo/Redo

#### View
- `Ctrl+0` - Reset zoom
- `Ctrl++` / `Ctrl+-` - Zoom in/out
- `Ctrl+Wheel` - Zoom with mouse

## Download

Available for Windows

[Download Latest Release](https://github.com/hudsonpear/better-notepad/releases)

## Screenshot

![screenshot1](https://i.imgur.com/MDURRxy.png)

## How to Build

<b>Requirements:</b> Node.js (LTS), Rust, Tauri prerequisites for your OS

Install dependencies with:

```
npm install
```

then run with:

```
npm run tauri dev
```

to compile:

```
npx tauri build
```
