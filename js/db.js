// Tiny IndexedDB wrapper. Two stores:
//   days — one record per date, keyPath "date" (YYYY-MM-DD)
//   kv   — settings and the insulin chart, keyPath "key"
const DB_NAME = "healthplus";
const DB_VERSION = 1;
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", { keyPath: "date" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = "readonly") {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getDay(date) {
  return wrap((await store("days")).get(date));
}

export async function putDay(day) {
  return wrap((await store("days", "readwrite")).put(day));
}

export async function allDays() {
  const days = await wrap((await store("days")).getAll());
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export async function daysBetween(from, to) {
  return wrap((await store("days")).getAll(IDBKeyRange.bound(from, to)));
}

// Walks backwards from `date` (exclusive) and returns the first record that
// passes `test`, or undefined.
export async function findBefore(date, test) {
  const s = await store("days");
  return new Promise((resolve, reject) => {
    const req = s.openCursor(IDBKeyRange.upperBound(date, true), "prev");
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(undefined);
      if (test(c.value)) return resolve(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getKV(key, fallback) {
  const rec = await wrap((await store("kv")).get(key));
  return rec ? rec.value : fallback;
}

export async function setKV(key, value) {
  return wrap((await store("kv", "readwrite")).put({ key, value }));
}

export async function replaceAll(days, kv) {
  const db = await open();
  const tx = db.transaction(["days", "kv"], "readwrite");
  const ds = tx.objectStore("days");
  ds.clear();
  days.forEach((d) => ds.put(d));
  if (kv) {
    const ks = tx.objectStore("kv");
    Object.entries(kv).forEach(([key, value]) => ks.put({ key, value }));
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearDays() {
  return wrap((await store("days", "readwrite")).clear());
}
