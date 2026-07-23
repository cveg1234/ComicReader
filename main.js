const { app, BrowserWindow, ipcMain, dialog, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { URL } = require('url');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
const { createCanvas } = require('canvas');

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'comicreader.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLog(level, message, extra) {
  try {
    ensureLogDir();
    const entry = `[${new Date().toISOString()}] [${level}] ${message}${extra ? ' ' + JSON.stringify(extra) : ''}\n`;
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const rotated = LOG_FILE.replace('.log', '.old.log');
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(LOG_FILE, rotated);
      }
    }
    fs.appendFileSync(LOG_FILE, entry);
  } catch (e) { /* dont crash on log failure */ }
}

const pdfWarn = console.warn;
console.warn = function(...args) {
  if (args[0] && typeof args[0] === 'string' &&
      (args[0].includes('Indexing all') || args[0].includes('indexObjects:') ||
       args[0].includes('trying to recover'))) return;
  pdfWarn.apply(console, args);
};

let mainWindow;
let extensionView = null;
const comicCache = {};
const coverPathCache = new Map();
let cacheId = 0;
const TEMP_PREFIX = 'comic-';

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

function cleanupOldTempFiles() {
  try {
    const tmpDir = app.getPath('temp');
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith(TEMP_PREFIX)) {
        const filePath = path.join(tmpDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch (e) { /* skip */ }
      }
    }
    if (cleaned > 0) writeLog('INFO', `Cleaned ${cleaned} old temp files`);
  } catch (e) {
    writeLog('WARN', 'Temp cleanup failed', { error: e.message });
  }
}

