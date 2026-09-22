import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage", ".turbo", ".data"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function stripJs(src, isTsx) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const nxt = i + 1 < n ? src[i + 1] : "";
    if (ch === '"' || ch === "'") {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        out += c;
        if (c === "\\" && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (c === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        if (c === "\\" && i + 1 < n) {
          out += c + src[i + 1];
          i += 2;
          continue;
        }
        if (c === "`") {
          out += c;
          i++;
          break;
        }
        if (c === "$" && i + 1 < n && src[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const c2 = src[i];
            if (c2 === '"' || c2 === "'" || c2 === "`") {
              const q = c2;
              out += c2;
              i++;
              while (i < n) {
                const c3 = src[i];
                out += c3;
                if (c3 === "\\" && i + 1 < n) {
                  out += src[i + 1];
                  i += 2;
                  continue;
                }
                if (c3 === q) {
                  i++;
                  break;
                }
                i++;
              }
              continue;
            }
            if (c2 === "{") depth++;
            else if (c2 === "}") depth--;
            out += c2;
            i++;
          }
          continue;
        }
        out += c;
        i++;
      }
      continue;
    }
    if (ch === "/" && nxt === "/") {
      i += 2;
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      continue;
    }
    if (ch === "/" && nxt === "*") {
      i += 2;
      while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (isTsx && ch === "{" && nxt === "/" && i + 2 < n && src[i + 2] === "*") {
      i += 3;
      while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      if (i < n && src[i] === "}") i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function stripCss(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const nxt = i + 1 < n ? src[i + 1] : "";
    if (ch === '"' || ch === "'") {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        out += c;
        if (c === "\\" && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (c === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && nxt === "*") {
      i += 2;
      while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const files = walk(ROOT);
let changed = 0;
for (const file of files) {
  if (file.includes(`${path.sep}scripts${path.sep}strip-comments`)) continue;
  const original = fs.readFileSync(file, "utf8");
  const ext = path.extname(file).toLowerCase();
  const cleaned =
    ext === ".css"
      ? stripCss(original)
      : stripJs(original, ext === ".tsx" || ext === ".jsx");
  if (cleaned !== original) {
    fs.writeFileSync(file, cleaned);
    changed++;
    console.log("STRIPPED", path.relative(ROOT, file));
  }
}
console.log(`DONE total=${files.length} changed=${changed}`);
