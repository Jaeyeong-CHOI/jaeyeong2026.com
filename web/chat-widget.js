(() => {
  "use strict";

  const script = document.currentScript;
  const apiBase = (script?.dataset.apiBase || "").replace(/\/$/, "");
  const defaults = {
    perMinute: 5, perDay: 20, maxMessageChars: 1000,
    maxHistoryMessages: 6, maxHistoryChars: 6000,
  };
  let limits = { ...defaults };
  let availability = "unknown";
  let history = [];
  let busy = false;
  let requestId = 0;
  let controller = null;
  let cooldownUntil = 0;
  let cooldownTimer = null;
  let remainingToday = null;
  let previousFocus = null;

  const root = document.createElement("div");
  root.className = "jae-chat";
  // This template is static. All visitor and API text is inserted with textContent.
  root.innerHTML = `
    <button class="jae-chat-launcher" type="button" aria-haspopup="dialog" aria-controls="jae-chat-dialog" aria-expanded="false">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H9l-5 3v-6.5a7.5 7.5 0 1 1 16-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.5 10.5h7m-7 3h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <span>Ask Jae’s AI</span>
    </button>
    <dialog class="jae-chat-dialog" id="jae-chat-dialog" aria-labelledby="jae-chat-title" aria-describedby="jae-chat-description">
      <div class="jae-chat-shell">
        <div class="jae-chat-header">
          <span class="jae-chat-avatar" aria-hidden="true">J.</span>
          <div class="jae-chat-heading">
            <h2 id="jae-chat-title">Ask about Jae</h2>
            <p id="jae-chat-description">A little curiosity, a conversation.</p>
          </div>
          <button class="jae-chat-close jae-chat-icon-button" type="button" aria-label="Close chat" autofocus>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="jae-chat-toolbar">
          <span class="jae-chat-availability">AI profile assistant</span>
          <button class="jae-chat-clear" type="button" title="Clear this conversation. Request limits do not reset." disabled>New chat</button>
        </div>
        <div class="jae-chat-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          <div class="jae-chat-intro">
            <span class="jae-chat-intro-mark" aria-hidden="true">✳</span>
            <h3>Curious about Jae?</h3>
            <p>Research, projects, or the next adventure.<br>Start with a question.</p>
          </div>
        </div>
        <div class="jae-chat-notice" role="status" hidden>
          <p class="jae-chat-notice-title"></p>
          <p class="jae-chat-notice-text"></p>
          <div class="jae-chat-notice-actions">
            <button class="jae-chat-retry" type="button" hidden>Retry</button>
            <a href="mailto:jaeyeong2022@gmail.com">Email Jae ↗</a>
          </div>
        </div>
        <form class="jae-chat-form">
          <label class="jae-chat-sr-only" for="jae-chat-message">Your question for Jae’s AI</label>
          <div class="jae-chat-input-row">
            <textarea id="jae-chat-message" rows="2" maxlength="1000" placeholder="Ask a question…" aria-describedby="jae-chat-input-help jae-chat-count" disabled></textarea>
            <button class="jae-chat-send jae-chat-icon-button" type="submit" aria-label="Send message" disabled>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="jae-chat-input-meta"><span id="jae-chat-input-help">Enter to send · Shift + Enter for a new line</span><span id="jae-chat-count">0 / 1,000</span></div>
          <p class="jae-chat-quota"></p>
        </form>
        <p class="jae-chat-disclaimer">AI can make mistakes. Messages are sent to OpenAI.<br>Please don’t share sensitive information.</p>
        <span class="jae-chat-sr-only jae-chat-announcement" role="status" aria-live="polite"></span>
      </div>
    </dialog>`;
  document.body.append(root);

  const select = (selector) => root.querySelector(selector);
  const launcher = select(".jae-chat-launcher");
  const dialog = select(".jae-chat-dialog");
  const close = select(".jae-chat-close");
  const clear = select(".jae-chat-clear");
  const form = select(".jae-chat-form");
  const input = select("textarea");
  const send = select(".jae-chat-send");
  const log = select(".jae-chat-messages");
  const intro = select(".jae-chat-intro");
  const notice = select(".jae-chat-notice");
  const noticeTitle = select(".jae-chat-notice-title");
  const noticeText = select(".jae-chat-notice-text");
  const retry = select(".jae-chat-retry");
  const availabilityLabel = select(".jae-chat-availability");
  const quota = select(".jae-chat-quota");
  const count = select("#jae-chat-count");
  const announcement = select(".jae-chat-announcement");

  const refreshControls = () => {
    const coolingDown = cooldownUntil > Date.now();
    input.disabled = availability !== "enabled" || busy;
    send.disabled = input.disabled || coolingDown || !input.value.trim()
      || input.value.length > limits.maxMessageChars;
    clear.disabled = !log.querySelector(".jae-chat-bubble") && !busy && !input.value;
    count.textContent = `${input.value.length.toLocaleString("en-US")} / ${limits.maxMessageChars.toLocaleString("en-US")}`;
    count.classList.toggle("is-over-limit", input.value.length > limits.maxMessageChars);
    input.setAttribute("aria-invalid", String(input.value.length > limits.maxMessageChars));
    input.maxLength = limits.maxMessageChars;
    quota.textContent = remainingToday === null
      ? `Up to ${limits.perMinute} requests / min · ${limits.perDay} / day per network`
      : `${remainingToday} requests left today on this network · ${limits.perMinute} / min`;
    retry.disabled = busy || coolingDown;
  };

  const showNotice = (title, text, retryLabel = "") => {
    noticeTitle.textContent = title;
    noticeText.textContent = text;
    retry.hidden = !retryLabel;
    retry.textContent = retryLabel;
    notice.hidden = false;
  };

  const hideNotice = () => { notice.hidden = true; };
  const scrollToLatest = () => { log.scrollTop = log.scrollHeight; };

  const addBubble = (role, text, pending = false) => {
    const bubble = document.createElement("div");
    bubble.className = `jae-chat-bubble jae-chat-bubble-${role}`;
    if (pending) bubble.classList.add("is-pending");
    const label = document.createElement("span");
    label.className = "jae-chat-bubble-label";
    label.textContent = role === "user" ? "You" : "Jae’s AI";
    const content = document.createElement("p");
    content.textContent = text;
    bubble.append(label, content);
    intro.hidden = true;
    log.append(bubble);
    scrollToLatest();
    return bubble;
  };

  // Only complete successful turns enter the next request. Clear chat is local,
  // not a way to reset quotas; the server owns all usage limits.
  const boundedHistory = (messages) => {
    // Keep the full displayed answer, but only a coherent recent suffix that
    // satisfies the API's per-message caps may be sent back as conversation.
    let start = 0;
    for (let i = 0; i < messages.length; i += 2) {
      if (messages[i].content.length > limits.maxMessageChars
        || messages[i + 1].content.length > 4000) start = i + 2;
    }
    const result = messages.slice(start);
    let size = result.reduce((total, message) => total + message.content.length, 0);
    while (result.length > limits.maxHistoryMessages || size > limits.maxHistoryChars) {
      const removed = result.splice(0, 2);
      size -= removed.reduce((total, message) => total + message.content.length, 0);
    }
    return result;
  };

  const fetchJSON = async (path, options, signal) => {
    if (!apiBase) throw new Error("Service unavailable");
    const response = await fetch(`${apiBase}${path}`, {
      ...options, signal, credentials: "omit", cache: "no-store",
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("Invalid service response"); }
    return { response, data };
  };

  const checkStatus = async () => {
    if (busy || availability === "loading") return;
    const focusInputOnSuccess = document.activeElement === retry;
    availability = "loading";
    availabilityLabel.textContent = "Checking availability…";
    showNotice("One moment", "Checking whether Jae’s AI is available.");
    refreshControls();
    const id = ++requestId;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const { response, data } = await fetchJSON("/v1/status", { method: "GET" }, requestController.signal);
      if (id !== requestId) return;
      if (!response.ok || typeof data.enabled !== "boolean") throw new Error("Service unavailable");
      for (const key of Object.keys(defaults)) {
        const value = data.limits?.[key];
        limits[key] = Number.isSafeInteger(value) && value > 0
          ? Math.min(value, defaults[key]) : defaults[key];
      }
      availability = data.enabled ? "enabled" : "disabled";
      availabilityLabel.textContent = data.enabled ? "Ready for your questions" : "Coming soon";
      if (data.enabled) {
        hideNotice();
        if (dialog.open) input.disabled = false;
        if (dialog.open && focusInputOnSuccess) input.focus();
      } else {
        showNotice("Coming soon", typeof data.message === "string" && data.message.trim()
          ? data.message : "Jae’s AI is getting ready. In the meantime, feel free to get in touch.", "Check again");
      }
    } catch {
      if (id !== requestId) return;
      availability = "error";
      availabilityLabel.textContent = "Temporarily unavailable";
      showNotice("Let’s try again", "The chat is unavailable right now. Please retry in a moment, or email Jae directly.", "Retry");
    } finally {
      clearTimeout(timeout);
      if (id === requestId) {
        controller = null;
        refreshControls();
      }
    }
  };

  const startCooldown = (seconds) => {
    clearTimeout(cooldownTimer);
    const duration = Math.max(1, Math.min(seconds || 60, 86400));
    cooldownUntil = Date.now() + duration * 1000;
    const minutes = Math.ceil(duration / 60);
    const when = duration < 60 ? `${Math.ceil(duration)} seconds` : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    showNotice("A short pause", `The request limit has been reached. Please try again in about ${when}. Starting a new chat does not reset the limit.`, "Try again");
    cooldownTimer = setTimeout(() => {
      cooldownUntil = 0;
      showNotice("Ready to try again", "You can retry your question now. Shared-network limits may still apply.", "Try again");
      refreshControls();
    }, duration * 1000);
  };

  const sendMessage = async () => {
    const message = input.value.trim();
    if (busy || availability !== "enabled" || cooldownUntil > Date.now()
      || !message || message.length > limits.maxMessageChars) return;
    busy = true;
    hideNotice();
    const previousHistory = boundedHistory(history);
    const userBubble = addBubble("user", message);
    const pendingBubble = addBubble("assistant", "Thinking…", true);
    input.value = "";
    input.style.height = "";
    refreshControls();
    const id = ++requestId;
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 50000);
    try {
      const { response, data } = await fetchJSON("/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: previousHistory }),
      }, requestController.signal);
      if (id !== requestId) return;
      if (!response.ok) {
        if (response.status === 429) {
          const rawDelay = response.headers.get("Retry-After");
          const headerDelay = rawDelay && /^\d+$/.test(rawDelay)
            ? Number(rawDelay) : (Date.parse(rawDelay || "") - Date.now()) / 1000;
          const bodyDelay = Number(data.error?.retryAfter);
          startCooldown(Number.isFinite(headerDelay) && headerDelay > 0
            ? headerDelay : Number.isFinite(bodyDelay) && bodyDelay > 0 ? bodyDelay : 60);
        } else if (response.status === 503) {
          availability = "error";
          availabilityLabel.textContent = "Temporarily unavailable";
          showNotice("Back soon", "The assistant is not available right now. Please check again shortly, or email Jae directly.", "Check again");
        } else {
          showNotice("No reply this time", "Your question is saved below. Please try again, or email Jae directly.", "Try again");
        }
        throw new Error("Handled response error");
      }
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("Empty service response");
      pendingBubble.remove();
      addBubble("assistant", data.reply);
      history = boundedHistory([...previousHistory, { role: "user", content: message }, { role: "assistant", content: data.reply }]);
      if (Number.isSafeInteger(data.remainingToday) && data.remainingToday >= 0) remainingToday = data.remainingToday;
    } catch {
      if (id !== requestId) return;
      userBubble.remove();
      pendingBubble.remove();
      intro.hidden = log.querySelector(".jae-chat-bubble") !== null;
      input.value = message;
      if (notice.hidden) showNotice("Couldn’t get a reply", "The connection took too long or was interrupted. Your question is saved below. You can try again when you’re ready.", "Try again");
    } finally {
      clearTimeout(timeout);
      if (id === requestId) {
        busy = false;
        controller = null;
        refreshControls();
        if (dialog.open && !input.disabled) input.focus();
      }
    }
  };

  launcher.addEventListener("click", () => {
    previousFocus = document.activeElement;
    dialog.showModal();
    launcher.setAttribute("aria-expanded", "true");
    if (availability === "unknown") checkStatus();
    else if (availability === "enabled" && !busy) input.focus();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    launcher.setAttribute("aria-expanded", "false");
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    else launcher.focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  clear.addEventListener("click", () => {
    if (busy) {
      ++requestId;
      controller?.abort();
      controller = null;
    }
    busy = false;
    history = [];
    log.querySelectorAll(".jae-chat-bubble").forEach((bubble) => bubble.remove());
    intro.hidden = false;
    input.value = "";
    input.style.height = "";
    if (availability === "enabled" && cooldownUntil <= Date.now()) hideNotice();
    announcement.textContent = "Conversation cleared. Request limits have not changed.";
    refreshControls();
    if (!input.disabled) input.focus();
  });
  retry.addEventListener("click", () => {
    if (cooldownUntil > Date.now()) return;
    if (availability !== "enabled") checkStatus();
    else {
      hideNotice();
      input.focus();
    }
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(); });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    refreshControls();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      sendMessage();
    }
  });
  refreshControls();
})();
