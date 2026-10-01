/*
  A small in-memory store fed by live listeners.
  Why: the team panel refreshes every few seconds. Reading the database each time would use up the
  free Firestore quota in an hour. With live listeners each document is read ONCE when the panel opens,
  and afterwards only documents that change are sent. The panel then reads from this store, which costs nothing.

  sources: { name: { start(onData, onError) -> stopFunction } }
  onData(items) is called with the full, current list each time something changes.
*/
export function createStore(sources) {
  const names = Object.keys(sources);
  const data = {};
  const stops = [];
  const waiting = {};
  const listeners = new Set();
  let failure = null;
  let started = false;
  let stopped = false;

  for (const name of names) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {}); // the error is reported by whenReady(), not as an "unhandled rejection"
    waiting[name] = { promise, resolve, reject, done: false };
  }

  function notify(name) {
    for (const listener of [...listeners]) {
      try { listener(name); } catch (error) { /* one bad listener must not stop the others */ }
    }
  }

  function start() {
    if (started) return;
    started = true;
    for (const name of names) {
      const stop = sources[name].start(
        (items) => {
          if (stopped) return;
          data[name] = items;
          if (!waiting[name].done) {
            waiting[name].done = true;
            waiting[name].resolve();
          }
          notify(name);
        },
        (error) => {
          if (stopped) return;
          failure = failure || error;
          if (!waiting[name].done) {
            waiting[name].done = true;
            waiting[name].reject(error);
          }
          notify(name);
        }
      );
      if (typeof stop === "function") stops.push(stop);
    }
  }

  return {
    start,
    /* Resolves when every source has delivered its first data. Rejects with the first error seen. */
    async whenReady() {
      start();
      if (failure) throw failure;
      await Promise.all(names.map((n) => waiting[n].promise));
      if (failure) throw failure;
    },
    get(name) { return data[name]; },
    /* Change cached data right away (for example after a save), before the listener catches up. */
    patch(name, change) {
      data[name] = change(data[name]);
      notify(name);
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    error() { return failure; },
    stop() {
      stopped = true;
      for (const stop of stops.splice(0)) {
        try { stop(); } catch (error) { /* already stopped */ }
      }
      listeners.clear();
    }
  };
}
