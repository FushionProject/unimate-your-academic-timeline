(() => {
  if (window.top !== window) return;
  // This binding exists only in Chrome's extension isolated world; host-page
  // JavaScript cannot read or invoke it. It allows a newly injected generation
  // to synchronously stop an older instance without a forgeable DOM event.
  try {
    globalThis.__unimateCompanionPrivateDispose?.();
  } catch {
    // An invalidated older extension world may already be inert.
  }
  document.getElementById("unimate-companion-host")?.remove();

  const state = {
    open: false,
    auth: null,
    privacyConsent: null,
    messages: [],
    activeConversationId: null,
    activeConversationTitle: "Browser Companion",
    conversationStartIndex: 0,
    busy: false,
    captureHidden: false,
    captureStyle: null,
    previouslyFocused: null,
    diagnostics: null,
    runtime: {
      injectedAt: new Date().toISOString(),
      connected: false,
      reconnectAttempts: 0,
      lastError: "",
      lastErrorCode: "",
      lastErrorPhase: "",
      serviceWorker: null,
    },
  };

  function extensionRuntime() {
    const runtime = globalThis.chrome?.runtime;
    return runtime?.id && typeof runtime.sendMessage === "function" ? runtime : null;
  }

  function runtimeUnavailableError() {
    return new Error(
      "The UniMate extension was updated or reloaded. Refresh this page once to reconnect it.",
    );
  }

  const host = document.createElement("div");
  host.id = "unimate-companion-host";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .um-root { position: fixed; z-index: 2147483647; right: 0; top: 50%; transform: translateY(-50%); font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #24211d; }
    .um-mascot { position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 62px; height: 76px; padding: 0; border: 0; border-radius: 24px 0 0 24px; background: #F5C518; box-shadow: 0 10px 32px rgba(37, 31, 20, .2); cursor: pointer; display: grid; place-items: center; transition: width .18s ease, filter .18s ease; }
    .um-mascot:hover { width: 68px; filter: brightness(1.03); }
    .um-mascot:focus-visible, .um-icon-button:focus-visible, .um-screen:focus-visible, .um-send:focus-visible, .um-primary:focus-visible, .um-link:focus-visible { outline: 3px solid rgba(36,33,29,.72); outline-offset: 3px; }
    .um-mascot img { width: 48px; height: 64px; object-fit: contain; pointer-events: none; }
    .um-panel { position: absolute; right: 76px; top: 50%; transform: translateY(-50%) translateX(18px); width: min(380px, calc(100vw - 96px)); height: min(620px, calc(100vh - 32px)); border: 1px solid rgba(36,33,29,.1); border-radius: 24px; background: #FAF7F2; box-shadow: 0 24px 70px rgba(37,31,20,.22); overflow: hidden; overscroll-behavior: contain; display: flex; flex-direction: column; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s; }
    .um-panel.open { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(-50%) translateX(0); transition-delay: 0s; }
    .um-header { min-height: 70px; padding: 16px 18px; border-bottom: 1px solid rgba(36,33,29,.08); display: flex; align-items: center; justify-content: space-between; background: rgba(250,247,242,.95); }
    .um-brand { display: flex; align-items: center; gap: 11px; }
    .um-mark { width: 37px; height: 37px; border-radius: 13px; background: #F5C518; display: grid; place-items: center; font-size: 19px; }
    .um-title { font: 700 15px/1.15 inherit; }
    .um-subtitle { margin-top: 3px; color: #746e66; font: 500 11px/1.2 inherit; }
    .um-icon-button { border: 0; background: transparent; color: #746e66; cursor: pointer; padding: 7px; border-radius: 10px; font: 600 18px/1 inherit; }
    .um-icon-button:hover { background: rgba(36,33,29,.06); color: #24211d; }
    .um-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .um-status { margin: 14px 16px 0; padding: 9px 11px; border-radius: 12px; background: #fff9dc; color: #675512; font: 600 11px/1.35 inherit; }
    .um-status.error { background: #fff0ed; color: #9a3429; }
    .um-messages { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 17px 16px 8px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: rgba(36,33,29,.2) transparent; }
    .um-empty { margin: auto 22px; text-align: center; color: #746e66; font: 500 13px/1.55 inherit; }
    .um-empty strong { display: block; color: #24211d; font-size: 17px; margin-bottom: 7px; }
    .um-message { max-width: 86%; border-radius: 16px; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; font: 500 13px/1.48 inherit; }
    .um-message.user { align-self: flex-end; background: #F5C518; color: #2c2508; border-bottom-right-radius: 5px; }
    .um-message.assistant { align-self: flex-start; background: #fff; border: 1px solid rgba(36,33,29,.08); border-bottom-left-radius: 5px; }
    .um-thinking { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; min-height: 38px; padding: 11px 13px; border: 1px solid rgba(36,33,29,.08); border-radius: 16px 16px 16px 5px; background: #fff; color: #827b72; }
    .um-thinking i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: um-pulse 1.1s ease-in-out infinite; }
    .um-thinking i:nth-child(2) { animation-delay: .14s; }
    .um-thinking i:nth-child(3) { animation-delay: .28s; }
    @keyframes um-pulse { 0%, 70%, 100% { opacity: .28; transform: translateY(0); } 35% { opacity: .9; transform: translateY(-2px); } }
    .um-composer { padding: 12px; border-top: 1px solid rgba(36,33,29,.08); background: #FAF7F2; }
    .um-context-row { margin: 0 4px 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .um-context { min-width: 0; color: #827b72; font: 500 10px/1.3 inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .um-screen { flex: 0 0 auto; border: 0; padding: 3px 0; background: transparent; color: #675512; cursor: pointer; font: 650 10px/1.2 inherit; }
    .um-screen:disabled { opacity: .45; cursor: default; }
    .um-form { display: flex; align-items: flex-end; gap: 8px; padding: 7px 7px 7px 12px; border: 1px solid rgba(36,33,29,.14); border-radius: 17px; background: #fff; }
    .um-input { flex: 1; resize: none; border: 0; outline: 0; min-height: 30px; max-height: 112px; padding: 7px 0; background: transparent; color: #24211d; font: 500 13px/1.4 inherit; }
    .um-send { flex: 0 0 auto; width: 38px; height: 38px; border: 0; border-radius: 13px; background: #F5C518; color: #2c2508; cursor: pointer; font: 800 17px/1 inherit; }
    .um-send:disabled { opacity: .45; cursor: default; }
    .um-auth { margin: auto; width: 100%; padding: 28px; text-align: center; }
    .um-auth h2 { margin: 0 0 8px; font: 750 20px/1.2 inherit; }
    .um-auth p { margin: 0 0 20px; color: #746e66; font: 500 13px/1.5 inherit; }
    .um-disclosure { margin: 16px 0 4px; padding: 14px; border: 1px solid rgba(36,33,29,.1); border-radius: 14px; background: #fff; color: #5f5951; text-align: left; font: 500 12px/1.5 inherit; }
    .um-disclosure strong { display: block; margin-bottom: 5px; color: #24211d; font-size: 12px; }
    .um-secondary { width: 100%; margin-top: 8px; padding: 11px; border: 1px solid rgba(36,33,29,.14); border-radius: 13px; background: transparent; color: #5f5951; cursor: pointer; font: 700 12px/1 inherit; }
    .um-field { width: 100%; margin-top: 10px; padding: 12px 13px; border: 1px solid rgba(36,33,29,.15); border-radius: 13px; background: #fff; outline: none; font: 500 13px/1 inherit; }
    .um-field:focus { border-color: #d3aa13; box-shadow: 0 0 0 3px rgba(245,197,24,.18); }
    .um-primary { width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 13px; background: #F5C518; color: #2c2508; cursor: pointer; font: 750 13px/1 inherit; }
    .um-primary:disabled { opacity: .5; }
    .um-link { border: 0; background: transparent; margin-top: 14px; color: #746e66; text-decoration: underline; cursor: pointer; font: 600 11px/1 inherit; }
    .um-hidden { display: none !important; }
    @media (max-width: 520px) { .um-root { top: auto; bottom: 16px; transform: none; } .um-panel, .um-panel.open { position: fixed; inset: 12px 68px 12px 12px; width: auto; height: auto; transform: translateX(0); border-radius: 20px; } .um-mascot { width: 54px; height: 68px; } }
    @media (prefers-reduced-motion: reduce) { .um-mascot, .um-panel { transition: none; } .um-thinking i { animation: none; opacity: .55; } }
  `;

  const root = document.createElement("div");
  root.className = "um-root";
  root.innerHTML = `
    <section class="um-panel" role="dialog" aria-modal="true" aria-hidden="true" aria-label="UniMate Browser Companion" tabindex="-1">
      <header class="um-header">
        <div class="um-brand"><div class="um-mark">✦</div><div><div class="um-title">UniMate</div><div class="um-subtitle">Browser Companion</div></div></div>
        <button class="um-icon-button um-close" type="button" aria-label="Close companion">×</button>
      </header>
      <div class="um-body"><div class="um-auth"><p>Loading your UniMate session…</p></div></div>
    </section>
    <button class="um-mascot" type="button" aria-label="Open UniMate Browser Companion" title="Ask UniMate about this page" aria-expanded="false">
      ${
        extensionRuntime()
          ? `<img alt="" src="${extensionRuntime().getURL("assets/mascot.png")}" />`
          : `<span aria-hidden="true" style="font-size:24px">✦</span>`
      }
    </button>
  `;
  shadow.append(style, root);

  const panel = root.querySelector(".um-panel");
  const mascot = root.querySelector(".um-mascot");
  const body = root.querySelector(".um-body");
  panel.inert = true;

  const nextPaint = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function prepareForCapture() {
    if (!document.documentElement.contains(host)) {
      throw new Error("The UniMate interface is not mounted.");
    }
    if (!state.captureHidden) {
      state.captureStyle = {
        display: host.style.getPropertyValue("display"),
        displayPriority: host.style.getPropertyPriority("display"),
        pointerEvents: host.style.getPropertyValue("pointer-events"),
        pointerEventsPriority: host.style.getPropertyPriority("pointer-events"),
      };
      host.style.setProperty("pointer-events", "none", "important");
      host.style.setProperty("display", "none", "important");
      state.captureHidden = true;
    }
    try {
      await nextPaint();
      if (getComputedStyle(host).display !== "none") {
        throw new Error("The UniMate interface could not be hidden safely.");
      }
      return { hidden: true };
    } catch (error) {
      restoreAfterCapture();
      throw error;
    }
  }

  function restoreAfterCapture() {
    if (!state.captureHidden) return { restored: true };
    const previous = state.captureStyle || {};
    if (previous.display) {
      host.style.setProperty("display", previous.display, previous.displayPriority || "");
    } else {
      host.style.removeProperty("display");
    }
    if (previous.pointerEvents) {
      host.style.setProperty(
        "pointer-events",
        previous.pointerEvents,
        previous.pointerEventsPriority || "",
      );
    } else {
      host.style.removeProperty("pointer-events");
    }
    state.captureHidden = false;
    state.captureStyle = null;
    return { restored: true };
  }

  function sendOnce(request) {
    return new Promise((resolve, reject) => {
      const runtime = extensionRuntime();
      if (!runtime) return reject(runtimeUnavailableError());
      try {
        runtime.sendMessage(request, (response) => {
          const messageError = runtime.lastError;
          if (messageError) return reject(new Error(messageError.message));
          if (!response?.ok) {
            const error = new Error(response?.error || "UniMate is unavailable.");
            error.code = response?.errorCode || "COMPANION_ERROR";
            error.phase = response?.errorPhase || "runtime";
            error.retryAfterMs = Number(response?.retryAfterMs || 0);
            error.backgroundResponded = true;
            return reject(error);
          }
          resolve(response.data);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function isRetryableMessagingError(error) {
    return /receiving end does not exist|message port closed|could not establish connection/i.test(
      String(error?.message || ""),
    );
  }

  async function send(request) {
    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await sendOnce(request);
        state.runtime.connected = true;
        state.runtime.lastError = "";
        state.runtime.lastErrorCode = "";
        state.runtime.lastErrorPhase = "";
        return result;
      } catch (error) {
        state.runtime.connected = Boolean(error?.backgroundResponded);
        state.runtime.lastError = error?.message || "Unknown messaging error";
        state.runtime.lastErrorCode = error?.code || "RUNTIME_MESSAGE_FAILED";
        state.runtime.lastErrorPhase = error?.phase || "messaging";
        if (!extensionRuntime()) throw runtimeUnavailableError();
        if (attempt === attempts - 1 || !isRetryableMessagingError(error)) throw error;
        state.runtime.reconnectAttempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 175));
      }
    }
    throw new Error("UniMate messaging is unavailable.");
  }

  function toggle(force) {
    const nextOpen = typeof force === "boolean" ? force : !state.open;
    if (nextOpen === state.open) return;
    if (nextOpen) state.previouslyFocused = document.activeElement;
    state.open = nextOpen;
    panel.classList.toggle("open", state.open);
    panel.inert = !state.open;
    panel.setAttribute("aria-hidden", String(!state.open));
    mascot.setAttribute("aria-expanded", String(state.open));
    if (state.open) {
      if (!state.auth) initialize();
      else if (state.auth.authenticated && state.auth.isPro && !state.busy) {
        void refreshMessagesOnOpen();
      }
      queueMicrotask(focusInitialControl);
    } else {
      const previous = state.previouslyFocused;
      state.previouslyFocused = null;
      if (previous instanceof HTMLElement && previous.isConnected && previous !== host) {
        previous.focus({ preventScroll: true });
        if (document.activeElement !== previous) mascot.focus({ preventScroll: true });
      } else {
        mascot.focus({ preventScroll: true });
      }
    }
  }

  async function refreshMessagesOnOpen() {
    try {
      const chatState = await send({ type: "LOAD_CHAT_STATE" });
      if (!state.open || state.busy) return;
      state.messages = chatState.messages;
      state.activeConversationId = chatState.conversationId;
      state.activeConversationTitle = chatState.conversationTitle;
      // Shared history is visible for continuity, but it is not treated as
      // evidence about the current webpage in the next screenshot request.
      state.conversationStartIndex = chatState.messages.length;
      renderChat();
    } catch (error) {
      if (state.open && !state.busy) {
        renderChat(error?.message || "Shared chat history could not be refreshed.", true);
      }
    }
  }

  function handleBrowserChatChanged() {
    if (state.open && !state.busy && state.auth?.isPro) {
      void refreshMessagesOnOpen();
    }
  }

  function focusableControls() {
    return [
      ...panel.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.closest(".um-hidden"));
  }

  function focusInitialControl() {
    if (!state.open) return;
    const preferred = panel.querySelector(".um-input, .um-email");
    (preferred || focusableControls()[0] || panel).focus({ preventScroll: true });
  }

  function trapPanelKeyboard(event) {
    if (!state.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      toggle(false);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusableControls();
    if (!controls.length) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = shadow.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function containWheel(event) {
    if (!state.open || !panel.contains(event.target)) return;
    let current = event.target instanceof Element ? event.target : null;
    let scrollable = null;
    while (current && current !== panel) {
      const styles = getComputedStyle(current);
      if (/(auto|scroll)/.test(styles.overflowY) && current.scrollHeight > current.clientHeight) {
        scrollable = current;
        break;
      }
      current = current.parentElement;
    }
    if (!scrollable) {
      event.preventDefault();
      return;
    }
    const atTop = scrollable.scrollTop <= 0;
    const atBottom =
      Math.ceil(scrollable.scrollTop + scrollable.clientHeight) >= scrollable.scrollHeight;
    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatAssistantMessage(value) {
    return escapeHtml(value)
      .replaceAll("\\times", "×")
      .replaceAll("\\div", "÷")
      .replaceAll("\\cdot", "·")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\$([^$\n]+)\$/g, "$1")
      .replace(/\n{3,}/g, "\n\n");
  }

  function studentFacingError(error, captureAttempted = false) {
    const raw = String(error?.message || "");
    if (error?.code === "AUTH_REQUIRED" || error?.phase === "auth") {
      return "Your UniMate session has ended. Sign in again to continue.";
    }
    if (error?.code === "PRO_REQUIRED") {
      return "Browser Companion requires an active UniMate Pro profile.";
    }
    if (error?.phase === "entitlement") {
      return "UniMate couldn't verify your Pro access. Please try again in a moment.";
    }
    if (/429|rate limit|too many requests/i.test(raw)) {
      return "UniMate is a little busy right now. Wait a moment, then try again.";
    }
    if (/updated or reloaded|receiving end|message port|could not establish/i.test(raw)) {
      return "UniMate needs to reconnect to this page. Refresh once, then try again.";
    }
    if (/chrome:|web store|cannot access contents|permission/i.test(raw)) {
      return captureAttempted
        ? "Chrome won't allow screen access on this page. Try UniMate on a regular website."
        : "Chrome restricts access to this page.";
    }
    if (/capture|active tab|screenshot/i.test(raw)) {
      return "I couldn't capture the visible page. Keep this tab active and try again.";
    }
    if (/network|fetch|offline|reach/i.test(raw)) {
      return "I couldn't reach UniMate. Check your connection and try again.";
    }
    return "I couldn't finish that response. Please try again in a moment.";
  }

  function extractContext() {
    if (!globalThis.UniMateContextExtractor) {
      return {
        highlightedText: "",
        nearbyText: "",
        visiblePageText: "",
        pageTitle: document.title || "",
        pageUrl: location.href,
        pageDomain: location.hostname,
        metrics: { textLength: 0, blockedFrameCount: 0, visualElementCount: 0 },
      };
    }
    return globalThis.UniMateContextExtractor.extractRenderedContext();
  }

  function renderAuth(error = "") {
    const configured = state.auth?.configured !== false;
    body.innerHTML = `
      <div class="um-auth">
        <div class="um-mark" style="margin:0 auto 16px">✦</div>
        <h2>${configured ? "Welcome back" : "Setup needed"}</h2>
        <p>${configured ? "Sign in with your existing UniMate account. No new account is created." : "Run npm run companion:configure, then reload this extension."}</p>
        ${error ? `<div class="um-status error" role="alert">${escapeHtml(error)}</div>` : ""}
        ${
          configured
            ? `
          <form class="um-login">
            <input class="um-field um-email" type="email" autocomplete="username" placeholder="UniMate email" required />
            <input class="um-field um-password" type="password" autocomplete="current-password" placeholder="Password" required />
            <button class="um-primary" type="submit">Sign in to UniMate</button>
          </form>`
            : ""
        }
      </div>`;
    body.querySelector(".um-login")?.addEventListener("submit", handleSignIn);
    queueMicrotask(focusInitialControl);
  }

  function renderPrivacyConsent(error = "") {
    body.innerHTML = `
      <div class="um-auth">
        <div class="um-mark" style="margin:0 auto 16px">✦</div>
        <h2>Use this page to help you</h2>
        <p>UniMate needs your permission before it can use what is visible in your browser.</p>
        <div class="um-disclosure">
          <strong>When you press Send</strong>
          UniMate sends a one-time image of the visible tab, your prompt, the page title and URL, highlighted text, and a short visible-text sample to UniMate and its AI provider to answer you. It does not record continuously. Your chat messages are saved to your UniMate account.
        </div>
        ${error ? `<div class="um-status error" role="alert">${escapeHtml(error)}</div>` : ""}
        <button class="um-primary um-consent-accept" type="button">Allow and continue</button>
        <button class="um-secondary um-consent-decline" type="button">Not now</button>
      </div>`;
    body.querySelector(".um-consent-accept").addEventListener("click", handlePrivacyConsent);
    body.querySelector(".um-consent-decline").addEventListener("click", () => toggle(false));
    queueMicrotask(focusInitialControl);
  }

  async function handlePrivacyConsent() {
    const button = body.querySelector(".um-consent-accept");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      state.privacyConsent = await send({ type: "SET_PRIVACY_CONSENT", accepted: true });
      await initialize();
    } catch (error) {
      renderPrivacyConsent(error?.message || "Your choice could not be saved. Please try again.");
    }
  }

  function renderNotPro() {
    body.innerHTML = `
      <div class="um-auth">
        <div class="um-mark" style="margin:0 auto 16px">✦</div>
        <h2>Meet UniMate Pro</h2>
        <p>Browser Companion is included with UniMate Pro. Upgrade in UniMate, then reopen this panel to keep studying here.</p>
        <button class="um-link um-signout" type="button">Sign out</button>
      </div>`;
    body.querySelector(".um-signout").addEventListener("click", handleSignOut);
    queueMicrotask(focusInitialControl);
  }

  function renderChat(status = "", isError = false) {
    const context = extractContext();
    const messages = state.messages.length
      ? state.messages
          .map(
            (item) =>
              `<div class="um-message ${item.role}">${
                item.role === "assistant"
                  ? formatAssistantMessage(item.message)
                  : escapeHtml(item.message)
              }</div>`,
          )
          .join("")
      : `<div class="um-empty"><strong>Ready when you are.</strong>Ask a question, get unstuck, and keep moving${context.highlightedText ? " — I’ll start with your highlighted text" : ""}.</div>`;
    body.innerHTML = `
      ${status ? `<div class="um-status ${isError ? "error" : ""}" ${isError ? 'role="alert"' : 'role="status"'}>${escapeHtml(status)}</div>` : ""}
      <div class="um-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-busy="${state.busy}">${messages}${state.busy ? '<div class="um-thinking" role="status" aria-label="UniMate is thinking"><i></i><i></i><i></i></div>' : ""}</div>
      <div class="um-composer">
        <div class="um-context-row">
          <span class="um-context">${escapeHtml(state.activeConversationTitle)}</span>
          <span class="um-context">Synced with Ask UniMate</span>
        </div>
        <form class="um-form">
          <textarea class="um-input" rows="1" maxlength="4000" placeholder="Ask about what you see…" aria-label="Ask UniMate about this page" aria-describedby="um-composer-hint"></textarea>
          <button class="um-send" type="submit" aria-label="Send" ${state.busy ? "disabled" : ""}>↑</button>
        </form>
        <span id="um-composer-hint" class="um-hidden">Press Enter to send. Press Shift and Enter for a new line.</span>
      </div>`;
    const messagesNode = body.querySelector(".um-messages");
    messagesNode.scrollTop = messagesNode.scrollHeight;
    const input = body.querySelector(".um-input");
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        body.querySelector(".um-form").requestSubmit();
      }
    });
    body.querySelector(".um-form").addEventListener("submit", handleChat);
    if (!state.busy) queueMicrotask(focusInitialControl);
  }

  async function handleSignIn(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      state.auth = await send({
        type: "SIGN_IN",
        email: event.currentTarget.querySelector(".um-email").value.trim(),
        password: event.currentTarget.querySelector(".um-password").value,
      });
      if (!state.auth.isPro) return renderNotPro();
      const chatState = await send({ type: "LOAD_CHAT_STATE" });
      state.messages = chatState.messages;
      state.activeConversationId = chatState.conversationId;
      state.activeConversationTitle = chatState.conversationTitle;
      state.conversationStartIndex = state.messages.length;
      renderChat();
    } catch (error) {
      renderAuth(error.message);
    }
  }

  async function handleSignOut() {
    await send({ type: "SIGN_OUT" }).catch(() => undefined);
    state.auth = { configured: true, authenticated: false, isPro: false };
    state.messages = [];
    state.activeConversationId = null;
    state.activeConversationTitle = "Browser Companion";
    state.conversationStartIndex = 0;
    renderAuth();
  }

  async function handleWebsiteSignOut() {
    // This page event deliberately carries no session or user data. Host-page
    // code can only request the safe, destructive action of clearing this
    // extension installation's current session.
    await handleSignOut();
  }

  function syncWebsiteAuthState() {
    if (document.documentElement.dataset.unimateAuthState === "signed-out") {
      void handleWebsiteSignOut();
    }
  }

  async function handleChat(event) {
    event.preventDefault();
    if (state.busy) return;
    const input = event.currentTarget.querySelector(".um-input");
    const message = input.value.trim();
    if (!message) return;
    await submitChat(message, false);
  }

  async function submitChat(message) {
    // V2 is screenshot-first: every explicit Send captures exactly what the
    // student sees. DOM context stays small and supplemental.
    const extractedContext = extractContext();
    const context =
      globalThis.UniMateContextExtractor?.buildFocusedContextPacket(extractedContext, message) ||
      extractedContext;
    const decision = { useScreenshot: true, reason: "screenshot-first", confidence: 1 };
    state.diagnostics = {
      activeTabUrl: context.pageUrl,
      selectedText: String(context.highlightedText || "").slice(0, 300),
      contextCharacterCount: context.visiblePageText?.length || 0,
      screenshotFallbackStatus: "pending",
    };
    // Persisted chat rows remain visible, but only turns created in this page
    // session are sent back to the model. This prevents claims from another
    // site or an earlier Canvas page becoming evidence in a new conversation.
    const previousHistory = state.messages.slice(state.conversationStartIndex);
    const requestId = crypto.randomUUID();
    state.messages.push({ role: "user", message, created_at: new Date().toISOString() });
    state.busy = true;
    renderChat();
    try {
      const result = await send({
        type: "SEND_CHAT",
        requestId,
        message,
        context,
        useScreenshot: decision.useScreenshot,
        screenshotReason: decision.reason,
        contextConfidence: decision.confidence,
        history: previousHistory,
      });
      state.messages[state.messages.length - 1] = result.user;
      state.messages.push(result.assistant);
      if (result.diagnostics) {
        state.diagnostics = { ...state.diagnostics, ...result.diagnostics };
      }
      state.busy = false;
      renderChat(result.persistenceWarning || undefined);
    } catch (error) {
      const failureDetails = {
        message: error?.message || "Unknown error",
        code: error?.code || "COMPANION_ERROR",
        phase: error?.phase || "runtime",
      };
      try {
        // The background persists the user row before calling AI. Re-read the
        // database after failures so the UI matches the durable history.
        state.messages = await send({ type: "LOAD_MESSAGES" });
      } catch {
        // Preserve the optimistic message if history itself is unavailable.
      }
      state.runtime.lastError = failureDetails.message;
      state.runtime.lastErrorCode = failureDetails.code;
      state.runtime.lastErrorPhase = failureDetails.phase;
      const isCaptureFailure =
        error?.phase === "capture" ||
        /capture|cannot access contents|active tab|permission|chrome:|web store/i.test(
          error.message,
        );
      const messageText = studentFacingError(error, decision.useScreenshot && isCaptureFailure);
      if (state.diagnostics && decision.useScreenshot) {
        state.diagnostics.screenshotFallbackStatus = `unavailable (${decision.reason})`;
      }
      state.busy = false;
      renderChat(messageText, true);
    } finally {
      state.busy = false;
      const sendButton = body.querySelector(".um-send");
      if (sendButton) sendButton.disabled = false;
    }
  }

  async function initialize() {
    try {
      state.privacyConsent = await send({ type: "PRIVACY_CONSENT_STATE" });
      if (!state.privacyConsent.accepted) return renderPrivacyConsent();
      state.auth = await send({ type: "AUTH_STATE" });
      state.runtime.serviceWorker = await send({ type: "RUNTIME_DIAGNOSTICS" }).catch(() => null);
      if (!state.auth.authenticated) return renderAuth();
      if (!state.auth.isPro) return renderNotPro();
      const chatState = await send({ type: "LOAD_CHAT_STATE" });
      state.messages = chatState.messages;
      state.activeConversationId = chatState.conversationId;
      state.activeConversationTitle = chatState.conversationTitle;
      state.conversationStartIndex = state.messages.length;
      renderChat();
    } catch (error) {
      state.auth = { configured: true, authenticated: false, isPro: false };
      renderAuth(error.message);
    }
  }

  mascot.addEventListener("click", () => toggle());
  root.querySelector(".um-close").addEventListener("click", () => toggle(false));

  // Let controls handle events normally, then stop those events at the closed
  // shadow boundary so host-page shortcuts and delegated handlers cannot react.
  shadow.addEventListener("keydown", trapPanelKeyboard);
  shadow.addEventListener("wheel", containWheel, { passive: false });
  for (const eventName of [
    "auxclick",
    "beforeinput",
    "change",
    "click",
    "compositionend",
    "compositionstart",
    "compositionupdate",
    "contextmenu",
    "copy",
    "cut",
    "dblclick",
    "dragend",
    "dragenter",
    "dragleave",
    "dragover",
    "dragstart",
    "drop",
    "focusin",
    "focusout",
    "input",
    "keydown",
    "keypress",
    "keyup",
    "mousedown",
    "mouseup",
    "paste",
    "pointercancel",
    "pointerdown",
    "pointerup",
    "submit",
    "touchend",
    "touchmove",
    "touchstart",
    "wheel",
  ]) {
    shadow.addEventListener(eventName, (event) => event.stopImmediatePropagation());
  }

  const initialRuntime = extensionRuntime();
  const runtimeMessageListener = (request, _sender, sendResponse) => {
    if (request?.type === "TOGGLE_COMPANION") {
      toggle();
      return undefined;
    }
    if (request?.type === "COMPANION_PING") {
      sendResponse?.({ ok: true, nonce: request.nonce });
      return undefined;
    }
    if (request?.type === "PREPARE_COMPANION_CAPTURE") {
      prepareForCapture()
        .then((result) => sendResponse?.({ ok: true, ...result }))
        .catch((error) => sendResponse?.({ ok: false, error: error?.message || "Hide failed." }));
      return true;
    }
    if (request?.type === "RESTORE_COMPANION_CAPTURE") {
      sendResponse?.({ ok: true, ...restoreAfterCapture() });
      return undefined;
    }
    if (request?.type === "DISPOSE_COMPANION_INSTANCE") {
      sendResponse?.({ ok: true });
      queueMicrotask(dispose);
    }
    return undefined;
  };
  if (initialRuntime) {
    initialRuntime.onMessage.addListener(runtimeMessageListener);
  }

  function mount() {
    if (!document.documentElement.contains(host)) document.documentElement.appendChild(host);
  }
  mount();
  const mountObserver = new MutationObserver(() => {
    if (!document.documentElement.contains(host)) mount();
  });
  mountObserver.observe(document.documentElement, { childList: true });
  addEventListener("pageshow", mount);
  document.addEventListener("unimate-auth-signed-out", handleWebsiteSignOut);
  document.addEventListener("unimate-browser-chat-changed", handleBrowserChatChanged);
  const websiteAuthObserver = new MutationObserver(syncWebsiteAuthState);
  websiteAuthObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-unimate-auth-state"],
  });
  syncWebsiteAuthState();

  function refreshVisibleCompanion() {
    if (document.visibilityState === "visible" && state.open && !state.busy && state.auth?.isPro) {
      void refreshMessagesOnOpen();
    }
  }
  addEventListener("focus", refreshVisibleCompanion);
  addEventListener("visibilitychange", refreshVisibleCompanion);

  let currentPageUrl = location.href;
  function updatePageBoundary() {
    if (location.href === currentPageUrl) return;
    currentPageUrl = location.href;
    state.conversationStartIndex = state.messages.length;
    state.diagnostics = null;
    if (state.open && !state.busy) renderChat();
  }
  const urlObserver = new MutationObserver(updatePageBoundary);
  urlObserver.observe(document.documentElement, { childList: true, subtree: true });
  const urlPoll = setInterval(updatePageBoundary, 500);
  addEventListener("popstate", updatePageBoundary);
  addEventListener("hashchange", updatePageBoundary);
  addEventListener("pageshow", updatePageBoundary);

  function dispose() {
    restoreAfterCapture();
    mountObserver.disconnect();
    urlObserver.disconnect();
    clearInterval(urlPoll);
    removeEventListener("pageshow", mount);
    document.removeEventListener("unimate-auth-signed-out", handleWebsiteSignOut);
    document.removeEventListener("unimate-browser-chat-changed", handleBrowserChatChanged);
    websiteAuthObserver.disconnect();
    removeEventListener("focus", refreshVisibleCompanion);
    removeEventListener("visibilitychange", refreshVisibleCompanion);
    removeEventListener("popstate", updatePageBoundary);
    removeEventListener("hashchange", updatePageBoundary);
    removeEventListener("pageshow", updatePageBoundary);
    try {
      initialRuntime?.onMessage?.removeListener?.(runtimeMessageListener);
    } catch {
      // A stale extension context can reject runtime API access during cleanup.
    }
    host.remove();
    if (globalThis.__unimateCompanionPrivateDispose === dispose) {
      delete globalThis.__unimateCompanionPrivateDispose;
    }
  }
  globalThis.__unimateCompanionPrivateDispose = dispose;
})();
