import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const toml = readFileSync(join(root, "netlify.toml"), "utf8");
const firebase = readFileSync(join(root, "firebase.json"), "utf8");
const TEXT = new Set([".js", ".mjs", ".mts", ".ts", ".json", ".html", ".md", ".toml", ".txt", ".css", ".rules", ".map"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".netlify" || name === ".firebase") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "dist") continue;
      walk(full, out);
    } else if (TEXT.has(extname(name)) || name === ".env" || name.endsWith(".env")) {
      out.push(full);
    }
  }
  return out;
}

test("team.html is noindex and not cached", () => {
  assert.match(toml, /\[\[headers\]\][\s\S]*for = "\/team\.html"[\s\S]*X-Robots-Tag = "noindex, nofollow"/);
  assert.match(toml, /for = "\/team\.html"[\s\S]*Cache-Control = "no-cache/);
});

test("every page gets the security headers", () => {
  const block = toml.slice(toml.indexOf('for = "/*"'));
  assert.match(block, /X-Content-Type-Options = "nosniff"/);
  assert.match(block, /X-Frame-Options = "DENY"/);
  assert.match(block, /Referrer-Policy = "strict-origin-when-cross-origin"/);
  assert.match(block, /Permissions-Policy = "camera=\(\), microphone=\(\), geolocation=\(\)"/);
  assert.match(block, /Strict-Transport-Security = "max-age=31536000; includeSubDomains"/);
  assert.match(block, /Content-Security-Policy = "default-src 'self'/);
  assert.match(toml, /for = "\/user\.html"[\s\S]*X-Robots-Tag = "noindex, nofollow"/);
});

test("the public Firebase web key is the only key the secret scan is allowed to omit", () => {
  assert.match(toml, /SECRETS_SCAN_OMIT_PATHS = "js\/src\/firebase-config\.js,js\/dist\/portal-data\.js,js\/dist\/portal-data\.js\.map"/);
});

test("no service-account private key is in the repo", () => {
  const pem = /-----BEGIN PRIVATE KEY-----[\s\S]{16,}-----END PRIVATE KEY-----/;
  const files = walk(root);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const block = text.match(pem);
    if (!block) continue;
    if (block[0].includes("TESTONLYNOTREAL")) continue;
    hits.push(relative(root, file).replaceAll("\\", "/"));
  }
  assert.deepEqual(hits, [], "private key material: " + hits.join(", "));
});

test("no FIREBASE_SERVICE_ACCOUNT value and no service-account JSON file is checked in", () => {
  const files = walk(root);
  for (const file of files) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const base = rel.split("/").pop();
    assert.equal(/serviceAccount|firebase-adminsdk/i.test(base), false, rel);
    if (rel.startsWith("Docs/") || rel === "package-lock.json") continue;
    const text = readFileSync(file, "utf8");
    assert.equal(/"type"\s*:\s*"service_account"/.test(text) && rel !== "tests/firebase-admin.test.mjs" && rel !== "netlify/lib/firebase-admin.js", false, rel);
  }
  assert.ok(!/FIREBASE_SERVICE_ACCOUNT\s*=\s*\{/.test(readFileSync(join(root, "netlify.toml"), "utf8")));
});

test("jwks-rsa uses jose 4, which Netlify functions can require() (jose 6 is ESM-only and crashes the session function)", () => {
  const josePkg = join(root, "node_modules", "jwks-rsa", "node_modules", "jose", "package.json");
  const ver = JSON.parse(readFileSync(josePkg, "utf8")).version;
  assert.match(ver, /^4\./, "jwks-rsa must depend on jose 4.x, got " + ver);
});

test("firebase.json points at the rules and indexes, and names the emulator port for a later Java run", () => {
  const cfg = JSON.parse(firebase);
  assert.equal(cfg.firestore.rules, "firestore.rules");
  assert.equal(cfg.firestore.indexes, "firestore.indexes.json");
  assert.equal(cfg.emulators.firestore.port, 8080);
});
