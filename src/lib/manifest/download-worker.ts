import { downloadTables, type DownloadRequest, type DownloadResponse } from "./download";

// First-visit manifest download off the main thread: parsing 200 MB of JSON and
// projecting it would otherwise freeze the page for seconds (and can exhaust memory
// on low-end phones alongside the app). The tables are written to IndexedDB here and
// the projected result is posted back once.
const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent<DownloadRequest>) => {
  const post = (msg: DownloadResponse) => ctx.postMessage(msg);
  try {
    const tables = await downloadTables(e.data.paths, (message, progress) =>
      post({ kind: "progress", message, progress }),
    );
    post({ kind: "done", tables });
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
