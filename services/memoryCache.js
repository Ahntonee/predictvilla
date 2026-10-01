const entries = new Map();

// Returns a live cache entry or removes it when its expiry has passed.
function get(key) {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.value;
}

// Stores a value in this Node worker for the requested lifetime.
function set(key, value, ttlMs = 60000) {
  entries.set(key, { value, expiresAt: Date.now() + Math.max(1000, ttlMs) });
  return value;
}

// Removes one entry or every entry whose key begins with a namespace prefix.
function del(keyOrPrefix, prefix = false) {
  if (!prefix) return entries.delete(keyOrPrefix);
  let removed = 0;
  for (const key of entries.keys()) {
    if (key.startsWith(keyOrPrefix)) {
      entries.delete(key);
      removed++;
    }
  }
  return removed;
}

// Deduplicates concurrent cache misses so one worker performs only one database/API request.
async function remember(key, ttlMs, loader) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const pendingKey = `pending:${key}`;
  const pending = get(pendingKey);
  if (pending) return pending;
  const task = Promise.resolve().then(loader);
  set(pendingKey, task, Math.min(ttlMs, 30000));
  try {
    const value = await task;
    set(key, value, ttlMs);
    return value;
  } finally {
    entries.delete(pendingKey);
  }
}

// Produces stable keys for request parameter objects regardless of property order.
function stableKey(namespace, params = {}) {
  const normalized = Object.keys(params).sort().map(key => [key, params[key]]);
  return `${namespace}:${JSON.stringify(normalized)}`;
}

module.exports = { get, set, del, remember, stableKey };
