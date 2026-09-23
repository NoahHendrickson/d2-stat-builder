import { downloadTables, type DownloadRequest, type DownloadResponse } from "./download";

// Manifest download off the main thread: parsing 200 MB of JSON and projecting it
// would otherwise freeze the page for seconds. (It does NOT lower peak memory — the
// parsed table and its projection coexist here just as they would on the main thread,
// and the result is structured-cloned once more on the way back; a device that would
// run out of memory still does, which is why the caller times the worker out.) The
// tables are written to IndexedDB here and the projected result is posted back once.
const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent<DownloadRequest>) => {
  const post = (msg: DownloadResponse) => ctx.postMessage(msg);
  try {
    const tables = await downloadTables(e.data.stamp, e.data.paths, (message, progress) =>
      post({ kind: "progress", message, progress }),
    );
    post({ kind: "done", tables });
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
