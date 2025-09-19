(function (global) {
  const KEY = 'inferno:pairs:v1';
  const EVENT = 'inferno:pairs:update';

  function getStorage() {
    try {
      return global.sessionStorage || null;
    } catch (err) {
      return null;
    }
  }

  const storage = getStorage();

  function read() {
    if (!storage) return {};
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function write(map) {
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(map || {}));
      if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        global.dispatchEvent(new CustomEvent(EVENT));
      }
    } catch (err) {
      // ignore storage errors in demo mode
    }
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  const store = {
    getPartners(id) {
      if (!id) return [];
      const data = read();
      const partners = data[id];
      return Array.isArray(partners) ? unique(partners) : [];
    },
    setPair(a, b) {
      if (!a || !b || a === b) return;
      const data = read();
      const partnersA = unique([...(Array.isArray(data[a]) ? data[a] : []), b]);
      const partnersB = unique([...(Array.isArray(data[b]) ? data[b] : []), a]);
      data[a] = partnersA;
      data[b] = partnersB;
      write(data);
    },
    removePair(a, b) {
      if (!a || !b) return;
      const data = read();
      if (Array.isArray(data[a])) {
        data[a] = data[a].filter((id) => id !== b);
        if (!data[a].length) delete data[a];
      }
      if (Array.isArray(data[b])) {
        data[b] = data[b].filter((id) => id !== a);
        if (!data[b].length) delete data[b];
      }
      write(data);
    },
    clearPairs() {
      write({});
    },
    onPairsChange(handler) {
      if (typeof handler !== 'function' || typeof global.addEventListener !== 'function') {
        return function noop() {};
      }
      const wrapped = () => handler();
      global.addEventListener(EVENT, wrapped);
      return () => {
        global.removeEventListener(EVENT, wrapped);
      };
    }
  };

  if (!global.InfernoPairsStore) {
    global.InfernoPairsStore = store;
  }
})(typeof window !== 'undefined' ? window : globalThis);
