(() => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  const links = [...document.querySelectorAll('.site-nav a[href^="#"]')];

  const setMenu = (open) => {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    nav.classList.toggle("is-open", open);
  };

  toggle?.addEventListener("click", () => {
    setMenu(toggle.getAttribute("aria-expanded") !== "true");
  });

  links.forEach((link) => link.addEventListener("click", () => setMenu(false)));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1000) setMenu(false);
  }, { passive: true });

  const newsTimeline = document.querySelector("#news-timeline");
  const newsMore = document.querySelector(".news-more");
  const newsToggle = document.querySelector("#news-toggle");
  const newsItems = [...(newsTimeline?.querySelectorAll(".news-item") || [])];
  const recentNewsCount = 5;
  const olderNews = newsItems.slice(recentNewsCount);

  if (newsTimeline && newsMore && newsToggle && olderNews.length) {
    const setNewsExpanded = (expanded) => {
      olderNews.forEach((item) => { item.hidden = !expanded; });
      newsItems[recentNewsCount - 1].classList.toggle("is-last-visible", !expanded);
      newsToggle.setAttribute("aria-expanded", String(expanded));
      newsToggle.textContent = expanded ? "Less" : "More";
    };

    const revealLinkedNews = () => {
      let id;
      try { id = decodeURIComponent(window.location.hash.slice(1)); }
      catch { return; }
      const target = document.getElementById(id);
      if (!target || !olderNews.includes(target.closest(".news-item"))) return;
      setNewsExpanded(true);
      target.scrollIntoView({ block: "start" });
    };

    setNewsExpanded(false);
    newsMore.hidden = false;
    newsToggle.addEventListener("click", () => {
      const expanded = newsToggle.getAttribute("aria-expanded") !== "true";
      setNewsExpanded(expanded);
      if (expanded) {
        olderNews[0].tabIndex = -1;
        olderNews[0].focus();
      } else {
        newsToggle.scrollIntoView({ block: "nearest" });
      }
    });
    window.addEventListener("hashchange", revealLinkedNews);
    revealLinkedNews();
  }

  if ("IntersectionObserver" in window) {
    const sections = links
      .map((link) => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      links.forEach((link) => {
        const current = link.getAttribute("href") === "#" + visible.target.id;
        if (current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-25% 0px -65% 0px" });

    sections.forEach((section) => observer.observe(section));
  }

  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
