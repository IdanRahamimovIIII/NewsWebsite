/* =====================================================================
   serve.mjs — look at the site the way a visitor does.

   Opening site/index.html straight from disk LOOKS like it works: the tree
   and the charts appear, because those come from next.obudget.org over the
   network. But anything the page reads from its own folder — data/paid/*.json
   — is blocked by the browser on file://, silently. That is exactly how
   "dashes everywhere" happened, with no error to see.

   Run this instead. Zero dependencies, nothing installed.

       node tools/serve.mjs            →  http://localhost:8080
       node tools/serve.mjs 3000       →  a different port

   Ctrl+C to stop.
   ===================================================================== */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "site");
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

if (!fs.existsSync(ROOT)) {
  console.error(`Cannot find the site folder at ${ROOT}`);
  console.error("Run this from the project folder:  node tools/serve.mjs");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  let file = path.join(ROOT, rel);

  // never serve anything outside site/, however the path is spelled
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("no"); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory())
    file = path.join(file, "index.html");

  fs.readFile(file, (err, buf) => {
    if (err) {
      console.log(`  404  ${rel}`);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 — " + rel);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",     // always see the file you just saved
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`\n  הכסף שלנו — running from ${ROOT}\n`);
  console.log(`    the site          http://localhost:${PORT}/`);
  console.log(`    payments check    http://localhost:${PORT}/tools/paidcheck.html\n`);
  console.log("  Ctrl+C to stop. 404s are logged below, so a missing file is visible.\n");
});
