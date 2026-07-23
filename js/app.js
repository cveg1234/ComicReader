class ComicApp {
  constructor() {
    this.library = [];
    this.localComics = [];
    this.history = [];
    this.localFolders = [];
    this.settings = this.getDefaultSettings();
    this.currentView = 'library';
    this.viewMode = 'grid';
    this.searchQuery = '';
    this.sortBy = 'dateAdded';
    this.isReturningFromReader = false;
    this.coverLoadLocked = false;
    this._comicLookup = new Map();
    this._filteredComicsCache = null;
    this._cacheValid = false;
    this.bindEvents();
  }

  invalidateCache() {
    this._cacheValid = false;
  }

  getAllComics() {
    return [...this.localComics, ...this.library];
  }

  buildComicLookup() {
    this._comicLookup.clear();
    for (const comic of this.getAllComics()) {
      if (!this._comicLookup.has(comic.id)) {
        this._comicLookup.set(comic.id, comic);
      }
    }
  }

  sortComics(comics) {
    switch (this.sortBy) {
      case 'name':
        comics.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'dateAdded':
        comics.sort((a, b) => b.dateAdded - a.dateAdded);
        break;
      case 'lastRead':
        comics.sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0));
        break;
      case 'unread':
        comics.sort((a, b) => b.unread - a.unread);
        break;
    }
  }

  getFilteredComics() {
    if (this._cacheValid && this._filteredComicsCache) {
      return this._filteredComicsCache;
    }

    this.buildComicLookup();

    const comicMap = new Map();
    for (const comic of this.getAllComics()) {
      const key = comic.sourcePath || comic.id;
      const existing = comicMap.get(key);
      if (!existing || (comic.coverPath && !existing.coverPath) || (comic.cover && !existing.cover)) {
        comicMap.set(key, comic);
      }
    }
    let comics = Array.from(comicMap.values());

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      comics = comics.filter(c => c.name.toLowerCase().includes(q));
    }

    this.sortComics(comics);

    this._filteredComicsCache = comics;
    this._cacheValid = true;
    return comics;
  }

  getDefaultSettings() {
    return {
      theme: 'dark',
      readingMode: 'vertical',
      fitScreen: 'height',
      readerBg: 'black',
      pagePreload: 2,
      pageGap: 4,
      accentColor: '#4CAF50',
      gridSize: 160,
      showTitles: true,
      showBadges: true,
      autoScan: false,
      watchFiles: false
    };
  }

  async init() {
    try {
      await this.loadData();
      await this.loadSettingsFromStorage();
      this.applySettings();
      this.renderLibrary();
      this.renderLocal();
      this.updateEmptyStates();
      this.renderLocalFolders();
      logger.info('App initialized');
    } catch (err) {
      logger.error('App initialization failed', err);
      this.showToast('Failed to initialize: ' + err.message, 'error');
    }
  }

  async loadData() {
    try {
      const saved = await window.electronAPI.loadData('library');
      if (saved) this.library = saved;

      const hist = await window.electronAPI.loadData('history');
      if (hist) this.history = hist;

      const folders = await window.electronAPI.loadData('localFolders');
      if (folders) this.localFolders = folders;

      const localComics = await window.electronAPI.loadData('localComics');
      
      const uniqueComicsMap = new Map();
      if (localComics) {
        for (const comic of localComics) {
          const key = comic.sourcePath || comic.id;
          if (!uniqueComicsMap.has(key)) {
            uniqueComicsMap.set(key, comic);
          } else {
            const existing = uniqueComicsMap.get(key);
            if (comic.coverPath && !existing.coverPath) {
              existing.coverPath = comic.coverPath;
            } else if (comic.cover && !existing.cover) {
              existing.cover = comic.cover;
            }
            if (comic.progress > existing.progress) {
              existing.progress = comic.progress;
              existing.lastRead = comic.lastRead;
              existing.unread = comic.unread;
            }
          }
        }
        this.localComics = Array.from(uniqueComicsMap.values());
      }

      const staleFolders = [];
      for (let i = this.localFolders.length - 1; i >= 0; i--) {
        if (!(await window.electronAPI.folderExists(this.localFolders[i]))) {
          staleFolders.push(this.localFolders[i]);
          this.localFolders.splice(i, 1);
        }
      }
      if (staleFolders.length > 0) {
        this.localComics = this.localComics.filter(c => c.type !== 'folder' || !staleFolders.some(f => c.sourcePath && c.sourcePath.startsWith(f)));
        await this.saveData();
      }

      if (this.localFolders.length > 0) {
        for (const folderPath of this.localFolders) {
          await this.scanFolderAtPath(folderPath, true);
        }
      }
    } catch (err) {
      logger.error('Failed to load data', err);
    }
  }

  async saveData() {
    try {
      await window.electronAPI.saveData('localFolders', this.localFolders);
      await window.electronAPI.saveData('localComics', this.localComics);
      await window.electronAPI.saveData('library', this.library);
      await window.electronAPI.saveData('history', this.history);
    } catch (err) {
      logger.error('Failed to save data', err);
      this.showToast('Failed to save: ' + err.message, 'error');
    }
  }

  async saveSettingsOnly() {
    try {
      localStorage.setItem('comicreader-settings', JSON.stringify(this.settings));
      const result = await window.electronAPI.saveSettings(this.settings);
      if (result?.success) {
        logger.info('Settings saved');
      } else {
        logger.warn('IPC settings save failed', result?.error);
      }
    } catch (err) {
      logger.error('Failed to save settings', err);
    }
  }

  async loadSettingsFromStorage() {
    try {
      const raw = localStorage.getItem('comicreader-settings');
      if (raw) {
        const saved = JSON.parse(raw);
        this.settings = { ...this.getDefaultSettings(), ...saved };
        logger.info('Settings loaded from localStorage', { autoScan: this.settings.autoScan });
      } else {
        logger.info('No settings in localStorage, checking settings.json fallback');
        const saved = await window.electronAPI.loadSettings();
        if (saved) {
          this.settings = { ...this.getDefaultSettings(), ...saved };
          localStorage.setItem('comicreader-settings', JSON.stringify(this.settings));
          logger.info('Settings migrated from settings.json to localStorage');
        }
      }
    } catch (err) {
      logger.warn('Failed to load settings', err);
    }
  }

  bindEvents() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', () => this.switchView(item.dataset.view));
    });

    document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());

    document.getElementById('add-folder-btn').addEventListener('click', () => this.addFolder());
    document.getElementById('add-files-btn').addEventListener('click', () => this.addFiles());
    document.getElementById('add-folder-empty').addEventListener('click', () => this.addFolder());
    document.getElementById('add-files-empty').addEventListener('click', () => this.addFiles());

    document.getElementById('scan-local-btn').addEventListener('click', () => this.scanFolder());
    document.getElementById('refresh-local-btn').addEventListener('click', () => this.refreshAllFolders());
    document.getElementById('add-local-files-btn').addEventListener('click', () => this.addFiles());
    document.getElementById('scan-empty').addEventListener('click', () => this.scanFolder());

    document.getElementById('comic-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.comic-card');
      if (!card) return;
      const comic = this.localComics.find(c => c.id === card.dataset.id) || this.library.find(c => c.id === card.dataset.id);
      if (comic) {
        this.openReader(comic.id, comic.progress + 1 || 1);
      }
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.invalidateCache();
      this.debouncedRender();
    });

    let renderTimeout;
    this.debouncedRender = () => {
      clearTimeout(renderTimeout);
      renderTimeout = setTimeout(() => this.renderCurrentView(), 150);
    };

    document.getElementById('sort-select').addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.invalidateCache();
      this.renderCurrentView();
    });

    document.getElementById('close-detail').addEventListener('click', () => this.closeComicDetail());
    document.getElementById('close-settings').addEventListener('click', () => this.closeSettings());

    document.getElementById('start-reading-btn').addEventListener('click', () => this.startReading());
    document.getElementById('add-library-btn').addEventListener('click', () => this.addToLibrary());

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        const extOverlay = document.getElementById('extension-browser-overlay');
        if (extOverlay && extOverlay.classList.contains('active')) {
          this.closeExtensionBrowser();
        }
      }
    });
  }

  renderCurrentView() {
    if (this.currentView === 'library') {
      this.renderLibrary();
    } else if (this.currentView === 'local') {
      this.renderLocal();
    }
  }

  switchView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${view}-view`).classList.add('active');

    this.updateEmptyStates();
    if (view === 'history' && this.history.length > 0) {
      this.renderHistory();
    }
  }

  async addFolder() {
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (!folderPath) return;

      if (this.localFolders.includes(folderPath)) {
        this.showToast('Folder already added', 'warning');
        return;
      }

      this.localFolders.push(folderPath);
      await this.saveData();
      await this.scanFolderAtPath(folderPath);
      this.renderLocalFolders();
      this.showToast('Folder added and scanned', 'success');
    } catch (err) {
      logger.error('Failed to add folder', err);
      this.showToast('Failed to add folder: ' + err.message, 'error');
    }
  }

  async addFiles() {
    try {
      const files = await window.electronAPI.selectFiles();
      if (!files.length) return;

      for (const file of files) {
        const existingIndex = this.localComics.findIndex(c => c.sourcePath === file);
        if (existingIndex >= 0) {
          continue;
        }

        const info = await window.electronAPI.getFileInfo(file);
        if (!info) continue;

        const name = info.name.replace(/\.(cbz|cbr|zip|rar|pdf)$/i, '');
        const comic = {
          id: `comic-${this.localComics.length + 1}`,
          name: name,
          type: 'file',
          sourcePath: file,
          sourceType: info.ext,
          pageCount: 0,
          progress: 0,
          lastRead: null,
          dateAdded: Date.now(),
          unread: 1,
          bookmarked: false
        };

this.localComics.push(comic);
      }

      await this.saveData();
      this.invalidateCache();
      this.renderLibrary();
      this.renderLocal();
      this.updateEmptyStates();
      this.showToast(`${files.length} file(s) added`, 'success');
      logger.info('Files added', { count: files.length });
    } catch (err) {
      logger.error('Failed to add files', err);
      this.showToast('Failed to add files: ' + err.message, 'error');
    }
  }

  async scanFolder() {
    const folderPath = await window.electronAPI.selectFolder();
    if (!folderPath) return;

    await this.scanFolderAtPath(folderPath);
  }

  async refreshFolder(folderPath) {
    try {
      const exists = await window.electronAPI.folderExists(folderPath);
      if (!exists) {
        const index = this.localFolders.indexOf(folderPath);
        if (index >= 0) {
          this.localFolders.splice(index, 1);
          await this.saveData();
          this.renderLocalFolders();
          this.showToast('Folder not found, removed from list', 'warning');
        }
        return;
      }

      this.showToast('Refreshing folder...', 'info');
      const existingComics = this.localComics.filter(c => c.sourcePath.startsWith(folderPath));
      const results = await window.electronAPI.scanFolder(folderPath);
      let newCount = 0;
      let updatedCount = 0;

      const newComics = [];
      const comicsNeedingCover = [];

      for (const item of results) {
        const existingIndex = this.localComics.findIndex(c => c.sourcePath === item.path);
        if (existingIndex >= 0) {
          const existing = this.localComics[existingIndex];
          existing.pageCount = item.imageCount || existing.pageCount;
          if (item.type === 'folder' && !existing.cover) {
            comicsNeedingCover.push(existing);
          }
          continue;
        }

        const comic = {
          id: `comic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: item.name,
          type: item.type,
          sourcePath: item.path,
          sourceType: item.type === 'folder' ? 'folder' : item.ext,
          pageCount: item.imageCount || 0,
          progress: 0,
          lastRead: null,
          dateAdded: Date.now(),
          unread: 1,
          bookmarked: false,
          cover: null,
          coverPath: null
        };

        this.localComics.push(comic);
        newComics.push(comic);
        if (item.type === 'folder') {
          comicsNeedingCover.push(comic);
        }
        newCount++;
      }

      for (const comic of existingComics) {
        const stillExists = results.some(r => r.path === comic.sourcePath);
        if (!stillExists) {
          comic.unread = 0;
          updatedCount++;
        }
      }

      await this.saveData();
      this.invalidateCache();
      this.renderLibrary();
      this.renderLocal();
      this.updateEmptyStates();

      this.loadCoversInBackground(comicsNeedingCover);

      this.showToast(`Refreshed: ${newCount} new comics found`, 'success');
    } catch (err) {
      logger.error('refreshFolder failed', err, { folderPath });
      this.showToast('Refresh failed: ' + err.message, 'error');
    }
  }

  async refreshAllFolders() {
    if (this.localFolders.length === 0) {
      this.showToast('No folders to refresh', 'warning');
      return;
    }

    try {
      this.showToast('Refreshing all folders...', 'info');
      let totalNew = 0;
      const removedFolders = [];

      for (let i = this.localFolders.length - 1; i >= 0; i--) {
        const folderPath = this.localFolders[i];
        const exists = await window.electronAPI.folderExists(folderPath);

        if (!exists) {
          this.localFolders.splice(i, 1);
          removedFolders.push(folderPath);
          continue;
        }

        const results = await window.electronAPI.scanFolder(folderPath);
        let newCount = 0;
        const comicsNeedingCover = [];

        for (const item of results) {
          const existingIndex = this.localComics.findIndex(c => c.sourcePath === item.path);
          if (existingIndex >= 0) {
            const existing = this.localComics[existingIndex];
            existing.pageCount = item.imageCount || existing.pageCount;
            if (item.type === 'folder' && !existing.cover) {
              comicsNeedingCover.push(existing);
            }
            continue;
          }

          const comic = {
            id: `comic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: item.name,
            type: item.type,
            sourcePath: item.path,
            sourceType: item.type === 'folder' ? 'folder' : item.ext,
            pageCount: item.imageCount || 0,
            progress: 0,
            lastRead: null,
            dateAdded: Date.now(),
            unread: 1,
            bookmarked: false,
            cover: null,
          coverPath: null
          };

          this.localComics.push(comic);
          if (item.type === 'folder') {
            comicsNeedingCover.push(comic);
          }
          newCount++;
        }

        totalNew += newCount;
        this.loadCoversInBackground(comicsNeedingCover);
      }

      await this.saveData();
      this.invalidateCache();
      this.renderLibrary();
      this.renderLocal();
      this.renderLocalFolders();
      this.updateEmptyStates();

      let message = `Refresh complete: ${totalNew} new comics found`;
      if (removedFolders.length > 0) {
        message += `, ${removedFolders.length} folder(s) removed`;
      }
      this.showToast(message, 'success');
    } catch (err) {
      logger.error('refreshAllFolders failed', err);
      this.showToast('Refresh failed: ' + err.message, 'error');
    }
  }

  async scanFolderAtPath(folderPath, silent = false) {
    try {
      const results = await window.electronAPI.scanFolder(folderPath);
      let newCount = 0;

      const newComics = [];
      const comicsNeedingCover = [];

      for (const item of results) {
        const existingIndex = this.localComics.findIndex(c => c.sourcePath === item.path);
        if (existingIndex >= 0) {
          const existing = this.localComics[existingIndex];
          existing.pageCount = item.imageCount || existing.pageCount;
          if (item.type === 'folder' && !existing.cover) {
            comicsNeedingCover.push(existing);
          }
          continue;
        }

        const comic = {
          id: `comic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: item.name,
          type: item.type,
          sourcePath: item.path,
          sourceType: item.type === 'folder' ? 'folder' : item.ext,
          pageCount: item.imageCount || 0,
          progress: 0,
          lastRead: null,
          dateAdded: Date.now(),
          unread: 1,
          bookmarked: false,
          cover: null,
          coverPath: null
        };

        this.localComics.push(comic);
        newComics.push(comic);
        if (item.type === 'folder') {
          comicsNeedingCover.push(comic);
        }
        newCount++;
      }

      await this.saveData();
      this.invalidateCache();
      this.renderLibrary();
      this.renderLocal();
      this.updateEmptyStates();

      this.loadCoversInBackground(comicsNeedingCover);

      if (!silent) {
        this.showToast(`Found ${results.length} comics (${newCount} new)`, 'success');
      }
    } catch (err) {
      logger.error('scanFolderAtPath failed', err, { folderPath });
      if (!silent) {
        this.showToast('Scan failed: ' + err.message, 'error');
      }
    }
  }

  async loadCoversInBackground(comics) {
    const needsCover = comics.filter(c => c.sourcePath);
    if (needsCover.length === 0) return;
    const folderPaths = needsCover.map(c => c.sourcePath);
    const results = await window.electronAPI.batchGetCoverPaths(folderPaths);
    let changed = false;
    for (const comic of needsCover) {
      const coverPath = results[comic.sourcePath];
      if (coverPath) {
        if (comic.coverPath === coverPath) continue;
        comic.coverPath = coverPath;
        changed = true;
        const card = document.querySelector(`.comic-card[data-id="${comic.id}"]`);
        if (card) {
          const coverDiv = card.querySelector('.comic-cover');
          if (coverDiv) {
            const typeLabel = comic.type === 'folder' ? '📁' :
              comic.sourceType === '.cbz' ? '📦' :
              comic.sourceType === '.cbr' ? '📦' :
              comic.sourceType === '.pdf' ? '📕' :
              comic.sourceType === '.zip' ? '📦' : '📄';
            coverDiv.dataset.type = typeLabel;
            coverDiv.innerHTML = `<img src="cover://${encodeURIComponent(coverPath)}" alt="${comic.name}" loading="lazy" onerror="this.outerHTML=this.parentNode.dataset.type">`;
          }
        }
      }
    }
    if (changed) await this.saveData();
  }



  renderLibrary() {
    const grid = document.getElementById('comic-grid');
    const comics = this.getFilteredComics();

    if (comics.length === 0) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = comics.map(comic => this.createComicCard(comic)).join('');

    this.loadCoversLazy(comics, this.isReturningFromReader);
    this.isReturningFromReader = false;
  }

  async loadCoversLazy(comics, skipLoading = false) {
    if (skipLoading || this.coverLoadLocked) return;
    this.coverLoadLocked = true;

    try {
      const folderComics = comics.filter(c => c.type === 'folder' && c.sourcePath);
      if (folderComics.length === 0) return;

      const paths = folderComics.map(c => c.sourcePath);
      const results = await window.electronAPI.batchGetCoverPaths(paths);
      for (const comic of folderComics) {
        const coverPath = results[comic.sourcePath];
        if (coverPath) {
          if (comic.coverPath === coverPath) continue;
          comic.coverPath = coverPath;
          const card = document.querySelector(`.comic-card[data-id="${comic.id}"]`);
          if (card) {
            const coverDiv = card.querySelector('.comic-cover');
            if (coverDiv) {
              const typeLabel = comic.type === 'folder' ? '📁' :
                comic.sourceType === '.cbz' ? '📦' :
                comic.sourceType === '.cbr' ? '📦' :
                comic.sourceType === '.pdf' ? '📕' :
                comic.sourceType === '.zip' ? '📦' : '📄';
              coverDiv.dataset.type = typeLabel;
              coverDiv.innerHTML = `<img src="cover://${encodeURIComponent(coverPath)}" alt="${comic.name}" loading="lazy" onerror="this.outerHTML=this.parentNode.dataset.type">`;
            }
          }
        }
      }
      await this.saveData();
    } catch (err) {
      logger.warn('Failed to load covers', { error: err.message });
    } finally {
      this.coverLoadLocked = false;
    }
  }

  createComicCard(comic) {
    const progressPercent = comic.pageCount > 0
      ? Math.round((comic.progress / comic.pageCount) * 100)
      : 0;

    const typeLabel = comic.type === 'folder' ? '📁' :
      comic.sourceType === '.cbz' ? '📦' :
      comic.sourceType === '.cbr' ? '📦' :
      comic.sourceType === '.pdf' ? '📕' :
      comic.sourceType === '.zip' ? '📦' : '📄';

    const coverSrc = comic.coverPath
      ? `cover://${encodeURIComponent(comic.coverPath)}`
      : comic.cover || null;

    return `
      <div class="comic-card" data-id="${comic.id}">
        <div class="comic-cover" data-type="${typeLabel}">
          ${coverSrc ? `<img src="${coverSrc}" alt="${comic.name}" loading="lazy" onerror="this.outerHTML=this.parentNode.dataset.type">` : typeLabel}
          ${this.settings.showBadges && comic.unread > 0 ? `<span class="comic-badge">${comic.unread}</span>` : ''}
          <span class="comic-type-badge">${comic.sourceType || comic.type}</span>
        </div>
        <div class="comic-info">
          <div class="comic-title">${comic.name}</div>
          <div class="comic-meta-info">
            <span>${comic.pageCount} pages</span>
            ${comic.lastRead ? `<span>${new Date(comic.lastRead).toLocaleDateString()}</span>` : ''}
          </div>
          ${progressPercent > 0 ? `
            <div class="progress-bar-small">
              <div class="progress-fill" style="width: ${progressPercent}%"></div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderLocal() {
    const grid = document.getElementById('local-grid');
    const folderList = document.getElementById('folder-list');

    const folders = this.localFolders.map(path => {
      const name = path.split(/[\\/]/).pop();
      const count = this.localComics.filter(c => c.sourcePath.startsWith(path)).length;
      return { path, name, count };
    });

    if (folders.length > 0) {
      folderList.innerHTML = folders.map(f => `
        <div class="folder-item" data-path="${f.path}">
          <div class="folder-info">
            <span class="folder-icon">📁</span>
            <div>
              <div class="folder-name">${f.name}</div>
              <div class="folder-path">${f.path}</div>
            </div>
          </div>
          <span class="folder-count">${f.count} comics</span>
          <button class="folder-refresh" data-path="${f.path}" title="Refresh">🔄</button>
          <button class="folder-remove" data-path="${f.path}" title="Remove">✕</button>
        </div>
      `).join('');

      folderList.querySelectorAll('.folder-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const path = btn.dataset.path;
          const idx = this.localFolders.indexOf(path);
          if (idx >= 0) {
            this.localFolders.splice(idx, 1);
            this.localComics = this.localComics.filter(c => c.type !== 'folder' || !c.sourcePath.startsWith(path));
            await this.saveData();
            this.renderLocal();
            this.showToast('Folder removed', 'success');
          }
        });
      });

      folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('folder-refresh')) return;
          const path = item.dataset.path;
          let comics = this.localComics.filter(c => c.sourcePath.startsWith(path));
          if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            comics = comics.filter(c => c.name.toLowerCase().includes(q));
          }
          this.sortComics(comics);
          grid.innerHTML = comics.map(c => this.createComicCard(c)).join('');
          grid.querySelectorAll('.comic-card').forEach(card => {
            const comic = this.localComics.find(c => c.id === card.dataset.id);
            if (comic) {
              card.addEventListener('click', () => this.openReader(comic.id, comic.progress + 1 || 1));
            }
          });
        });
      });

      folderList.querySelectorAll('.folder-refresh').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.refreshFolder(btn.dataset.path);
        });
      });
    } else {
      folderList.innerHTML = '';
    }

    let folderComics = this.localComics.filter(c => c.type === 'folder');
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      folderComics = folderComics.filter(c => c.name.toLowerCase().includes(q));
    }
    this.sortComics(folderComics);

    if (folderComics.length === 0 && this.localFolders.length === 0) {
      grid.innerHTML = '';
    } else if (folderComics.length > 0) {
      grid.innerHTML = folderComics.map(c => this.createComicCard(c)).join('');
      grid.querySelectorAll('.comic-card').forEach(card => {
        card.addEventListener('click', () => this.openComicDetail(card.dataset.id));
      });
    }
  }

  renderExtensions() {
    const list = document.getElementById('extension-list');

    list.innerHTML = this.extensions.map(ext => `
      <div class="extension-item" data-id="${ext.id}">
        <div class="extension-info">
          <div class="extension-icon">${ext.icon}</div>
          <div>
            <div class="extension-name">${ext.name}</div>
            <div class="extension-url">${ext.url}</div>
          </div>
        </div>
        <span class="extension-lang">${ext.lang.toUpperCase()}</span>
        <div class="extension-actions">
          <button class="ext-btn browse-ext" data-source="${ext.scraperId || ext.id}">Browse</button>
          <button class="ext-btn delete" data-id="${ext.id}">Remove</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.browse-ext').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openExtensionBrowser(btn.dataset.source);
      });
    });

    list.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeExtension(btn.dataset.id);
      });
    });
  }

  renderHistory() {
    const list = document.getElementById('history-list');

    if (this.history.length === 0) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = this.history.map(item => `
      <div class="list-item" data-id="${item.comicId}">
        <div class="list-item-cover">${item.type === 'folder' ? '📁' : '📄'}</div>
        <div class="list-item-info">
          <div class="list-item-title">${item.name}</div>
          <div class="list-item-detail">Page ${item.page} / ${item.totalPages}</div>
        </div>
        <div class="list-item-time">${item.time}</div>
      </div>
    `).join('');

    list.querySelectorAll('.list-item').forEach(item => {
      const comic = this.localComics.find(c => c.id === item.dataset.id) || this.library.find(c => c.id === item.dataset.id);
      if (comic) {
        item.addEventListener('click', () => this.openReader(comic.id, comic.progress + 1 || 1));
      }
    });
  }

  renderLocalFolders() {
    const container = document.getElementById('local-folders');
    container.innerHTML = this.localFolders.map((path, i) => `
      <div class="local-folder-item">
        <span class="local-folder-path">${path}</span>
        <button class="local-folder-remove" data-index="${i}">Remove</button>
      </div>
    `).join('');

    container.querySelectorAll('.local-folder-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.dataset.index);
        this.localFolders.splice(index, 1);
        await this.saveData();
        this.renderLocalFolders();
        this.showToast('Folder removed', 'success');
      });
    });
  }

  async openComicDetail(comicId) {
    const comic = this.localComics.find(c => c.id === comicId) || this.library.find(c => c.id === comicId);
    if (!comic) return;

    this.selectedComic = comic;
    const modal = document.getElementById('comic-detail-modal');

    const coverSrc = comic.coverPath
      ? `cover://${encodeURIComponent(comic.coverPath)}`
      : comic.cover;

    document.getElementById('detail-cover').innerHTML = coverSrc
      ? `<img src="${coverSrc}" alt="${comic.name}">`
      : (comic.type === 'folder' ? '📁' : '📄');

    document.getElementById('detail-title').textContent = comic.name;
    document.getElementById('detail-meta').innerHTML = `
      <span>📂 ${comic.sourceType || comic.type}</span>
      <span>📄 ${comic.pageCount} pages</span>
      ${comic.lastRead ? `<span>📅 Last read: ${new Date(comic.lastRead).toLocaleDateString()}</span>` : ''}
    `;

    const chaptersList = document.getElementById('chapter-list');
    if (comic.type === 'folder') {
      chaptersList.innerHTML = `
        <div class="chapter-item" data-action="read-all">
          <span class="chapter-name">📖 Read All Pages</span>
          <span class="chapter-date">${comic.pageCount} pages</span>
        </div>
      `;
      chaptersList.querySelector('.chapter-item').addEventListener('click', () => {
        this.openReader(comic.id, 1);
      });
    } else {
      chaptersList.innerHTML = `
        <div class="chapter-item" data-action="read-file">
          <span class="chapter-name">📄 ${comic.name}</span>
          <span class="chapter-date">${comic.sourceType}</span>
        </div>
      `;
      chaptersList.querySelector('.chapter-item').addEventListener('click', () => {
        this.openReader(comic.id, 1);
      });
    }

    modal.classList.add('active');
  }

  closeComicDetail() {
    document.getElementById('comic-detail-modal').classList.remove('active');
    this.selectedComic = null;
  }

  async addToLibrary() {
    if (!this.selectedComic) return;

    const exists = this.library.find(c => c.sourcePath === this.selectedComic.sourcePath);
    if (!exists) {
      this.library.push({ ...this.selectedComic });
      await this.saveData();
      this.renderLibrary();
      this.showToast('Added to library', 'success');
    } else {
      this.showToast('Already in library', 'warning');
    }
    this.closeComicDetail();
  }

  async startReading() {
    if (!this.selectedComic) return;
    this.openReader(this.selectedComic.id, this.selectedComic.progress + 1 || 1);
  }

  async openReader(comicId, startPage = 1) {
    const comic = this.localComics.find(c => c.id === comicId) || this.library.find(c => c.id === comicId);
    if (!comic) return;

    document.getElementById('comic-detail-modal').classList.remove('active');

    comicReader.openLoading(comic);

    try {
      const result = await window.electronAPI.prepareComic({
        type: comic.type,
        path: comic.sourcePath
      });

      if (!result || !result.success) {
        comicReader.close();
        const errorMsg = result?.error || 'Unknown error';
        logger.error('Failed to prepare comic', null, { comicId, path: comic.sourcePath, error: errorMsg });
        this.showToast('Failed to read comic: ' + errorMsg, 'error');
        return;
      }

      comic.pageCount = result.count;
      comic.cacheId = result.cacheId;
      this.saveData();

      comicReader.openLoaded(comic, result.pages, startPage);
    } catch (err) {
      comicReader.close();
      logger.error('openReader failed', err, { comicId });
      this.showToast('Failed to open comic: ' + err.message, 'error');
    }
  }

  openSettings() {
    document.getElementById('settings-modal').classList.add('active');
    if (window.settingsManager?.loadSettings) {
      window.settingsManager.loadSettings();
    }
  }

  closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
  }

  openExtensionModal() {
    document.getElementById('extension-modal').classList.add('active');
  }

  closeExtensionModal() {
    document.getElementById('extension-modal').classList.remove('active');
    document.getElementById('extension-form').reset();
  }

  async addExtension() {
    const name = document.getElementById('ext-name').value;
    const url = document.getElementById('ext-url').value;
    const type = document.getElementById('ext-type').value;
    const lang = document.getElementById('ext-lang').value;

    const ext = {
      id: `ext-${Date.now()}`,
      name,
      url,
      type,
      lang,
      icon: '🌐',
      enabled: true
    };

    this.extensions.push(ext);
    await this.saveData();
    this.renderExtensions();
    this.updateEmptyStates();
    this.closeExtensionModal();
    this.showToast('Extension added', 'success');
  }

  async removeExtension(id) {
    this.extensions = this.extensions.filter(e => e.id !== id);
    await this.saveData();
    this.renderExtensions();
    this.updateEmptyStates();
    this.showToast('Extension removed', 'success');
  }

  applySettings() {
    const root = document.documentElement;
    root.style.setProperty('--accent', this.settings.accentColor);

    document.querySelectorAll('.comic-grid').forEach(grid => {
      grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${this.settings.gridSize}px, 1fr))`;
    });

    document.querySelectorAll('.comic-info').forEach(info => {
      info.style.display = this.settings.showTitles ? 'block' : 'none';
    });
  }

  updateEmptyStates() {
    const hasLibrary = this.localComics.length > 0 || this.library.length > 0;
    document.getElementById('empty-library').classList.toggle('show', !hasLibrary);
    document.getElementById('comic-grid').style.display = hasLibrary ? 'grid' : 'none';

    document.getElementById('empty-local').classList.toggle('show', this.localComics.length === 0 && this.localFolders.length === 0);

    document.getElementById('empty-history').classList.toggle('show', this.history.length === 0);
  }

  async addToHistory(comic, page, totalPages) {
    try {
      const entry = {
        comicId: comic.id,
        name: comic.name,
        type: comic.type,
        page,
        totalPages,
        time: new Date().toLocaleString()
      };

      const existingIndex = this.history.findIndex(h => h.comicId === comic.id);
      if (existingIndex >= 0) {
        this.history.splice(existingIndex, 1);
      }

      this.history.unshift(entry);
      if (this.history.length > 100) this.history.pop();
      await this.saveData();
      this.updateEmptyStates();
      this.renderHistory();
    } catch (err) {
      logger.warn('Failed to add history entry', { comicId: comic.id, error: err.message });
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  async openExtensionBrowser(source = null) {
    const overlay = document.getElementById('extension-browser-overlay');
    overlay.classList.add('active');
    this.currentExtensionSource = source || 'mangadex';
    this.extPage = 0;
    this.extHasMore = true;
    this.extCurrentResults = [];
    this.showExtensionHome();
  }

  async showExtensionHome() {
    const content = document.getElementById('extension-browser-content');
    
    const sourceOptions = this.extensions.filter(e => e.enabled).map(ext => 
      `<option value="${ext.scraperId || ext.id}">${ext.icon} ${ext.name}</option>`
    ).join('');

    content.innerHTML = `
      <div class="ext-home-view active">
        <div class="ext-home-header">
          <select id="ext-source-select" class="form-input" style="width: auto; padding: 8px 12px;">
            ${sourceOptions}
          </select>
        </div>
        <div class="ext-home-tabs">
          <button class="ext-tab-btn active" data-tab="popular">🔥 Popular</button>
          <button class="ext-tab-btn" data-tab="updated">📥 Updated</button>
          <button class="ext-tab-btn" data-tab="categories">📂 Categories</button>
        </div>
        <div class="ext-home-search">
          <input type="text" id="ext-home-search-input" class="search-input" placeholder="Search comics...">
          <button class="btn-primary" id="ext-home-search-btn">Search</button>
        </div>
        <div class="ext-results-grid" id="ext-results-grid"></div>
        <div class="ext-loading" id="ext-loading">
          <div class="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    `;

    this.extHomeTab = 'popular';
    this.extCategories = null;
    this.extPage = 0;
    this.extHasMore = true;
    this.extCurrentResults = [];

    document.getElementById('ext-source-select').addEventListener('change', (e) => {
      this.currentExtensionSource = e.target.value;
      this.extPage = 0;
      this.extCurrentResults = [];
      this.extHasMore = true;
      this.loadCurrentTab();
    });

    document.querySelectorAll('.ext-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ext-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.extHomeTab = btn.dataset.tab;
        this.extPage = 0;
        this.extCurrentResults = [];
        this.extHasMore = true;
        this.loadCurrentTab();
      });
    });

    document.getElementById('ext-home-search-btn').addEventListener('click', () => this.showExtensionSearch());
    document.getElementById('ext-home-search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.showExtensionSearch();
    });

    const extContent = document.getElementById('extension-browser-content');
    let scrollTimeout;
    extContent.addEventListener('scroll', () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => this.handleExtScroll(), 100);
    });

    await this.loadCurrentTab();
  }

  handleExtScroll() {
    if (!this.extHasMore || this.extLoadingMore) return;
    
    const content = document.getElementById('extension-browser-content');
    if (!content) return;
    
    const scrollTop = content.scrollTop;
    const scrollHeight = content.scrollHeight;
    const clientHeight = content.clientHeight;
    
    if (scrollTop + clientHeight >= scrollHeight - 150) {
      this.loadMoreResults();
    }
  }

  async loadMoreResults() {
    if (!this.extHasMore || this.extLoadingMore) return;
    if (this.extHomeTab === 'categories') return;
    
    this.extLoadingMore = true;
    this.extPage++;
    
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    if (extLoading) {
      extLoading.querySelector('p').textContent = 'Loading more...';
      extLoading.classList.add('active');
    }

    try {
      let result;
      const offset = this.extPage * 20;
      
      if (this.extHomeTab === 'popular') {
        result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'popular', { offset });
      } else if (this.extHomeTab === 'updated') {
        result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'updated', { offset });
      } else if (this.extHomeTab === 'search') {
        const query = document.getElementById('ext-search-input')?.value || '';
        result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'search', { query, offset });
      }
      
      if (extLoading) extLoading.classList.remove('active');
      if (extLoading) extLoading.querySelector('p').textContent = 'Loading...';
      
      if (!result.success || result.data.length === 0) {
        this.extHasMore = false;
        return;
      }
      
      this.extCurrentResults = [...this.extCurrentResults, ...result.data];
      this.appendExtensionResults(result.data);
      
      if (result.data.length < 20) {
        this.extHasMore = false;
      }
    } catch (err) {
      this.extHasMore = false;
      logger.error('loadMoreResults failed', err, { source: this.currentExtensionSource, tab: this.extHomeTab });
    }
    
    this.extLoadingMore = false;
  }

  async loadCurrentTab() {
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    const extResults = document.getElementById('ext-results-grid');

    if (extLoading) extLoading.classList.add('active');
    if (extResults) extResults.innerHTML = '';

    if (this.extHomeTab === 'popular') {
      await this.loadPopularComics();
    } else if (this.extHomeTab === 'updated') {
      await this.loadUpdatedComics();
    } else if (this.extHomeTab === 'categories') {
      if (!this.extCategories || this.currentExtensionSource !== 'mangadex') {
        this.extCategories = null;
        await this.loadCategories();
      } else {
        this.renderCategories(this.extCategories);
      }
    }
  }

  async loadPopularComics() {
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    const extResults = document.getElementById('ext-results-grid');
    const extEmpty = document.querySelector('#extension-browser-content .empty-state');

    if (extLoading) extLoading.classList.add('active');
    if (extResults) extResults.innerHTML = '';
    if (extEmpty) extEmpty.classList.remove('show');

    try {
      const result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'popular', { offset: 0 });
      
      if (extLoading) extLoading.classList.remove('active');
      
      if (!result.success) {
        this.showToast('Failed to load: ' + result.error, 'error');
        return;
      }

      this.extCurrentResults = result.data;
      this.renderExtensionResults(result.data);
      this.extHasMore = result.data.length >= 20;
    } catch (err) {
      if (extLoading) extLoading.classList.remove('active');
      logger.error('Failed to load popular comics', err, { source: this.currentExtensionSource });
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  async loadUpdatedComics() {
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    const extResults = document.getElementById('ext-results-grid');
    const extEmpty = document.querySelector('#extension-browser-content .empty-state');

    if (extLoading) extLoading.classList.add('active');
    if (extResults) extResults.innerHTML = '';
    if (extEmpty) extEmpty.classList.remove('show');

    try {
      const result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'updated', { offset: 0 });
      
      if (extLoading) extLoading.classList.remove('active');
      
      if (!result.success) {
        this.showToast('Failed to load: ' + result.error, 'error');
        return;
      }

      this.extCurrentResults = result.data;
      this.renderExtensionResults(result.data);
      this.extHasMore = result.data.length >= 20;
    } catch (err) {
      if (extLoading) extLoading.classList.remove('active');
      logger.error('Failed to load updated comics', err, { source: this.currentExtensionSource });
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  async loadCategories() {
    if (this.currentExtensionSource !== 'mangadex') {
      const grid = document.getElementById('ext-results-grid');
      if (grid) grid.innerHTML = '<div class="empty-state show"><div class="empty-icon">📂</div><h2>No Categories</h2><p>This source does not support category browsing</p></div>';
      return;
    }

    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    const extResults = document.getElementById('ext-results-grid');

    if (extLoading) extLoading.classList.add('active');
    if (extResults) extResults.innerHTML = '';

    try {
      const result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'categories', {});
      
      if (extLoading) extLoading.classList.remove('active');
      
      if (!result.success) {
        this.showToast('Failed to load categories: ' + result.error, 'error');
        return;
      }

      this.extCategories = result.data;
      this.renderCategories(result.data);
    } catch (err) {
      if (extLoading) extLoading.classList.remove('active');
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  renderCategories(categories) {
    const grid = document.getElementById('ext-results-grid');
    if (!grid) return;

    let html = '<div class="ext-categories-section">';
    
    if (categories.genres && categories.genres.length > 0) {
      html += '<h3>Genres</h3><div class="ext-category-chips">';
      html += categories.genres.slice(0, 20).map(genre => 
        `<span class="ext-category-chip" data-id="${genre.id}">${genre.name}</span>`
      ).join('');
      html += '</div>';
    }

    if (categories.themes && categories.themes.length > 0) {
      html += '<h3>Themes</h3><div class="ext-category-chips">';
      html += categories.themes.slice(0, 20).map(theme => 
        `<span class="ext-category-chip" data-id="${theme.id}">${theme.name}</span>`
      ).join('');
      html += '</div>';
    }

    html += '</div>';

    grid.innerHTML = html;

    grid.querySelectorAll('.ext-category-chip').forEach(chip => {
      chip.addEventListener('click', () => this.loadComicsByCategory(chip.dataset.id));
    });
  }

  async loadComicsByCategory(categoryId) {
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    const extResults = document.getElementById('ext-results-grid');
    const extEmpty = document.querySelector('#extension-browser-content .empty-state');

    if (extLoading) extLoading.classList.add('active');
    if (extResults) extResults.innerHTML = '';
    if (extEmpty) extEmpty.classList.remove('show');

    try {
      const result = await window.electronAPI.scrapeSource(this.currentExtensionSource, 'byCategory', { categoryId, limit: 20 });
      
      if (extLoading) extLoading.classList.remove('active');
      
      if (!result.success) {
        this.showToast('Failed to load: ' + result.error, 'error');
        return;
      }

      this.renderExtensionResults(result.data);
    } catch (err) {
      if (extLoading) extLoading.classList.remove('active');
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  showExtensionSearch() {
    const content = document.getElementById('extension-browser-content');
    content.innerHTML = `
      <div class="ext-search-view active">
        <div class="ext-search-header">
          <button class="toolbar-btn" id="ext-back-to-home">←</button>
          <h2>Search</h2>
        </div>
        <div class="ext-search-bar">
          <input type="text" id="ext-search-input" class="search-input" placeholder="Search for comics...">
          <button class="btn-primary" id="ext-search-btn">Search</button>
        </div>
        <div class="ext-results-grid" id="ext-results-grid"></div>
        <div class="ext-loading" id="ext-loading">
          <div class="spinner"></div>
          <p>Loading...</p>
        </div>
        <div class="empty-state show" id="ext-empty-search">
          <div class="empty-icon">🔍</div>
          <h2>Search for comics</h2>
          <p>Enter a search term to find comics</p>
        </div>
      </div>
    `;

    document.getElementById('ext-back-to-home').addEventListener('click', () => this.showExtensionHome());

    document.getElementById('ext-search-btn').addEventListener('click', () => this.searchExtension());
    document.getElementById('ext-search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchExtension();
    });
  }

  showExtensionSources() {
    document.getElementById('ext-source-selector').style.display = 'block';
    document.getElementById('ext-search-view').classList.remove('active');
    document.getElementById('ext-detail-view').classList.remove('active');

    const grid = document.getElementById('ext-source-grid');
    grid.innerHTML = this.extensions.filter(e => e.enabled).map(ext => `
      <div class="ext-source-card" data-source="${ext.scraperId || ext.id}">
        <div class="ext-source-icon">${ext.icon}</div>
        <div class="ext-source-name">${ext.name}</div>
      </div>
    `).join('');

    grid.querySelectorAll('.ext-source-card').forEach(card => {
      card.addEventListener('click', () => {
        this.selectExtensionSource(card.dataset.source);
      });
    });
  }

  async selectExtensionSource(sourceId) {
    const source = this.extensions.find(e => (e.scraperId || e.id) === sourceId);
    if (!source) return;

    this.currentExtensionSource = source.scraperId || source.id;

    const content = document.getElementById('extension-browser-content');
    content.innerHTML = `
      <div class="ext-search-view active">
        <div class="ext-search-header">
          <button class="toolbar-btn" id="ext-back-to-sources">←</button>
          <h2 id="ext-current-source">${source.name}</h2>
        </div>
        <div class="ext-search-bar">
          <input type="text" id="ext-search-input" class="search-input" placeholder="Search...">
          <button class="btn-primary" id="ext-search-btn">Search</button>
        </div>
        <div class="ext-results-grid" id="ext-results-grid"></div>
        <div class="ext-loading" id="ext-loading">
          <div class="spinner"></div>
          <p>Loading...</p>
        </div>
        <div class="empty-state show" id="ext-empty-search">
          <div class="empty-icon">🔍</div>
          <h2>Search for comics</h2>
          <p>Enter a search term to find comics</p>
        </div>
      </div>
    `;

    document.getElementById('ext-back-to-sources').addEventListener('click', () => this.showExtensionSources());
    document.getElementById('ext-search-btn').addEventListener('click', () => this.searchExtension());
    document.getElementById('ext-search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchExtension();
    });
  }

  async searchExtension() {
    const input = document.getElementById('ext-search-input');
    if (!input) return;
    
    const query = input.value.trim();
    if (!query || !this.currentExtensionSource) return;

    this.extHomeTab = 'search';
    this.extPage = 0;
    this.extCurrentResults = [];
    this.extHasMore = true;
    this.extSearchQuery = query;

    const extEmpty = document.querySelector('#extension-browser-content .empty-state');
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    const extResults = document.getElementById('ext-results-grid');

    if (extEmpty) extEmpty.classList.remove('show');
    if (extLoading) extLoading.classList.add('active');
    if (extResults) extResults.innerHTML = '';

    try {
      const source = this.currentExtensionSource;
      const result = await window.electronAPI.scrapeSource(source, 'search', { query, offset: 0 });

      if (extLoading) extLoading.classList.remove('active');

      if (!result.success) {
        logger.warn('Extension search failed', { source, query, error: result.error });
        this.showToast('Search failed: ' + result.error, 'error');
        return;
      }

      if (result.data.length === 0) {
        if (extEmpty) {
          extEmpty.querySelector('h2').textContent = 'No results';
          extEmpty.querySelector('p').textContent = 'Try a different search term';
          extEmpty.classList.add('show');
        }
        return;
      }

      this.extCurrentResults = result.data;
      this.renderExtensionResults(result.data);
      this.extHasMore = result.data.length >= 20;
    } catch (err) {
      if (extLoading) extLoading.classList.remove('active');
      logger.error('Extension search error', err, { source: this.currentExtensionSource, query });
      this.showToast('Search error: ' + err.message, 'error');
    }
  }

  appendExtensionResults(results) {
    const grid = document.getElementById('ext-results-grid');
    if (!grid) return;
    
    const newHtml = results.map(item => `
      <div class="ext-result-card" data-id="${item.id}" data-source="${item.source}">
        <div class="ext-result-cover">
          ${item.cover ? `<img src="${item.cover}" alt="${item.title}" loading="lazy">` : '📖'}
        </div>
        <div class="ext-result-title">${item.title}</div>
      </div>
    `).join('');
    
    grid.insertAdjacentHTML('beforeend', newHtml);
    
    grid.querySelectorAll('.ext-result-card').forEach(card => {
      card.addEventListener('click', () => {
        this.showExtensionDetails(card.dataset.id, card.dataset.source);
      });
    });
  }

  renderExtensionResults(results) {
    const grid = document.getElementById('ext-results-grid');
    if (!grid) return;
    
    grid.innerHTML = results.map(item => `
      <div class="ext-result-card" data-id="${item.id}" data-source="${item.source}">
        <div class="ext-result-cover">
          ${item.cover ? `<img src="${item.cover}" alt="${item.title}" loading="lazy">` : '📖'}
        </div>
        <div class="ext-result-title">${item.title}</div>
      </div>
    `).join('');

    grid.querySelectorAll('.ext-result-card').forEach(card => {
      card.addEventListener('click', () => {
        this.showExtensionDetails(card.dataset.id, card.dataset.source);
      });
    });
  }

  async showExtensionDetails(id, source) {
    const extLoading = document.querySelector('#extension-browser-content .ext-loading');
    if (extLoading) extLoading.classList.add('active');

    try {
      const result = await window.electronAPI.scrapeSource(source, 'details', { id });

      if (extLoading) extLoading.classList.remove('active');

      if (!result.success) {
        this.showToast('Failed to load details: ' + result.error, 'error');
        return;
      }

      this.renderExtensionDetails(result.data);
    } catch (err) {
      if (extLoading) extLoading.classList.remove('active');
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  renderExtensionDetails(details) {
    this.currentExtensionDetails = details;

    const content = document.getElementById('extension-browser-content');
    content.innerHTML = `
      <div class="ext-detail-view active">
        <div class="ext-detail-header">
          <button class="toolbar-btn" id="ext-back-to-search">←</button>
          <h2>Comic Details</h2>
        </div>
        <div class="ext-detail-content" id="ext-detail-content">
          <div class="ext-detail-header-row">
            <div class="ext-detail-cover">
              ${details.cover ? `<img src="${details.cover}" alt="${details.title}">` : '📖'}
            </div>
            <div class="ext-detail-info">
              <h2>${details.title}</h2>
              <div class="ext-detail-meta">
                ${details.authors ? `<span>👤 ${details.authors.join(', ')}</span>` : ''}
                <span>📄 ${details.chapters.length} chapters</span>
              </div>
              <div class="ext-detail-description">${details.description}</div>
              <button class="btn-primary" id="ext-start-reading-btn">Start Reading</button>
            </div>
          </div>
          <div class="ext-chapters-section">
            <div class="ext-chapters-header">
              <h3>Chapters</h3>
            </div>
            <div class="ext-chapter-list" id="ext-chapter-list">
              ${details.chapters.map(ch => `
                <div class="ext-chapter-item" data-chapter="${ch.id}">
                  <div class="ext-chapter-info">
                    <div class="ext-chapter-title">${ch.chapter}${ch.title ? ': ' + ch.title : ''}</div>
                    <div class="ext-chapter-meta">${ch.group} • ${ch.uploaded}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('ext-start-reading-btn').addEventListener('click', () => {
      if (details.chapters.length > 0) {
        this.openExtensionReader(details.id, details.chapters[0].id, details);
      }
    });

    content.querySelectorAll('.ext-chapter-item').forEach(item => {
      item.addEventListener('click', () => {
        this.openExtensionReader(details.id, item.dataset.chapter, details);
      });
    });

    content.querySelectorAll('.ext-detail-view .toolbar-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showExtensionSearch());
    });
  }

  closeExtensionBrowser() {
    document.getElementById('extension-browser-overlay').classList.remove('active');
    this.currentExtensionSource = null;
    this.currentExtensionDetails = null;
  }
}

const app = new ComicApp();
app.init();

window.addEventListener('error', (event) => {
  logger.error('Unhandled error', { message: event.message, filename: event.filename, lineno: event.lineno });
});

window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection', { reason: event.reason?.message || String(event.reason) });
});

logger.addListener(async (level, message, data) => {
  try {
    await window.electronAPI.writeLog(level.toUpperCase(), message, data);
  } catch (e) { /* dont crash */ }
});