function cleanupComicCache(id) {
  if (comicCache[id]) {
    const cache = comicCache[id];
    if (cache.type === 'pdf' && cache.doc) {
      cache.doc.destroy().catch(() => {});
    }
    delete comicCache[id];
    writeLog('INFO', `Cache cleaned: ${id}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);

  mainWindow.webContents.on('crashed', () => {
    writeLog('ERROR', 'Renderer process crashed');
  });

  mainWindow.on('unresponsive', () => {
    writeLog('WARN', 'Main window became unresponsive');
  });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  const cachePath = path.join(userDataPath, 'cache');
  try {
    if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });
    app.setPath('cache', cachePath);
  } catch (e) {
    writeLog('WARN', 'Could not set cache path', { error: e.message });
  }

  cleanupOldTempFiles();

  protocol.registerFileProtocol('comic', (request, callback) => {
    try {
      const url = new URL(request.url);
      const cacheKey = url.hostname;
      const pageIndex = parseInt(url.pathname.slice(1));
      const cache = comicCache[cacheKey];
      if (!cache) {
        callback({ error: -6 });
        return;
      }
      if (cache.type === 'folder') {
        const filePath = cache.pages[pageIndex];
        callback({ path: filePath });
      } else if (cache.type === 'archive') {
        const entry = cache.zip.getEntries()[cache.pageIndices[pageIndex]];
        if (entry) {
          const ext = path.extname(entry.entryName) || '.jpg';
          const tmpPath = path.join(app.getPath('temp'), `${TEMP_PREFIX}${cacheKey}-${pageIndex}${ext}`);
          if (fs.existsSync(tmpPath)) {
            callback({ path: tmpPath });
            return;
          }
          const buffer = entry.getData();
          fs.writeFileSync(tmpPath, buffer);
          callback({ path: tmpPath });
        } else {
          callback({ error: -6 });
        }
      } else if (cache.type === 'pdf') {
        renderPdfPage(cache.doc, cacheKey, pageIndex)
          .then(tmpPath => callback({ path: tmpPath }))
          .catch(err => {
            writeLog('ERROR', 'PDF page render failed', { cacheKey, pageIndex, error: err.message });
            callback({ error: -6 });
          });
      }
    } catch (err) {
      writeLog('ERROR', 'Protocol handler error', { error: err.message });
      callback({ error: -6 });
    }
  });

  async function renderPdfPage(doc, cacheKey, pageIndex) {
    const tmpPath = path.join(app.getPath('temp'), `${TEMP_PREFIX}${cacheKey}-${pageIndex}.png`);
    if (fs.existsSync(tmpPath)) return tmpPath;
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(tmpPath, buffer);
    page.cleanup();
    return tmpPath;
  }

  protocol.registerFileProtocol('cover', (request, callback) => {
    try {
      const encodedPath = request.url.slice('cover://'.length);
      const filePath = decodeURIComponent(encodedPath);
      if (filePath && fs.existsSync(filePath)) {
        callback({ path: filePath });
      } else {
        callback({ error: -6 });
      }
    } catch (e) {
      callback({ error: -6 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  for (const id of Object.keys(comicCache)) {
    cleanupComicCache(id);
  }
  cleanupOldTempFiles();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('select-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  } catch (err) {
    writeLog('ERROR', 'select-folder failed', { error: err.message });
    return null;
  }
});

ipcMain.handle('select-files', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Comic Files', extensions: ['cbz', 'cbr', 'pdf', 'zip', 'rar'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  } catch (err) {
    writeLog('ERROR', 'select-files failed', { error: err.message });
    return [];
  }
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
  try {
    return await scanFolder(folderPath);
  } catch (err) {
    writeLog('ERROR', 'scan-folder failed', { folderPath, error: err.message });
    return [];
  }
});

ipcMain.handle('prepare-comic', async (event, comicData) => {
  const id = `comic-${cacheId++}`;
  try {
    if (comicData.type === 'folder') {
      const files = await fs.promises.readdir(comicData.path);
      const images = files
        .filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(f))
        .sort((a, b) => naturalSort(a, b));

      const pagePaths = images.map(img => path.join(comicData.path, img));
      const coverPath = images.length > 0 ? path.join(comicData.path, images[0]) : null;

      comicCache[id] = {
        type: 'folder',
        pages: pagePaths,
        count: pagePaths.length
      };

      return {
        success: true,
        cacheId: id,
        count: pagePaths.length,
        coverUrl: coverPath ? `comic://${id}/0` : null,
        pages: images.map((name, i) => ({
          name,
          url: `comic://${id}/${i}`
        }))
      };
    }

    const ext = path.extname(comicData.path).toLowerCase();

    if (ext === '.pdf') {
      const data = new Uint8Array(await fs.promises.readFile(comicData.path));
      const doc = await pdfjsLib.getDocument(data).promise;
      const pageCount = doc.numPages;

      comicCache[id] = {
        type: 'pdf',
        doc,
        count: pageCount
      };

      for (let i = 0; i < Math.min(3, pageCount); i++) {
        renderPdfPage(doc, id, i).catch(() => {});
      }

      const pages = [];
      for (let i = 0; i < pageCount; i++) {
        pages.push({
          name: `Page ${i + 1}`,
          url: `comic://${id}/${i}`
        });
      }

      return {
        success: true,
        cacheId: id,
        count: pageCount,
        coverUrl: pageCount > 0 ? `comic://${id}/0` : null,
        pages
      };
    }

    if (ext === '.cbr' || ext === '.rar') {
      try {
        const unrar = require('unrar-js');
        const data = await fs.promises.readFile(comicData.path);
        const archive = new unrar(data);

        const entries = archive.entries;
        const imageEntries = entries
          .filter(e => !e.flags && /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(e.name))
          .sort((a, b) => naturalSort(a.name, b.name));

        comicCache[id] = {
          type: 'archive',
          zip: null,
          unrarArchive: archive,
          pageIndices: imageEntries.map((e, i) => i),
          imageEntries,
          count: imageEntries.length
        };

        return {
          success: true,
          cacheId: id,
          count: imageEntries.length,
          pages: imageEntries.map((e, i) => ({
            name: e.name,
            url: `comic://${id}/${i}`
          }))
        };
      } catch (err) {
        writeLog('ERROR', 'RAR extraction failed', { path: comicData.path, error: err.message });
        return { success: false, error: `RAR extraction failed: ${err.message}` };
      }
    }

    if (['.cbz', '.zip'].includes(ext)) {
      const zip = new AdmZip(comicData.path);
      const entries = zip.getEntries();
      const imageEntries = entries
        .filter(e => !e.isDirectory && /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(e.entryName))
        .sort((a, b) => naturalSort(a, b));

      const pageIndices = imageEntries.map((e, i) => entries.indexOf(e));

      comicCache[id] = {
        type: 'archive',
        zip,
        pageIndices,
        count: imageEntries.length
      };

      return {
        success: true,
        cacheId: id,
        count: imageEntries.length,
        pages: imageEntries.map((e, i) => ({
          name: e.entryName,
          url: `comic://${id}/${i}`
        }))
      };
    }

    return { success: false, error: `Unsupported format: ${ext}` };
  } catch (err) {
    writeLog('ERROR', 'prepare-comic failed', { comicData, error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-cache', async (event, id) => {
  cleanupComicCache(id);
});

ipcMain.handle('get-file-info', async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      name: path.basename(filePath),
      size: stats.size,
      modified: stats.mtime,
      ext: path.extname(filePath).toLowerCase()
    };
  } catch (err) {
    writeLog('WARN', 'get-file-info failed', { filePath, error: err.message });
    return null;
  }
});

