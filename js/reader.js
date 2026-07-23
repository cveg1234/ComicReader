class ComicReader {
  constructor() {
    this.currentComic = null;
    this.pages = [];
    this.currentPage = 0;
    this.mode = 'vertical';
    this.showUI = true;
    this.autoScroll = false;
    this.autoScrollSpeed = 1;
    this.autoScrollInterval = null;
    this.looping = false;
    this.loadedPages = new Set();
    this.scrollRAF = null;
    this.saveTimer = null;
  }

  openLoading(comic) {
    this.currentComic = comic;
    this.pages = [];
    this.currentPage = 0;
    this.mode = app.settings.readingMode;

    const container = document.getElementById('reader-container');
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:1.2rem;">Loading...</div>';
    container.className = `reader-container mode-${this.mode}`;
    container.style.backgroundColor = this.getReaderBgColor();

    document.getElementById('reader-title').textContent = comic.name;
    document.getElementById('reader-chapter').textContent = 'Loading...';
    document.getElementById('page-indicator').textContent = '';
    document.getElementById('progress-bar').style.width = '0%';
    document.body.style.overflow = 'hidden';
  }

  openLoaded(comic, pages, startPage = 1) {
    this.currentComic = comic;
    this.pages = pages;
    this.currentPage = startPage - 1;
    this.mode = app.settings.readingMode;

    this.renderReader();
    this.bindReaderEvents();
    this.updateReaderUI();

    document.getElementById('reader-overlay').classList.add('active');
    document.getElementById('reader-overlay').classList.add('show-header');

    app.addToHistory(comic, this.currentPage + 1, this.pages.length);
  }

  renderReader() {
    const container = document.getElementById('reader-container');
    container.className = `reader-container mode-${this.mode}`;
    container.style.backgroundColor = this.getReaderBgColor();

    if (this.mode === 'vertical') {
      this.renderVerticalMode(container);
    } else if (this.mode === 'horizontal') {
      this.renderHorizontalMode(container);
    } else if (this.mode === 'single') {
      this.renderSingleMode(container);
    } else if (this.mode === 'double') {
      this.renderDoubleMode(container);
    }

    this.buildChapterSelect();
    this.updateChapterSelect();
  }

  renderVerticalMode(container) {
    container.innerHTML = '';
    
    const totalPages = this.pages.length;
    this.loadedPages = new Set();
    this.pendingPages = new Set();
    
    const renderPage = (index) => {
      if (index < 0 || index >= totalPages) return;
      const page = this.pages[index];
      const img = document.createElement('img');
      img.className = 'reader-page';
      img.dataset.page = index + 1;
      img.src = page.url;
      img.alt = `Page ${index + 1}`;
      img.loading = 'eager';
      img.decoding = 'async';
      container.appendChild(img);
      this.loadedPages.add(index);
    };
    
    const buffer = 10;
    const endInitial = Math.min(totalPages, Math.max(20, this.currentPage + buffer));
    
    for (let i = 0; i < endInitial; i++) {
      renderPage(i);
    }
    
    for (let i = endInitial; i < totalPages; i++) {
      this.pendingPages.add(i);
    }
    
    container.addEventListener('scroll', () => this.handleVerticalScroll(container));
    
    this.scrollToCurrentPage();
  }
  
  handleVerticalScroll(container) {
    if (this.scrollRAF) return;
    
    this.scrollRAF = requestAnimationFrame(() => {
      this.scrollRAF = null;
      
      const scrollTop = container.scrollTop;
      const viewportHeight = container.clientHeight;
      const scrollHeight = container.scrollHeight;
      
      this.trackPageFromScroll(container);
      
      if (this.looping && this.pages.length > 1 && !this._scrollGuard) {
        if (scrollTop + viewportHeight >= scrollHeight - 5 && this.currentPage >= this.pages.length - 1) {
          container.scrollTop = 0;
          this.currentPage = 0;
          this.updatePageIndicator();
          this.updateProgressBar();
          this.updateReaderUI();
          return;
        }
        if (!this._isAutoScrolling && scrollTop <= 5 && this.currentPage <= 0) {
          container.scrollTop = scrollHeight;
          this.currentPage = this.pages.length - 1;
          this.updatePageIndicator();
          this.updateProgressBar();
          this.updateReaderUI();
          return;
        }
      }
      
      if (!this.pendingPages || this.pendingPages.size === 0) return;
      
      const childCount = container.children.length;
      const minLoaded = childCount > 0 ? parseInt(container.children[0].dataset.page) - 1 : 0;
      const maxLoaded = childCount > 0 ? parseInt(container.children[childCount - 1].dataset.page) - 1 : -1;
      
      const loadRange = 8;
      const startLoad = Math.max(0, minLoaded - loadRange);
      const endLoad = Math.min(this.pages.length - 1, maxLoaded + loadRange);
      
      const frag = document.createDocumentFragment();
      let fragCount = 0;
      
      for (let i = startLoad; i <= endLoad; i++) {
        if (this.pendingPages.has(i)) {
          const page = this.pages[i];
          const img = document.createElement('img');
          img.className = 'reader-page';
          img.dataset.page = i + 1;
          img.src = page.url;
          img.alt = `Page ${i + 1}`;
          img.loading = 'eager';
          img.decoding = 'async';
          frag.appendChild(img);
          this.pendingPages.delete(i);
          this.loadedPages.add(i);
          fragCount++;
        }
      }
      
      if (fragCount > 0) {
        const sorted = Array.from(frag.children).sort((a, b) => parseInt(a.dataset.page) - parseInt(b.dataset.page));
        for (const el of sorted) {
          const pageNum = parseInt(el.dataset.page);
          let inserted = false;
          for (let j = 0; j < container.children.length; j++) {
            if (parseInt(container.children[j].dataset.page) > pageNum) {
              container.insertBefore(el, container.children[j]);
              inserted = true;
              break;
            }
          }
          if (!inserted) container.appendChild(el);
        }
      }
    });
  }
  
  trackPageFromScroll(container) {
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const viewCenter = scrollTop + containerHeight / 2;
    
    const imgs = container.children;
    const len = imgs.length;
    if (len === 0) return;
    
    let bestPage = this.currentPage;
    let bestDistance = Infinity;
    
    for (let i = 0; i < len; i++) {
      const el = imgs[i];
      const elTop = el.offsetTop;
      const elCenter = elTop + el.offsetHeight / 2;
      const distance = Math.abs(elCenter - viewCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = parseInt(el.dataset.page) - 1;
      }
    }
    
    if (bestPage >= 0 && bestPage < this.pages.length && bestPage !== this.currentPage) {
      this.currentPage = bestPage;
      this.updatePageIndicator();
      this.updateProgressBar();
      this.updateChapterSelect();
      this.debouncedSaveProgress();
    }
  }
  
  debouncedSaveProgress() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveProgress();
    }, 1000);
  }
  
  cleanupDistantPages(container, currentIndex, keepRange) {
    // Disabled - causing loading issues
    // Can re-enable with better logic later if needed
  }
  
  preloadAdjacentPages(currentIndex) {
    const preloadIndices = [currentIndex - 2, currentIndex - 1, currentIndex + 1, currentIndex + 2, currentIndex + 3];
    
    preloadIndices.forEach(idx => {
      if (idx >= 0 && idx < this.pages.length && !this.loadedPages.has(idx)) {
        const page = this.pages[idx];
        if (page) {
          const preloadImg = new Image();
          preloadImg.src = page.url;
        }
      }
    });
  }

  renderHorizontalMode(container) {
    container.innerHTML = '';
    
    const totalPages = this.pages.length;
    this.loadedPages = new Set();
    this.pendingHorizontalPages = new Set();
    
    const buffer = 10;
    const endInitial = Math.min(totalPages, Math.max(20, this.currentPage + buffer));
    
    for (let i = 0; i < endInitial; i++) {
      const page = this.pages[i];
      const img = document.createElement('img');
      img.className = 'reader-page';
      img.dataset.page = i + 1;
      img.src = page.url;
      img.alt = `Page ${i + 1}`;
      img.loading = 'eager';
      img.decoding = 'async';
      container.appendChild(img);
      this.loadedPages.add(i);
    }
    
    for (let i = endInitial; i < totalPages; i++) {
      this.pendingHorizontalPages.add(i);
    }
    
    container.addEventListener('scroll', () => this.handleHorizontalScroll(container));
    
    this.scrollToCurrentPage();
  }
  
  handleHorizontalScroll(container) {
    if (this.scrollRAF) return;
    
    this.scrollRAF = requestAnimationFrame(() => {
      this.scrollRAF = null;
      
      const scrollLeft = container.scrollLeft;
      const viewportWidth = container.clientWidth;
      const scrollWidth = container.scrollWidth;
      
      this.trackPageFromScroll(container);
      
      if (this.looping && this.pages.length > 1 && !this._scrollGuard) {
        if (scrollLeft + viewportWidth >= scrollWidth - 5 && this.currentPage >= this.pages.length - 1) {
          container.scrollLeft = 0;
          this.currentPage = 0;
          this.updatePageIndicator();
          this.updateProgressBar();
          this.updateReaderUI();
          return;
        }
        if (!this._isAutoScrolling && scrollLeft <= 5 && this.currentPage <= 0) {
          container.scrollLeft = scrollWidth;
          this.currentPage = this.pages.length - 1;
          this.updatePageIndicator();
          this.updateProgressBar();
          this.updateReaderUI();
          return;
        }
      }
      
      if (!this.pendingHorizontalPages || this.pendingHorizontalPages.size === 0) return;
      
      const childCount = container.children.length;
      const minLoaded = childCount > 0 ? parseInt(container.children[0].dataset.page) - 1 : 0;
      const maxLoaded = childCount > 0 ? parseInt(container.children[childCount - 1].dataset.page) - 1 : -1;
      
      const loadRange = 8;
      const startLoad = Math.max(0, minLoaded - loadRange);
      const endLoad = Math.min(this.pages.length - 1, maxLoaded + loadRange);
      
      for (let i = startLoad; i <= endLoad; i++) {
        if (this.pendingHorizontalPages.has(i)) {
          const page = this.pages[i];
          const img = document.createElement('img');
          img.className = 'reader-page';
          img.dataset.page = i + 1;
          img.src = page.url;
          img.alt = `Page ${i + 1}`;
          img.loading = 'eager';
          img.decoding = 'async';
          container.appendChild(img);
          this.pendingHorizontalPages.delete(i);
          this.loadedPages.add(i);
        }
      }
    });
  }

  renderSingleMode(container) {
    this.renderCurrentPage(container);
    this.addNavigationZones(container);
  }

  renderDoubleMode(container) {
    this.renderDoublePages(container);
    this.addNavigationZones(container);
  }

  renderDoublePages(container) {
    const gap = app.settings.pageGap;
    const page1 = this.pages[this.currentPage];
    const page2 = this.pages[this.currentPage + 1];

    container.innerHTML = `
      <div class="double-page-container" style="gap: ${gap}px">
        ${page1 ? `<img class="reader-page" id="double-page-1" src="${page1.url}" alt="Page ${this.currentPage + 1}">` : ''}
        ${page2 ? `<img class="reader-page" id="double-page-2" src="${page2.url}" alt="Page ${this.currentPage + 2}">` : ''}
      </div>
    `;
  }

  renderCurrentPage(container) {
    const page = this.pages[this.currentPage];
    if (page) {
      container.innerHTML = `<img class="reader-page" src="${page.url}" alt="Page ${this.currentPage + 1}">`;
    }
  }

  addNavigationZones(container) {
    const existing = container.querySelector('.reader-nav-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'reader-nav-overlay';
    overlay.innerHTML = `
      <div class="nav-zone prev" id="nav-prev"><span>‹</span></div>
      <div class="nav-zone next" id="nav-next"><span>›</span></div>
    `;
    container.appendChild(overlay);

    document.getElementById('nav-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      this.prevPage();
    });
    document.getElementById('nav-next').addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextPage();
    });
  }

  bindReaderEvents() {
    const overlay = document.getElementById('reader-overlay');

    overlay.onclick = (e) => {
      if (e.target.id === 'reader-overlay') this.toggleUI();

      const btn = e.target.closest('[data-reader-action]');
      if (!btn) return;

      const action = btn.dataset.readerAction;
      switch (action) {
        case 'close': this.close(); break;
        case 'prev': this.prevPage(); break;
        case 'next': this.nextPage(); break;
        case 'settings': this.toggleReaderSettings(); break;
        case 'newwindow': this.openNewWindow(); break;
      }
    };

    const chapterSelect = document.getElementById('chapter-select');
    chapterSelect.onchange = () => {
      const val = parseInt(chapterSelect.value);
      if (!isNaN(val)) this.goToPage(val);
    };

    document.onkeydown = (e) => this.handleKeyboard(e);

    const container = document.getElementById('reader-container');
    container.onwheel = (e) => {
      if (this.mode === 'single' || this.mode === 'double') {
        e.preventDefault();
        if (e.deltaY > 0) this.nextPage();
        else this.prevPage();
      }
    };
  }

  handleKeyboard(e) {
    if (!document.getElementById('reader-overlay').classList.contains('active')) return;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        this.prevPage();
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        this.nextPage();
        break;
      case 'Escape':
        this.close();
        break;
      case 'f':
        this.toggleFullscreen();
        break;
      case 'h':
      case 'H':
        this.toggleUI();
        break;
      case ' ':
        e.preventDefault();
        this.toggleUI();
        break;
    }
  }

  nextPage() {
    const step = this.mode === 'double' ? 2 : 1;
    if (this.currentPage + step < this.pages.length) {
      this.currentPage += step;
    } else if (this.looping) {
      this.currentPage = 0;
    } else {
      this.currentPage = this.pages.length - 1;
      return;
    }
    this._scrollGuard = true;
    this.applyPageChange();
    requestAnimationFrame(() => { this._scrollGuard = false; });
  }

  prevPage() {
    const step = this.mode === 'double' ? 2 : 1;
    if (this.currentPage - step >= 0) {
      this.currentPage -= step;
    } else if (this.looping) {
      this.currentPage = this.pages.length - 1;
    } else {
      this.currentPage = 0;
      return;
    }
    this._scrollGuard = true;
    this.applyPageChange();
    requestAnimationFrame(() => { this._scrollGuard = false; });
  }

  applyPageChange() {
    if (this.mode === 'single') {
      this.renderCurrentPage(document.getElementById('reader-container'));
    } else if (this.mode === 'double') {
      this.renderDoublePages(document.getElementById('reader-container'));
    } else if (this.mode === 'vertical' || this.mode === 'horizontal') {
      this.scrollToCurrentPage();
    }

    this.updatePageIndicator();
    this.updateProgressBar();
    this.updateReaderUI();
    this.saveProgress();
    this.preloadAdjacentPages(this.currentPage);
  }

  scrollToCurrentPage() {
    const container = document.getElementById('reader-container');
    
    if (this.mode === 'vertical' || this.mode === 'horizontal') {
      this._scrollGuard = true;
      const targetImg = container.querySelector(`[data-page="${this.currentPage + 1}"]`);
      if (targetImg) {
        targetImg.scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        this.ensurePageLoaded(this.currentPage).then(() => {
          const retryImg = container.querySelector(`[data-page="${this.currentPage + 1}"]`);
          if (retryImg) {
            this._scrollGuard = true;
            retryImg.scrollIntoView({ behavior: 'instant', block: 'start' });
            requestAnimationFrame(() => { this._scrollGuard = false; });
          } else {
            this.ensurePageLoaded(this.currentPage).then(() => {
              const finalImg = container.querySelector(`[data-page="${this.currentPage + 1}"]`);
              if (finalImg) {
                this._scrollGuard = true;
                finalImg.scrollIntoView({ behavior: 'instant', block: 'start' });
                requestAnimationFrame(() => { this._scrollGuard = false; });
              }
            });
          }
        });
      }
      requestAnimationFrame(() => { this._scrollGuard = false; });
    }
  }
  
  async ensurePageLoaded(pageIndex) {
    if (!this.pendingPages && !this.pendingHorizontalPages) return;
    const pending = this.pendingPages || this.pendingHorizontalPages;
    
    if (pending.has(pageIndex)) {
      const page = this.pages[pageIndex];
      const container = document.getElementById('reader-container');
      const img = document.createElement('img');
      img.className = 'reader-page';
      img.dataset.page = pageIndex + 1;
      img.src = page.url;
      img.alt = `Page ${pageIndex + 1}`;
      img.loading = 'eager';
      img.decoding = 'async';
      
      let inserted = false;
      for (const loaded of this.loadedPages) {
        if (loaded > pageIndex) {
          const nextImg = container.querySelector(`[data-page="${loaded + 1}"]`);
          if (nextImg) {
            container.insertBefore(img, nextImg);
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) {
        container.appendChild(img);
      }
      
      pending.delete(pageIndex);
      this.loadedPages.add(pageIndex);
    }
  }

  updatePageIndicator() {
    document.getElementById('page-indicator').textContent = `Page ${this.currentPage + 1} / ${this.pages.length}`;
  }

  updateProgressBar() {
    const progress = ((this.currentPage + 1) / this.pages.length) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;
  }

  updateReaderUI() {
    document.getElementById('reader-title').textContent = this.currentComic.name;
    document.getElementById('reader-chapter').textContent = `Page ${this.currentPage + 1} of ${this.pages.length}`;

    this.updateChapterSelect();
    this.updatePageIndicator();
    this.updateProgressBar();
  }

  buildChapterSelect() {
    const select = document.getElementById('chapter-select');
    select.innerHTML = this.pages.map((page, i) => `
      <option value="${i + 1}">
        Page ${i + 1}
      </option>
    `).join('');
  }

  updateChapterSelect() {
    const select = document.getElementById('chapter-select');
    const target = String(this.currentPage + 1);
    if (select.value !== target) {
      select.value = target;
    }
  }

  goToPage(pageNum) {
    const index = pageNum - 1;
    if (index >= 0 && index < this.pages.length) {
      this.currentPage = index;
      this.applyPageChange();
    }
  }

  toggleReaderSettings() {
    let popup = document.querySelector('.reader-settings-popup');
    if (popup) {
      popup.remove();
      return;
    }

    popup = document.createElement('div');
    popup.className = 'reader-settings-popup active';
    popup.innerHTML = `
      <div class="reader-setting-item">
        <label>Reading Mode</label>
        <select id="reader-mode-select">
          <option value="vertical" ${this.mode === 'vertical' ? 'selected' : ''}>Vertical</option>
          <option value="horizontal" ${this.mode === 'horizontal' ? 'selected' : ''}>Horizontal</option>
          <option value="single" ${this.mode === 'single' ? 'selected' : ''}>Single Page</option>
          <option value="double" ${this.mode === 'double' ? 'selected' : ''}>Double Page</option>
        </select>
      </div>
      <div class="reader-setting-item">
        <label>Background</label>
        <select id="reader-bg-select">
          <option value="black" ${app.settings.readerBg === 'black' ? 'selected' : ''}>Black</option>
          <option value="gray" ${app.settings.readerBg === 'gray' ? 'selected' : ''}>Gray</option>
          <option value="white" ${app.settings.readerBg === 'white' ? 'selected' : ''}>White</option>
        </select>
      </div>
      <div class="reader-setting-item">
        <label>Fit</label>
        <select id="reader-fit-select">
          <option value="height" ${app.settings.fitScreen === 'height' ? 'selected' : ''}>Height</option>
          <option value="width" ${app.settings.fitScreen === 'width' ? 'selected' : ''}>Width</option>
          <option value="screen" ${app.settings.fitScreen === 'screen' ? 'selected' : ''}>Screen</option>
        </select>
      </div>
      <div class="reader-setting-item">
        <label>Loop</label>
        <input type="checkbox" id="reader-loop-check" ${this.looping ? 'checked' : ''}>
      </div>
      <div class="reader-setting-item">
        <label>Auto Scroll</label>
        <input type="checkbox" id="reader-autoscroll-check" ${this.autoScroll ? 'checked' : ''}>
      </div>
      <div class="reader-setting-item">
        <label>Scroll Speed</label>
        <input type="range" id="reader-speed-range" min="1" max="10" value="${this.autoScrollSpeed}" ${!this.autoScroll ? 'disabled' : ''}>
      </div>
    `;

    document.getElementById('reader-overlay').appendChild(popup);

    document.getElementById('reader-mode-select').onchange = (e) => {
      this.mode = e.target.value;
      app.settings.readingMode = this.mode;
      this.renderReader();
    };

    document.getElementById('reader-bg-select').onchange = (e) => {
      app.settings.readerBg = e.target.value;
      document.getElementById('reader-container').style.backgroundColor = this.getReaderBgColor();
    };

    document.getElementById('reader-fit-select').onchange = (e) => {
      app.settings.fitScreen = e.target.value;
    };

    document.getElementById('reader-loop-check').onchange = (e) => {
      this.looping = e.target.checked;
    };

    document.getElementById('reader-autoscroll-check').onchange = (e) => {
      this.autoScroll = e.target.checked;
      const speedRange = document.getElementById('reader-speed-range');
      if (speedRange) speedRange.disabled = !this.autoScroll;
      if (this.autoScroll) {
        this.startAutoScroll();
      } else {
        this.stopAutoScroll();
      }
    };

    document.getElementById('reader-speed-range').oninput = (e) => {
      this.autoScrollSpeed = parseInt(e.target.value);
      if (this.autoScroll) {
        this.stopAutoScroll();
        this.startAutoScroll();
      }
    };

    document.addEventListener('click', (e) => {
      if (!popup.contains(e.target) && e.target.id !== 'reader-settings-btn') {
        popup.remove();
      }
    }, { once: true });
  }

  openNewWindow() {
    const cacheId = this.pages[0]?.url?.split('/')[2]?.split('?')[0];
    if (!cacheId) {
      app.showToast('Cannot open in new window', 'error');
      return;
    }
    window.electronAPI.openReaderWindow({
      cacheId,
      name: this.currentComic?.name || 'Comic',
      count: this.pages.length,
      page: this.currentPage,
      mode: this.mode,
      comic: this.currentComic ? { id: this.currentComic.id, progress: this.currentPage + 1 } : undefined
    });
    app.showToast('Opened in new window', 'success');
  }

  startAutoScroll() {
    this.stopAutoScroll();
    const container = document.getElementById('reader-container');
    this._isAutoScrolling = true;
    this.autoScrollInterval = setInterval(() => {
      container.scrollTop += this.autoScrollSpeed;
    }, 16);
  }

  stopAutoScroll() {
    if (this.autoScrollInterval) {
      clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = null;
    }
    this._isAutoScrolling = false;
  }

  getReaderBgColor() {
    switch (app.settings.readerBg) {
      case 'black': return '#000';
      case 'gray': return '#1a1a1a';
      case 'white': return '#fff';
      default: return '#000';
    }
  }

  toggleUI() {
    this.showUI = !this.showUI;
    document.getElementById('reader-overlay').classList.toggle('show-header', this.showUI);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  close() {
    this.stopAutoScroll();
    this.autoScroll = false;
    this.looping = false;
    
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    
    if (this.scrollRAF) {
      cancelAnimationFrame(this.scrollRAF);
      this.scrollRAF = null;
    }
    
    const container = document.getElementById('reader-container');
    const clone = container.cloneNode(false);
    container.parentNode.replaceChild(clone, container);

    document.getElementById('reader-overlay').classList.remove('active');
    document.getElementById('reader-overlay').classList.remove('show-header');
    document.body.style.overflow = '';

    const popup = document.querySelector('.reader-settings-popup');
    if (popup) popup.remove();
    
    document.onkeydown = null;

    const progress = this.currentPage + 1;
    const comic = this.currentComic;
    
    app.isReturningFromReader = true;
    setTimeout(() => {
      app.renderLibrary();
      
      const libComic = app.localComics.find(c => c.id === comic.id) || app.library.find(c => c.id === comic.id);
      if (libComic) {
        libComic.progress = progress;
        libComic.unread = Math.max(0, (libComic.pageCount || 0) - progress);
        libComic.lastRead = Date.now();
        app.saveData();
      }
      
      app.isReturningFromReader = false;
    }, 10);

    this.loadedPages.clear();
    this.pendingPages = null;
    this.pendingHorizontalPages = null;
  }

  async saveProgress() {
    try {
      const comic = app.localComics.find(c => c.id === this.currentComic.id) || app.library.find(c => c.id === this.currentComic.id);
      if (comic) {
        comic.progress = this.currentPage + 1;
        comic.unread = Math.max(0, comic.pageCount - comic.progress);
        comic.lastRead = Date.now();
        await app.saveData();
      }
    } catch (err) {
      logger.warn('Failed to save reading progress', { comicId: this.currentComic?.id, error: err.message });
    }
  }
}

const comicReader = new ComicReader();
