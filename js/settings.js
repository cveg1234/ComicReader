class SettingsManager {
  constructor() {
    this.bindEvents();
  }

  bindEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    const save = () => app.saveSettingsOnly();

    document.getElementById('theme-select').addEventListener('change', (e) => {
      app.settings.theme = e.target.value;
      this.applyTheme(e.target.value);
      save();
    });

    document.getElementById('accent-color').addEventListener('input', (e) => {
      app.settings.accentColor = e.target.value;
      document.documentElement.style.setProperty('--accent', e.target.value);
      save();
    });

    document.getElementById('grid-size').addEventListener('input', (e) => {
      const value = e.target.value;
      document.getElementById('grid-size-value').textContent = `${value}px`;
      app.settings.gridSize = value;

      document.querySelectorAll('.comic-grid').forEach(grid => {
        grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${value}px, 1fr))`;
      });
      save();
    });

    document.getElementById('show-titles').addEventListener('change', (e) => {
      app.settings.showTitles = e.target.checked;
      document.querySelectorAll('.comic-info').forEach(info => {
        info.style.display = e.target.checked ? 'block' : 'none';
      });
      save();
    });

    document.getElementById('show-badges').addEventListener('change', (e) => {
      app.settings.showBadges = e.target.checked;
      app.renderLibrary();
      save();
    });

    document.getElementById('reading-mode').addEventListener('change', (e) => {
      app.settings.readingMode = e.target.value;
      save();
    });

    document.getElementById('fit-screen').addEventListener('change', (e) => {
      app.settings.fitScreen = e.target.value;
      save();
    });

    document.getElementById('reader-bg').addEventListener('change', (e) => {
      app.settings.readerBg = e.target.value;
      save();
    });

    document.getElementById('page-preload').addEventListener('input', (e) => {
      const value = e.target.value;
      document.getElementById('preload-value').textContent = value;
      app.settings.pagePreload = parseInt(value);
      save();
    });

    document.getElementById('page-gap').addEventListener('input', (e) => {
      const value = e.target.value;
      document.getElementById('gap-value').textContent = `${value}px`;
      app.settings.pageGap = parseInt(value);
      save();
    });

    document.getElementById('auto-scan').addEventListener('change', (e) => {
      app.settings.autoScan = e.target.checked;
      save();
    });

    document.getElementById('watch-files').addEventListener('change', (e) => {
      app.settings.watchFiles = e.target.checked;
      save();
    });

    document.getElementById('add-local-folder-btn').addEventListener('click', () => {
      app.addFolder();
    });

    document.getElementById('save-settings-btn').addEventListener('click', async () => {
      const result = await app.saveSettingsOnly();
      app.showToast('Settings saved', 'success');
    });

    document.getElementById('view-log-btn').addEventListener('click', () => {
      const logData = logger.exportLogs();
      const logViewer = document.getElementById('log-viewer');
      if (logViewer.style.display === 'block') {
        logViewer.style.display = 'none';
        return;
      }
      logViewer.textContent = logData;
      logViewer.style.display = 'block';
    });
  }

  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.querySelectorAll('.settings-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    document.getElementById(`${tab}-settings`).classList.add('active');
  }

  applyTheme(theme) {
    const root = document.documentElement;

    const themes = {
      dark: {
        '--bg-primary': '#1a1a2e',
        '--bg-secondary': '#16213e',
        '--bg-tertiary': '#0f3460',
        '--bg-card': '#1e2a4a',
        '--text-primary': '#e4e4e4',
        '--text-secondary': '#a0a0a0',
        '--text-muted': '#6b7280',
        '--border': '#2a2a4a'
      },
      light: {
        '--bg-primary': '#f5f5f5',
        '--bg-secondary': '#ffffff',
        '--bg-tertiary': '#e0e0e0',
        '--bg-card': '#ffffff',
        '--text-primary': '#1a1a1a',
        '--text-secondary': '#4a4a4a',
        '--text-muted': '#8a8a8a',
        '--border': '#d0d0d0'
      },
      midnight: {
        '--bg-primary': '#0a192f',
        '--bg-secondary': '#112240',
        '--bg-tertiary': '#233554',
        '--bg-card': '#1d2d4a',
        '--text-primary': '#ccd6f6',
        '--text-secondary': '#8892b0',
        '--text-muted': '#495670',
        '--border': '#1e3a5f'
      },
      strawberry: {
        '--bg-primary': '#2d1b2e',
        '--bg-secondary': '#3d2439',
        '--bg-tertiary': '#5c3a52',
        '--bg-card': '#4a2d45',
        '--text-primary': '#f0e6f0',
        '--text-secondary': '#c9b0c9',
        '--text-muted': '#8a6a85',
        '--border': '#5a3a55'
      }
    };

    const colors = themes[theme] || themes.dark;
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  }

  loadSettings() {
    const settings = app.settings;

    document.getElementById('theme-select').value = settings.theme;
    document.getElementById('accent-color').value = settings.accentColor;
    document.getElementById('grid-size').value = settings.gridSize;
    document.getElementById('grid-size-value').textContent = `${settings.gridSize}px`;
    document.getElementById('show-titles').checked = settings.showTitles;
    document.getElementById('show-badges').checked = settings.showBadges;

    document.getElementById('reading-mode').value = settings.readingMode;
    document.getElementById('fit-screen').value = settings.fitScreen;
    document.getElementById('reader-bg').value = settings.readerBg;
    document.getElementById('page-preload').value = settings.pagePreload;
    document.getElementById('preload-value').textContent = settings.pagePreload;
    document.getElementById('page-gap').value = settings.pageGap;
    document.getElementById('gap-value').textContent = `${settings.pageGap}px`;

    document.getElementById('auto-scan').checked = settings.autoScan;
    document.getElementById('watch-files').checked = settings.watchFiles;

    this.applyTheme(settings.theme);
  }
}

const settingsManager = new SettingsManager();
setTimeout(() => settingsManager.loadSettings(), 100);
