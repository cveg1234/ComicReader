class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 500;
    this.listeners = [];
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  notify(level, message, data) {
    for (const cb of this.listeners) {
      try { cb(level, message, data); } catch (e) { /* ignore */ }
    }
  }

  formatTime() {
    return new Date().toLocaleString();
  }

  info(message, data) {
    const entry = { level: 'info', message, data, time: this.formatTime() };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    console.log(`[INFO] ${message}`, data || '');
    this.notify('info', message, data);
  }

  warn(message, data) {
    const entry = { level: 'warn', message, data, time: this.formatTime() };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    console.warn(`[WARN] ${message}`, data || '');
    this.notify('warn', message, data);
  }

  error(message, error, context) {
    const entry = {
      level: 'error',
      message,
      error: error ? { name: error.name, message: error.message, stack: error.stack } : null,
      context: context || null,
      time: this.formatTime()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    console.error(`[ERROR] ${message}`, error || '', context || '');
    this.notify('error', message, error);
  }

  getLogs(filter) {
    if (!filter) return [...this.logs];
    return this.logs.filter(l => l.level === filter);
  }

  clearLogs() {
    this.logs = [];
  }

  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }

  showErrorToast(message) {
    if (typeof app !== 'undefined' && app.showToast) {
      app.showToast(message, 'error');
    }
  }
}

const logger = new Logger();
