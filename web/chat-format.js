(() => {
  "use strict";

  const allowedHosts = new Set([
    "jaeyeong2026.com", "www.jaeyeong2026.com", "ksa.dli-lecture.com",
    "github.com", "www.linkedin.com", "www.youtube.com",
  ]);

  const safeURL = (value) => {
    if (value === "mailto:jaeyeong2022@gmail.com") return value;
    if (!/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)
        || url.username || url.password || url.port) return null;
      return url.href;
    } catch { return null; }
  };

  // Deliberately small inline subset, not an HTML/Markdown interpreter.
  // Unrecognized syntax and rejected links remain literal text.
  const append = (container, value) => {
    const doc = container.ownerDocument || document;
    const text = String(value ?? "");
    const tokens = /\*\*([^*\r\n]+)\*\*|\[([^\][\r\n]+)\]\(([^()\s]+)\)/g;
    let cursor = 0;
    const plain = (value) => container.appendChild(doc.createTextNode(value));
    for (const match of text.matchAll(tokens)) {
      if (match.index > cursor) plain(text.slice(cursor, match.index));
      if (match[1] !== undefined) {
        const strong = doc.createElement("strong");
        strong.appendChild(doc.createTextNode(match[1]));
        container.appendChild(strong);
      } else {
        const href = safeURL(match[3]);
        if (href) {
          const link = doc.createElement("a");
          link.setAttribute("href", href);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
          link.appendChild(doc.createTextNode(match[2]));
          container.appendChild(link);
        } else plain(match[0]);
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) plain(text.slice(cursor));
  };

  window.JaeChatText = Object.freeze({ append });
})();
