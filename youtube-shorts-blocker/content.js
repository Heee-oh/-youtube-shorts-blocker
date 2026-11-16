(() => {
  "use strict";

  const blockedUrl = chrome.runtime.getURL("blocked.html");
  let redirecting = false;

  function isShorts(url) {
    return url.protocol === "https:" &&
      (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) &&
      /^\/shorts(?:\/|$)/i.test(url.pathname);
  }

  function block() {
    if (redirecting) return;
    redirecting = true;
    document.querySelectorAll("video, audio").forEach((media) => media.pause());
    location.replace(blockedUrl);
  }

  function checkLocation() {
    if (isShorts(new URL(location.href))) block();
  }

  // Capture clicks before YouTube's SPA router handles them. New-tab/direct
  // navigations are covered by the declarative network rule instead.
  document.addEventListener("click", (event) => {
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    if (!anchor || !isShorts(new URL(anchor.href, location.href))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    block();
  }, true);

  document.addEventListener("yt-navigate-start", checkLocation);
  document.addEventListener("yt-navigate-finish", checkLocation);
  window.addEventListener("popstate", checkLocation);
  window.addEventListener("pageshow", checkLocation);
  checkLocation();
})();
