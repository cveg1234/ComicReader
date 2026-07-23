(function() {
  const params = new URLSearchParams(location.search);
  const cacheId = params.get('cacheId');
  const comicName = params.get('name') || 'Comic';
  const totalPages = parseInt(params.get('count')) || 1;
  const startPage = parseInt(params.get('page')) || 0;
  const mode = params.get('mode') || 'single';
  const comicData = params.get('comic');

  let comicInfo = { name: comicName, id: 'reader-window-comic' };
  if (comicData) {
    try {
      comicInfo = JSON.parse(decodeURIComponent(comicData));
      if (!comicInfo.name) comicInfo.name = comicName;
    } catch {}
  }

  app.settings.readingMode = mode;

  const pages = [];
  for (let i = 0; i < totalPages; i++) {
    pages.push({ url: `comic://${cacheId}/${i}`, index: i });
  }
  comicInfo.pageCount = totalPages;

  const originalClose = comicReader.close.bind(comicReader);
  comicReader.close = function() {
    const progress = this.currentPage + 1;
    window.electronAPI.loadData('history').then(existing => {
      let history = Array.isArray(existing) ? existing : [];
      const idx = history.findIndex(h => h.comicId === comicInfo.id);
      if (idx >= 0) history.splice(idx, 1);
      history.unshift({
        comicId: comicInfo.id,
        name: comicInfo.name,
        type: comicInfo.type || 'folder',
        page: progress,
        totalPages: totalPages,
        time: new Date().toLocaleString()
      });
      if (history.length > 100) history.pop();
      window.electronAPI.saveData('history', history);
    }).catch(() => {});
    originalClose();
    window.close();
  };

  comicReader.openNewWindow = function() {
    app.showToast('Already in a new window', 'info');
  };

  const origHandleKeyboard = comicReader.handleKeyboard.bind(comicReader);
  comicReader.handleKeyboard = function(e) {
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    origHandleKeyboard(e);
  };

  comicReader.openLoaded(comicInfo, pages, startPage + 1);

  document.getElementById('reader-overlay').classList.add('active', 'show-header');
})();