ipcMain.handle('save-data', async (event, key, data) => {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'comicreader-db.json');
    await fs.promises.mkdir(userDataPath, { recursive: true });
    let db = {};

    try {
      const raw = await fs.promises.readFile(dbPath, 'utf-8');
      db = JSON.parse(raw);
    } catch {}

    db[key] = data;
    await fs.promises.writeFile(dbPath, JSON.stringify(db), 'utf-8');
    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'save-data failed', { key, error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings), 'utf-8');
    writeLog('INFO', `Settings saved to ${settingsPath}`);
    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'save-settings failed', { error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const raw = await fs.promises.readFile(settingsPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle('save-all-data', async (event, dataMap) => {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'comicreader-db.json');
    await fs.promises.mkdir(userDataPath, { recursive: true });
    let db = {};

    try {
      const raw = await fs.promises.readFile(dbPath, 'utf-8');
      db = JSON.parse(raw);
    } catch {}

    for (const [key, value] of Object.entries(dataMap)) {
      db[key] = value;
    }
    await fs.promises.writeFile(dbPath, JSON.stringify(db), 'utf-8');
    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'save-all-data failed', { error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-data', async (event, key) => {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'comicreader-db.json');

    let raw;
    try {
      raw = await fs.promises.readFile(dbPath, 'utf-8');
    } catch {
      return null;
    }

    const db = JSON.parse(raw);
    return db[key] || null;
  } catch (err) {
    writeLog('WARN', 'load-data failed', { key, error: err.message });
    return null;
  }
});

ipcMain.handle('get-cover-image', async (event, imagePath) => {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return null;
    const buffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif' };
    const mime = mimeMap[ext] || 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    writeLog('WARN', 'get-cover-image failed', { imagePath, error: err.message });
    return null;
  }
});

ipcMain.handle('get-cover-path', async (event, folderPath) => {
  try {
    if (coverPathCache.has(folderPath)) {
      const cached = coverPathCache.get(folderPath);
      if (cached && fs.existsSync(cached)) return cached;
    }
    const files = await fs.promises.readdir(folderPath);
    const images = files
      .filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(f))
      .sort((a, b) => naturalSort(a, b));
    const result = images.length > 0 ? path.join(folderPath, images[0]) : null;
    if (result) coverPathCache.set(folderPath, result);
    return result;
  } catch (err) {
    writeLog('WARN', 'get-cover-path failed', { folderPath, error: err.message });
    return null;
  }
});

ipcMain.handle('batch-get-cover-paths', async (event, folderPaths) => {
  const results = {};
  const uncached = [];
  for (const fp of folderPaths) {
    if (coverPathCache.has(fp)) {
      const cached = coverPathCache.get(fp);
      if (cached && fs.existsSync(cached)) {
        results[fp] = cached;
      } else {
        uncached.push(fp);
      }
    } else {
      uncached.push(fp);
    }
  }
  await Promise.all(uncached.map(async (fp) => {
    try {
      const files = await fs.promises.readdir(fp);
      const images = files
        .filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(f))
        .sort((a, b) => naturalSort(a, b));
      const result = images.length > 0 ? path.join(fp, images[0]) : null;
      if (result) coverPathCache.set(fp, result);
      results[fp] = result;
    } catch {
      results[fp] = null;
    }
  }));
  return results;
});

ipcMain.handle('folder-exists', async (event, folderPath) => {
  try {
    return fs.existsSync(folderPath);
  } catch (err) {
    return false;
  }
});

