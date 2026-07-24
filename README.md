# ComicReader

A desktop comic reader for Windows supporting CBZ, CBR, PDF, ZIP, and image folder comics.

## Requirements

- **Windows** 10 or later
- **Node.js** 18+ (includes npm)
- **npm** (ships with Node.js)

## Quick Start

```bash
npm install
npm start
```

Or double-click `Start ComicReader.bat` — it will run `npm install` automatically if `node_modules` is missing, then start the app.

## Usage

1. **Add comics** — Click "Add Folder" or "Add Files" on the Library tab, or use the Local tab to scan a folder
2. **Read** — Click any comic card to open the reader
3. **Navigate** — Use ◀ ▶ buttons, arrow keys, or scroll (vertical mode)
4. **Auto-scroll** — Toggle in the reader toolbar

## Features

- Supports CBZ, CBR, PDF, ZIP, RAR, and image folders
- Vertical, horizontal, single-page, and double-page reading modes
- Reading progress is saved and resumed automatically
- Search and sort your collection
- Fullscreen mode
- Extension support for online sources

## Build

To package as a standalone exe:

```bash
npm run build
```

Output will be in the `dist/` folder.
