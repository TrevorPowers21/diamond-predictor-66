/**
 * The version check reloads real coach sessions, so the parse has to be exact.
 * A parse that silently returns null degrades to "never reload" (stale sessions
 * come back); one that returns the wrong string reloads on every check. Both
 * fail quietly in production, which is why they're pinned here.
 */
import { describe, it, expect } from "vitest";
import { parseEntrySrc } from "@/lib/buildVersion";

// Trimmed from a real `vite build` output.
const PROD_HTML = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <title>RSTR IQ — Everyday GM</title>
    <script type="module" crossorigin src="/assets/index-LxfBe-Gv.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-BqK2mn1z.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("parseEntrySrc", () => {
  it("pulls the hashed entry bundle out of a production index.html", () => {
    expect(parseEntrySrc(PROD_HTML)).toBe("/assets/index-LxfBe-Gv.js");
  });

  it("returns a different value when the build changes — the whole point", () => {
    const next = PROD_HTML.replace("index-LxfBe-Gv.js", "index-DFWcvIv_.js");
    expect(parseEntrySrc(next)).not.toBe(parseEntrySrc(PROD_HTML));
  });

  it("handles the dev entry, which is unhashed", () => {
    const dev = `<html><body><script type="module" src="/src/main.tsx"></script></body></html>`;
    expect(parseEntrySrc(dev)).toBe("/src/main.tsx");
  });

  it("does not care about attribute order", () => {
    const reordered = `<script src="/assets/index-abc123.js" type="module" crossorigin></script>`;
    expect(parseEntrySrc(reordered)).toBe("/assets/index-abc123.js");
  });

  it("accepts single quotes", () => {
    const single = `<script type='module' src='/assets/index-xyz789.js'></script>`;
    expect(parseEntrySrc(single)).toBe("/assets/index-xyz789.js");
  });

  it("skips a module script with no src rather than matching it", () => {
    const inline = `<script type="module">console.log("inline")</script>
      <script type="module" src="/assets/index-real.js"></script>`;
    expect(parseEntrySrc(inline)).toBe("/assets/index-real.js");
  });

  it("returns null when there is no module script — degrades to never reloading", () => {
    expect(parseEntrySrc("<html><body>nothing here</body></html>")).toBeNull();
  });

  it("ignores non-module scripts", () => {
    const classic = `<script src="/legacy.js"></script>`;
    expect(parseEntrySrc(classic)).toBeNull();
  });

  it("returns null on an error page rather than a bogus version", () => {
    // If the fetch is intercepted by a captive portal or error page, we must not
    // read some unrelated script tag as "the new build" and reload in a loop.
    expect(parseEntrySrc("<html><body><h1>502 Bad Gateway</h1></body></html>")).toBeNull();
  });
});
