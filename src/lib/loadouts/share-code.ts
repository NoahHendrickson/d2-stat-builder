// Server-only: the short code a shared loadout is stored under. Derived from the
// content, so sharing the same loadout again gives the same link and adds no row.
import { createHash } from "node:crypto";
import { SHARE_CODE_LENGTH } from "./share";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(BASE62.length);

export function shareCodeFor(json: string): string {
  let n = createHash("sha256").update(json).digest().readBigUInt64BE(0);
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    code += BASE62[Number(n % BASE)];
    n /= BASE;
  }
  return code;
}
