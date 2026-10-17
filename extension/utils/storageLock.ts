// Every `storage.local`/`storage.session` store in this codebase
// (groups.ts, folders.ts, session.ts) is "read the whole array/map, modify
// it, write the whole thing back" — there's no partial-update primitive in
// the browser.storage API itself. Two such read-modify-writes against the
// same key, started close enough together that the second reads before the
// first writes, silently lose whichever one lands last: a classic lost
// update. This has gotten more likely, not less, now that a single native
// tab-group event can trigger a storage write from a background listener
// at the same moment a routine window resync or a dashboard action writes
// to the same key.
//
// withStorageLock serializes every read-modify-write passed through it for
// a given key: each call's `fn` only starts once every `fn` queued before
// it for that same key has fully settled, so there's never two in-flight
// reads for the same key with a write still pending between them. In-memory
// only (like utils/tabGroups.ts's mirroringWindows) — a service-worker
// restart mid-chain just drops the queue, which is fine, since nothing
// mid-flight survives that restart anyway.
const queues = new Map<string, Promise<unknown>>();

export function withStorageLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  // The queue only needs to track ordering, not this call's own result or
  // whether it threw — a failed write must not wedge every later caller.
  queues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
