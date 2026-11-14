// csp-hashes.mjs — přepočítá sha256 hashe inline <script> bloků (JSON-LD) v CSP každé stránky.
// Spusť po každé úpravě JSON-LD:  node csp-hashes.mjs
// V CSP stačí mít `script-src 'self' …` — hashe za tím skript nahradí aktuálními.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

for (const file of ["index.html", "anonymize.html", "nastroje.html"]) {
  let html = readFileSync(file, "utf8");
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  // pdf.js, mammoth i Lenis jsou ve js/vendor/ (vlastní doména) → žádné cizí CDN ve script-src
  html = html.replace(/(script-src 'self')[^;]*;/, (_, head) => `${head} ${hashes.join(" ")};`);
  writeFileSync(file, html);
  console.log(`${file}: ${hashes.length} inline skript(y)`);
}
