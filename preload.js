const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  prepareComic: (comicData) => ipcRenderer.invoke('prepare-comic', comicData),
  clearCache: (id) => ipcRenderer.invoke('clear-cache', id),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  saveData: (key, data) => ipcRenderer.invoke('save-data', key, data),
  saveAllData: (dataMap) => ipcRenderer.invoke('save-all-data', dataMap),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  loadData: (key) => ipcRenderer.invoke('load-data', key),
  getCoverPath: (folderPath) => ipcRenderer.invoke('get-cover-path', folderPath),
  batchGetCoverPaths: (folderPaths) => ipcRenderer.invoke('batch-get-cover-paths', folderPaths),
  getCoverImage: (imagePath) => ipcRenderer.invoke('get-cover-image', imagePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  folderExists: (folderPath) => ipcRenderer.invoke('folder-exists', folderPath),
  scrapeSource: (source, action, params) => ipcRenderer.invoke('scrape-source', source, action, params),
  openExtensionBrowser: (url) => ipcRenderer.invoke('open-extension-browser', url),
  closeExtensionBrowser: () => ipcRenderer.invoke('close-extension-browser'),
  navigateExtension: (url) => ipcRenderer.invoke('navigate-extension', url),
  extensionGoBack: () => ipcRenderer.invoke('extension-go-back'),
  onExtensionPageLoaded: (callback) => ipcRenderer.on('extension-page-loaded', (event, title) => callback(title)),
  writeLog: (level, message, extra) => ipcRenderer.invoke('write-log', level, message, extra),
  getLogFile: () => ipcRenderer.invoke('get-log-file'),
  openReaderWindow: (options) => ipcRenderer.invoke('open-reader-window', options)
});
