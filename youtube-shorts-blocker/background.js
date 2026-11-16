// YouTube also navigates without loading a new document (pushState/replaceState).
chrome.webNavigation.onHistoryStateUpdated.addListener(
  ({ tabId, frameId, url }) => {
    if (frameId !== 0) return;

    const target = new URL(url);
    if (!/^\/shorts(?:\/|$)/i.test(target.pathname)) return;

    chrome.tabs.update(tabId, { url: chrome.runtime.getURL("blocked.html") })
      .catch(() => {}); // The tab may have closed while the event was delivered.
  },
  { url: [{ schemes: ["https"], hostEquals: "youtube.com" },
          { schemes: ["https"], hostSuffix: ".youtube.com" }] }
);
