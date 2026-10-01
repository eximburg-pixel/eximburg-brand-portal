import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["js/src/home.js", "js/src/guard.js", "js/src/track.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  outdir: "js/dist",
  minify: true,
  sourcemap: true
});
