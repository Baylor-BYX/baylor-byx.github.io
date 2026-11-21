// In-memory stand-in for the Firebase compat SDK (auth + firestore), enough for the portal.
module.exports = function makeFake(opts) {
  const store = opts.store || {};           // path -> data
  const listeners = [];                     // {kind, path, cb}
  const log = [];
  let authCb = null, currentUser = opts.user || null;
  const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const denied = opts.denied || (() => false); // (op, path) -> true to simulate rules
  function err(code) { const e = new Error(code); e.code = code; return e; }
  function docSnap(path) { const d = store[path]; return { id: path.split("/").pop(), exists: d !== undefined, data: () => clone(d) }; }
  function colSnap(name) {
    const docs = Object.keys(store).filter(p => p.split("/").length === 2 && p.split("/")[0] === name).map(docSnap);
    return { docs, empty: !docs.length, metadata: { fromCache: false } };
  }
  function notify() {
    listeners.forEach(l => {
      if (l.kind === "col") l.cb(colSnap(l.path)); else if (l.kind === "colq") l.cb(); else l.cb(docSnap(l.path));
    });
  }
  function docRef(path) {
    return {
      get: () => denied("get", path) ? Promise.reject(err("permission-denied")) : Promise.resolve(docSnap(path)),
      set: (d) => { if (denied("set", path, d)) return Promise.reject(err("permission-denied")); store[path] = clone(d); log.push(["set", path, clone(d)]); setTimeout(notify); return Promise.resolve(); },
      update: (d) => { if (denied("update", path, d)) return Promise.reject(err("permission-denied")); if (!store[path]) return Promise.reject(err("not-found")); store[path] = Object.assign({}, store[path], clone(d)); log.push(["update", path, clone(d)]); setTimeout(notify); return Promise.resolve(); },
      delete: () => { if (denied("delete", path)) return Promise.reject(err("permission-denied")); delete store[path]; log.push(["delete", path]); setTimeout(notify); return Promise.resolve(); },
      onSnapshot: (cb, fail) => { if (denied("read", path)) { setTimeout(() => fail && fail(err("permission-denied"))); return () => {}; } const l = { kind: "doc", path, cb }; listeners.push(l); setTimeout(() => cb(docSnap(path))); return () => listeners.splice(listeners.indexOf(l), 1); },
    };
  }
  const fs = {
    collection: (name) => ({
      onSnapshot: (a, b, c) => { const cb = typeof a === "function" ? a : b, fail = typeof a === "function" ? b : c; if (denied("read", name)) { setTimeout(() => fail && fail(err("permission-denied"))); return () => {}; } const meta = typeof a === "object" && a && a.includeMetadataChanges; const l = { kind: "col", path: name, cb }; listeners.push(l);
        if (opts.cacheFirst) { setTimeout(() => { const sn = colSnap(name); sn.metadata = { fromCache: true }; cb(sn); }); if (meta) setTimeout(() => cb(colSnap(name)), 50); }
        else setTimeout(() => cb(colSnap(name))); return () => listeners.splice(listeners.indexOf(l), 1); },
      limit: () => ({ get: () => Promise.resolve(colSnap(name)) }),
      where: (f, op, v) => ({
        onSnapshot: (cb, fail) => { if (denied("readq", name, { field: f, value: v })) { setTimeout(() => fail && fail(err("permission-denied"))); return () => {}; }
          const wrap = () => { const sn = colSnap(name); sn.docs = sn.docs.filter(d => (d.data() || {})[f] === v); return sn; };
          const l = { kind: "colq", path: name, cb: () => cb(wrap()) }; listeners.push(l); setTimeout(() => cb(wrap())); return () => listeners.splice(listeners.indexOf(l), 1); },
      }),
      get: () => Promise.resolve(colSnap(name)),
    }),
    doc: docRef,
    batch: () => { const ops = []; return { set: (ref, d) => ops.push(["s", ref, d]), update: (ref, d) => ops.push(["u", ref, d]), commit: () => Promise.all(ops.map(o => o[0] === "s" ? o[1].set(o[2]) : o[1].update(o[2]))) }; },
    enablePersistence: () => Promise.resolve(),
  };
  function setUser(u) { currentUser = u; if (authCb) setTimeout(() => authCb(u)); }
  const auth = {
    onAuthStateChanged: (cb) => { authCb = cb; setTimeout(() => cb(currentUser)); },
    signInWithPopup: () => { setUser(opts.popupUser || null); return Promise.resolve(); },
    signOut: () => { setUser(null); return Promise.resolve(); },
    get currentUser() { return currentUser; },
  };
  const firebase = {
    initializeApp: () => {},
    auth: Object.assign(() => auth, { GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }),
    firestore: () => fs,
  };
  return { firebase, store, log, setUser };
};
