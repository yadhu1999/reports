import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
export class RequestBudget {
  constructor({ file, limit = 25, now = Date.now } = {}) {
    this.file = file;
    if (!Number.isFinite(limit) || limit < 1)
      throw Error('DataTap request budget must be a positive number.');
    this.limit = limit;
    this.now = now;
    this.states = {};
    this.queues = new Map();
    if (file && existsSync(file)) {
      try {
        this.states = JSON.parse(readFileSync(file));
      } catch {
        throw Error('Unable to read DataTap request budget.');
      }
    }
  }
  save() {
    if (this.file) {
      writeFileSync(this.file + '.tmp', JSON.stringify(this.states), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
    }
  }
  state(key) {
    const s = (this.states[key] ||= { calls: [], cooldown: 0 });
    s.calls = s.calls.filter((t) => t > this.now() - 3600000);
    return s;
  }
  check(key, reserve = 1) {
    const s = this.state(key);
    if (s.cooldown > this.now() || (this.limit > 0 && s.calls.length + reserve > this.limit)) {
      const retry = Math.max(s.cooldown, s.calls.length ? s.calls[0] + 3600000 : 0);
      const e = Error(
        'DataTap refresh deferred by the tenant request budget. Try again after ' +
          new Date(retry).toLocaleTimeString() +
          '.',
      );
      e.statusCode = 'RATE_LIMITED';
      e.retryNotBefore = retry;
      throw e;
    }
  }
  async request(key, url, options) {
    this.check(key);
    const s = this.state(key);
    s.calls.push(this.now());
    this.save();
    const r = await fetch(url, options);
    if (r.status === 429) {
      const h = r.headers.get('retry-after');
      const delta = h && /^\d+$/.test(h) ? Number(h) * 1000 : Date.parse(h || '') - this.now();
      s.cooldown = this.now() + (Number.isFinite(delta) && delta > 0 ? delta : 3600000);
      this.save();
    }
    return r;
  }
  async run(key, fn, reserve = 2) {
    this.check(key, reserve);
    const queue = this.queues.get(key) || { tail: Promise.resolve(), count: 0 };
    if (queue.count >= 20) throw Error('Too many queued DataTap reports. Try again shortly.');
    this.queues.set(key, queue);
    queue.count++;
    const previous = queue.tail;
    let release;
    queue.tail = new Promise((r) => (release = r));
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Error(
          'DataTap refresh deferred while another report is running. Try again shortly.',
        );
        error.statusCode = 'RATE_LIMITED';
        error.retryNotBefore = this.now() + 15000;
        reject(error);
      }, 120000);
    });
    try {
      await Promise.race([previous, expired]);
    } catch (error) {
      previous.then(() => {
        release();
        queue.count--;
        if (!queue.count) this.queues.delete(key);
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
    try {
      this.check(key, reserve);
      return await fn();
    } finally {
      release();
      queue.count--;
      if (!queue.count) this.queues.delete(key);
    }
  }
}