ipcMain.handle('open-extension-browser', async (event, url) => {
  try {
    const { WebContentsView } = require('electron');
    extensionView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.contentView.addChildView(extensionView);

    const contentBounds = mainWindow.getContentBounds();
    extensionView.setBounds({
      x: 0,
      y: 0,
      width: contentBounds.width,
      height: contentBounds.height
    });

    extensionView.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('extension-page-loaded', extensionView.webContents.getTitle());
    });

    await extensionView.webContents.loadURL(url);
    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'open-extension-browser failed', { url, error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('close-extension-browser', async () => {
  try {
    if (extensionView) {
      mainWindow.contentView.removeChildView(extensionView);
      extensionView.webContents.destroy();
      extensionView = null;
    }
    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'close-extension-browser failed', { error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('navigate-extension', async (event, url) => {
  if (extensionView) {
    try {
      await extensionView.webContents.loadURL(url);
      return { success: true };
    } catch (err) {
      writeLog('ERROR', 'navigate-extension failed', { url, error: err.message });
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No extension view active' };
});

ipcMain.handle('extension-go-back', async () => {
  if (extensionView && extensionView.webContents.canGoBack()) {
    extensionView.webContents.goBack();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('open-external', async (event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});

ipcMain.handle('scrape-source', async (event, source, action, params) => {
  try {
    const scraper = require('./js/scraper');
    const result = await scraper.scrapeSource(source, action, params);
    return { success: true, data: result };
  } catch (err) {
    writeLog('ERROR', 'scrape-source failed', { source, action, error: err.message });
    return { success: false, error: err.message, data: [] };
  }
});

ipcMain.handle('open-reader-window', async (event, options) => {
  try {
    const readerWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      minWidth: 600,
      minHeight: 400,
      backgroundColor: '#0d0d1a',
      title: options.name || 'Comic Reader',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    readerWindow.loadFile('reader-window.html', {
      query: {
        cacheId: options.cacheId,
        name: options.name || '',
        count: String(options.count || 0),
        page: String(options.page || 0),
        mode: options.mode || 'single',
        comic: options.comic ? encodeURIComponent(JSON.stringify(options.comic)) : ''
      }
    });

    readerWindow.on('closed', () => {
      if (options.cacheId) {
        cleanupComicCache(options.cacheId);
      }
    });

    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'open-reader-window failed', { error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-log-file', async () => {
  try {
    ensureLogDir();
    if (fs.existsSync(LOG_FILE)) {
      return fs.readFileSync(LOG_FILE, 'utf-8');
    }
    return '';
  } catch (err) {
    return '';
  }
});

ipcMain.handle('write-log', async (event, level, message, extra) => {
  writeLog(level, message, extra);
});

function naturalSort(a, b) {
  const aStr = typeof a === 'string' ? a : a.entryName;
  const bStr = typeof b === 'string' ? b : b.entryName;
  const aParts = aStr.match(/(\d+|\D+)/g) || [];
  const bParts = bStr.match(/(\d+|\D+)/g) || [];
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || '';
    const bPart = bParts[i] || '';
    const aNum = parseInt(aPart, 10);
    const bNum = parseInt(bPart, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      if (aPart !== bPart) return aPart.localeCompare(bPart);
    }
  }
  return 0;
}

async function scanFolder(folderPath) {
  const results = [];

  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      try {
        if (entry.isDirectory()) {
          let subEntries;
          try {
            subEntries = await fs.promises.readdir(fullPath, { withFileTypes: true });
          } catch {
            subEntries = [];
          }
          const hasImages = subEntries.some(f => f.isFile() && /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(f.name));

          if (hasImages) {
            results.push({
              type: 'folder',
              name: entry.name,
              path: fullPath,
              imageCount: subEntries.filter(f => f.isFile() && /\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(f.name)).length
            });
          } else {
            const subResults = await scanFolder(fullPath);
            results.push(...subResults);
          }
        } else if (!entry.isDirectory() && /\.(cbz|cbr|pdf|zip|rar)$/i.test(entry.name)) {
          results.push({
            type: 'file',
            name: entry.name,
            path: fullPath,
            ext: path.extname(entry.name).toLowerCase()
          });
        }
      } catch (err) {
        writeLog('WARN', 'scanFolder: cannot read entry', { entry: fullPath, error: err.message });
      }
    }
  } catch (err) {
    writeLog('ERROR', 'scanFolder failed', { folderPath, error: err.message });
  }

  return results;
}
