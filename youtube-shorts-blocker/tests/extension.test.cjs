const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const vm = require("node:vm");

const root = resolve(__dirname, "..");
const read = (name) => readFileSync(join(root, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const rules = JSON.parse(read("rules.json"));
const blockedUrl = "chrome-extension://test/blocked.html";

test("the manifest references existing resources and limits host access to YouTube", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://*.youtube.com/*"]);
  const resources = [manifest.background.service_worker,
    ...manifest.content_scripts.flatMap(({ js, css }) => [...js, ...css]),
    ...manifest.declarative_net_request.rule_resources.map(({ path }) => path),
    ...manifest.web_accessible_resources.flatMap(({ resources }) => resources)];
  for (const file of resources) assert.ok(existsSync(join(root, file)), file);
});

test("the network redirect matches Shorts but preserves ordinary videos and other sites", () => {
  const pattern = new RegExp(rules[0].condition.regexFilter, "i");
  for (const url of ["https://youtube.com/shorts", "https://www.youtube.com/shorts/abc",
    "https://m.youtube.com/shorts?feature=share", "https://www.youtube.com/shorts#tab"]) {
    assert.ok(pattern.test(url), url);
  }
  for (const url of ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/",
    "https://www.youtube.com/results?search_query=shorts", "https://www.youtube.com/shortstuff",
    "https://www.youtube.com/@creator/shorts", "https://youtube.com.evil.test/shorts/abc",
    "https://notyoutube.com/shorts/abc"]) assert.ok(!pattern.test(url), url);
  assert.equal(rules[0].action.redirect.extensionPath, "/blocked.html");
  assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);
});

test("SPA history changes redirect only the main frame's Shorts route", async () => {
  let listener;
  const updates = [];
  vm.runInNewContext(read("background.js"), {
    URL,
    chrome: {
      runtime: { getURL: () => blockedUrl },
      webNavigation: { onHistoryStateUpdated: { addListener: (fn) => { listener = fn; } } },
      tabs: { update: (...args) => { updates.push(args); return Promise.resolve(); } }
    }
  });
  listener({ tabId: 42, frameId: 0, url: "https://www.youtube.com/shorts/abc" });
  listener({ tabId: 42, frameId: 1, url: "https://www.youtube.com/shorts/abc" });
  listener({ tabId: 42, frameId: 0, url: "https://www.youtube.com/watch?v=abc" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 42);
  assert.equal(updates[0][1].url, blockedUrl);
});

function contentHarness(href) {
  const documentEvents = new Map();
  const windowEvents = new Map();
  const redirects = [];
  let pauses = 0;
  class Anchor { constructor(href) { this.href = href; } }
  const location = { href, replace: (url) => redirects.push(url) };
  vm.runInNewContext(read("content.js"), {
    URL, HTMLAnchorElement: Anchor, location,
    chrome: { runtime: { getURL: () => blockedUrl } },
    document: {
      addEventListener: (name, fn) => documentEvents.set(name, fn),
      querySelectorAll: () => [{ pause: () => { pauses++; } }]
    },
    window: { addEventListener: (name, fn) => windowEvents.set(name, fn) }
  });
  return { documentEvents, windowEvents, redirects, location, Anchor, get pauses() { return pauses; } };
}

test("initial Shorts are stopped; ordinary video playback is untouched", () => {
  const shorts = contentHarness("https://www.youtube.com/shorts/abc");
  assert.equal(shorts.redirects[0], blockedUrl);
  assert.equal(shorts.pauses, 1);
  const normal = contentHarness("https://www.youtube.com/watch?v=abc");
  assert.equal(normal.redirects.length, 0);
  assert.equal(normal.pauses, 0);
});

test("nested clicks are caught before YouTube handles a Shorts link", () => {
  const harness = contentHarness("https://www.youtube.com/");
  let prevented = false;
  let stopped = false;
  harness.documentEvents.get("click")({
    composedPath: () => [{}, new harness.Anchor("/shorts/abc")],
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { stopped = true; }
  });
  assert.ok(prevented && stopped);
  assert.deepEqual(harness.redirects, [blockedUrl]);
});

test("ordinary and external links keep their default behavior", () => {
  const harness = contentHarness("https://www.youtube.com/");
  for (const href of ["/watch?v=abc", "https://example.com/shorts/abc", "/@creator/shorts"]) {
    harness.documentEvents.get("click")({
      composedPath: () => [new harness.Anchor(href)],
      preventDefault: () => assert.fail(href),
      stopImmediatePropagation: () => assert.fail(href)
    });
  }
  assert.equal(harness.redirects.length, 0);
});

test("client navigation and back/forward are guarded without duplicate redirects", () => {
  for (const event of ["yt-navigate-start", "yt-navigate-finish", "popstate", "pageshow"]) {
    const harness = contentHarness("https://www.youtube.com/");
    harness.location.href = "https://www.youtube.com/shorts/abc";
    const callback = harness.documentEvents.get(event) || harness.windowEvents.get(event);
    callback();
    callback();
    assert.deepEqual(harness.redirects, [blockedUrl], event);
  }
});
