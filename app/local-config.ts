// Local runtime paths for Pi Code. Regenerate with `npm run setup`.
import { fileURLToPath } from "url";

function dirUrl(url: string): string {
  try {
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url);
      const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      return cut > 0 ? path.slice(0, cut) : path;
    }
  } catch {
    // asset: URLs in headless tests — fall through.
  }
  return "";
}

const MODULE_DIR = dirUrl(import.meta.url);
const PROJECT_ROOT = MODULE_DIR ? MODULE_DIR.replace(/[/\\]app$/, "") : "";

export const BRIDGE_PATH = "/Users/klb3713/work/pi-code/server/bridge.mjs";
export const NODE_BIN = "node";
export const DEFAULT_WORKSPACE = "/Users/klb3713/work/pi-code";
export const PI_VERSION = "1.5.0";
