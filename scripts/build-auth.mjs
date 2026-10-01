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
  entryPoints: ["js/src/home.js", "js/src/guard.js", "js/src/track.js"],
  format: "esm"
});

// The team panel reads window.ExbDB while its own script is still being parsed,
// so this one must be a plain script that runs immediately, not a deferred module.
await esbuild.build({
  ...common,
  entryPoints: ["js/src/portal-data.js"],
  format: "iife"
});
