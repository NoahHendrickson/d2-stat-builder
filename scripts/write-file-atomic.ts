import { rename, writeFile } from "node:fs/promises";

/** Writes `data` to `path` through a temporary file, so a crash mid-write never leaves half a file there. */
export async function writeFileAtomic(path: string, data: string | Buffer) {
  await writeFile(`${path}.tmp`, data);
  await rename(`${path}.tmp`, path);
}
