import * as esbuild from "esbuild";

const common = {
  bundle: true,
  target: ["es2020"],
  outdir: "js/dist",
  minify: true,
  sourcemap: true,
  logLevel: "info"
};

// Pages load these as modules (<script type="module">).
await esbuild.build({
  ...common,
  entryPoints: ["js/src/home.js", "js/src/guard.js", "js/src/staff-login.js"],
  format: "esm"
});

// The team panel and the customer dashboard read window.ExbDB while their own script is still being
// parsed, so this one must be a plain script that runs immediately, not a deferred module.
// The analytics tracker (js/src/track.js) is bundled in here so each page has one Firebase connection.
await esbuild.build({
  ...common,
  entryPoints: ["js/src/portal-data.js"],
  format: "iife"
});
