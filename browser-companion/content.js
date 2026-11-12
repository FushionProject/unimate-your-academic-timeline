(() => {
  if (window.top !== window) return;
  // Capture the generation once. Duplicate declarative/recovery injections
  // must decide synchronously in this isolated world, not from an earlier
  // background PING whose answer can race a newly mounted instance.
  const extensionVersion = extensionRuntime()?.getManifest?.().version || "";
  // This binding exists only in Chrome's extension isolated world; host-page
  // JavaScript cannot read or invoke it. It allows a newly injected generation
  // to synchronously stop an older instance without a forgeable DOM event.
  try {
    const previous = globalThis.__unimateCompanionPrivateDispose;
    if (
      previous?.protocolVersion === 2 &&
      previous.extensionVersion === extensionVersion &&
      previous.isActive?.()
    )
      return;
    previous?.();
  } catch {
    // An invalidated older extension world may already be inert.
  }
  document.getElementById("unimate-companion-host")?.remove();
  let disposed = false;

  const state = {
    open: false,
    view: "loading",
    renderedConversationId: null,
    readingPosition: null,
    auth: null,
    privacyConsent: null,
    messages: [],
    activeConversationId: null,
    activeConversationTitle: "Browser Companion",
    conversationStartIndex: 0,
    pageHistory: [],
    draft: "",
    failedQuestion: null,
    unresolvedRequest: null,
    pendingSave: null,
    workspaceItem: null,
    workspaceUnavailable: false,
    workspaceNextOffset: null,
    workspaceItems: [],
    workspaceCourses: [],
    workspaceDraft: null,
    workspaceResume: null,
    workspaceBusy: false,
    workspaceLoadVersion: 0,
    contextMode: null,
    busy: false,
    sessionVersion: 0,
    historyLoadVersion: 0,
    pageHistoryUrl: location.href,
    captureHidden: false,
    captureStyle: null,
    captureFocus: null,
    captureLease: null,
    captureTimer: null,
    initialFocusPending: false,
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
    :host { all: initial; --um-font: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    .um-root { position: fixed; z-index: 2147483647; right: 0; top: 0; bottom: 0; width: 0; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #24211d; }
    .um-mascot { position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 62px; height: 76px; padding: 0; border: 0; border-radius: 24px 0 0 24px; background: #F5C518; box-shadow: 0 10px 32px rgba(37, 31, 20, .2); cursor: pointer; display: grid; place-items: center; transition: width .18s ease, filter .18s ease; }
    .um-mascot:hover { width: 68px; filter: brightness(1.03); }
    .um-mascot:focus-visible, .um-icon-button:focus-visible, .um-screen:focus-visible, .um-send:focus-visible, .um-primary:focus-visible, .um-secondary:focus-visible, .um-link:focus-visible { outline: 3px solid rgba(36,33,29,.72); outline-offset: 3px; }
    .um-mascot img { width: 48px; height: 64px; object-fit: contain; pointer-events: none; }
    .um-panel { position: absolute; right: 76px; top: 50%; transform: translateY(-50%) translateX(18px); width: min(380px, calc(100vw - 96px)); height: min(620px, calc(100vh - 32px)); border: 1px solid rgba(36,33,29,.1); border-radius: 24px; background: #FAF7F2; box-shadow: 0 24px 70px rgba(37,31,20,.22); overflow: hidden; overscroll-behavior: contain; display: flex; flex-direction: column; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s; }
    .um-panel.open { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(-50%) translateX(0); transition-delay: 0s; }
    .um-header { min-height: 70px; padding: 16px 18px; border-bottom: 1px solid rgba(36,33,29,.08); display: flex; align-items: center; justify-content: space-between; background: rgba(250,247,242,.95); }
    .um-brand { display: flex; align-items: center; gap: 11px; }
    .um-mark { width: 37px; height: 37px; border-radius: 13px; background: #F5C518; display: grid; place-items: center; font-size: 19px; }
    .um-title { font: 700 15px/1.15 var(--um-font); }
    .um-subtitle { margin-top: 3px; color: #746e66; font: 500 11px/1.2 var(--um-font); }
    .um-icon-button { border: 0; background: transparent; color: #746e66; cursor: pointer; padding: 7px; border-radius: 10px; font: 600 18px/1 var(--um-font); }
    .um-icon-button:hover { background: rgba(36,33,29,.06); color: #24211d; }
    .um-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
    .um-status { margin: 14px 16px 0; padding: 9px 11px; border-radius: 12px; background: #fff9dc; color: #675512; font: 600 11px/1.35 var(--um-font); }
    .um-status.error { background: #fff0ed; color: #9a3429; }
    .um-recovery-question { max-height: 96px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
    .um-messages { flex: 1; min-height: 80px; overflow-y: auto; overscroll-behavior: contain; padding: 17px 16px 8px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: rgba(36,33,29,.2) transparent; }
    .um-empty { margin: auto 22px; text-align: center; color: #746e66; font: 500 13px/1.55 var(--um-font); }
    .um-empty strong { display: block; color: #24211d; font-size: 17px; margin-bottom: 7px; }
    .um-message { max-width: 86%; border-radius: 16px; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; font: 500 13px/1.48 var(--um-font); }
    .um-message.user { align-self: flex-end; background: #F5C518; color: #2c2508; border-bottom-right-radius: 5px; }
    .um-message.assistant { align-self: flex-start; background: #fff; border: 1px solid rgba(36,33,29,.08); border-bottom-left-radius: 5px; }
    .um-thinking { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; min-height: 38px; padding: 11px 13px; border: 1px solid rgba(36,33,29,.08); border-radius: 16px 16px 16px 5px; background: #fff; color: #827b72; }
    .um-thinking i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: um-pulse 1.1s ease-in-out infinite; }
    .um-thinking i:nth-child(2) { animation-delay: .14s; }
    .um-thinking i:nth-child(3) { animation-delay: .28s; }
    @keyframes um-pulse { 0%, 70%, 100% { opacity: .28; transform: translateY(0); } 35% { opacity: .9; transform: translateY(-2px); } }
    .um-composer { padding: 12px; border-top: 1px solid rgba(36,33,29,.08); background: #FAF7F2; }
    .um-context-row { margin: 0 4px 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .um-context { min-width: 0; color: #746e66; font: 500 10px/1.3 var(--um-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .um-screen { flex: 0 0 auto; border: 0; padding: 3px 0; background: transparent; color: #675512; cursor: pointer; font: 650 10px/1.2 var(--um-font); }
    .um-screen:disabled { opacity: .45; cursor: default; }
    .um-form { display: flex; align-items: flex-end; gap: 8px; padding: 7px 7px 7px 12px; border: 1px solid rgba(36,33,29,.14); border-radius: 17px; background: #fff; }
    .um-form:focus-within { border-color: #b39117; box-shadow: 0 0 0 3px rgba(245,197,24,.15); }
    .um-input { overscroll-behavior: contain; flex: 1; min-width: 0; resize: none; border: 0; outline: 0; min-height: 30px; max-height: 112px; padding: 7px 0; background: transparent; color: #24211d; font: 500 13px/1.4 var(--um-font); }
    .um-send { flex: 0 0 auto; width: 38px; height: 38px; border: 0; border-radius: 13px; background: #F5C518; color: #2c2508; cursor: pointer; font: 800 17px/1 var(--um-font); }
    .um-send:disabled { opacity: .45; cursor: default; }
    .um-auth { margin: auto; width: 100%; padding: 28px; text-align: center; overflow-y: auto; overscroll-behavior: contain; }
    .um-auth h2 { margin: 0 0 8px; font: 750 20px/1.2 var(--um-font); }
    .um-auth p { margin: 0 0 20px; color: #746e66; font: 500 13px/1.5 var(--um-font); }
    .um-disclosure { margin: 16px 0 4px; padding: 14px; border: 1px solid rgba(36,33,29,.1); border-radius: 14px; background: #fff; color: #5f5951; text-align: left; font: 500 12px/1.5 var(--um-font); }
    .um-disclosure strong { display: block; margin-bottom: 5px; color: #24211d; font-size: 12px; }
    .um-secondary { width: 100%; margin-top: 8px; padding: 11px; border: 1px solid rgba(36,33,29,.14); border-radius: 13px; background: transparent; color: #5f5951; cursor: pointer; font: 700 12px/1 var(--um-font); }
    .um-primary { width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 13px; background: #F5C518; color: #2c2508; cursor: pointer; font: 750 13px/1 var(--um-font); }
    .um-primary:disabled { opacity: .5; }
    .um-actions { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 9px; }
    .um-chip { border:1px solid rgba(36,33,29,.14); border-radius:10px; padding:7px 9px; background:#fff; color:#5f5951; cursor:pointer; font:650 11px/1.3 var(--um-font); }
    .um-chip:disabled { opacity:.45; cursor:default; }
    .um-chip:focus-visible, .um-field:focus-visible { outline:3px solid rgba(36,33,29,.72); outline-offset:2px; }
    .um-resume { margin:12px 16px 0; padding:10px 12px; border:1px solid #e4dcbf; border-radius:12px; background:#fff9e5; font:500 12px/1.4 var(--um-font); overflow-wrap:anywhere; }
    .um-resume strong { display:block; margin-bottom:3px; }
    .um-workspace { padding:18px; overflow-y:auto; font:500 12px/1.5 var(--um-font); }
    .um-workspace h2 { margin:10px 0 6px; font:750 19px/1.3 var(--um-font); }
    .um-workspace p { color:#746e66; margin:6px 0 14px; }
    .um-workspace label { display:block; margin:13px 0 5px; font-weight:650; }
    .um-field { display:block; width:100%; border:1px solid rgba(36,33,29,.2); border-radius:10px; padding:9px; background:#fff; color:#24211d; font:500 12px/1.5 var(--um-font); }
    textarea.um-field { min-height:72px; resize:vertical; }
    .um-workspace-list { display:flex; flex-direction:column; gap:8px; padding:0; list-style:none; }
    .um-workspace-list .um-secondary { text-align:left; line-height:1.5; margin:0; }
    .um-link { border: 0; background: transparent; margin-top: 14px; color: #746e66; text-decoration: underline; cursor: pointer; font: 600 11px/1 var(--um-font); }
    .um-hidden { display: none !important; }
    .um-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    @media (max-width: 520px) { .um-root { top: 0; bottom: 0; } .um-panel, .um-panel.open { position: fixed; inset: 12px 68px 12px 12px; width: auto; height: auto; transform: none; transition: none; border-radius: 20px; } .um-mascot { top: auto; bottom: 16px; transform: none; width: 54px; height: 68px; } }
    @media (max-height: 540px) { .um-input { max-height: 64px; } }
    @media (prefers-reduced-motion: reduce) { .um-mascot, .um-panel { transition: none; } .um-thinking i { animation: none; opacity: .55; } }
  `;

  const root = document.createElement("div");
  root.className = "um-root";
  root.innerHTML = `
    <section class="um-panel" role="dialog" aria-hidden="true" aria-label="UniMate Browser Companion" tabindex="-1">
      <header class="um-header">
        <div class="um-brand"><div class="um-mark">✦</div><div><div class="um-title">UniMate</div><div class="um-subtitle">Browser Companion</div></div></div>
        <button class="um-icon-button um-close" type="button" aria-label="Close companion">×</button>
      </header>
      <div class="um-body"><div class="um-auth"><p>Loading your UniMate session…</p></div></div>
      <div class="um-announcer um-sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="um-alert-announcer um-sr-only" role="alert" aria-atomic="true"></div>
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
  const announcer = root.querySelector(".um-announcer");
  const alertAnnouncer = root.querySelector(".um-alert-announcer");
  panel.inert = true;

  const nextPaint = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  function canRestorePanelFocus() {
    const active = document.activeElement;
    return active === host || active === document.body || active === document.documentElement;
  }

  function handleCaptureFocusChange(event) {
    if (
      event.target !== host &&
      event.target !== document.body &&
      event.target !== document.documentElement
    ) {
      state.captureFocus = null;
    }
  }

  async function prepareForCapture(request) {
    const captureId = request?.captureId;
    const expiresAt = request?.expiresAt;
    const now = Date.now();
    if (
      typeof captureId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(captureId) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 8000
    )
      throw new Error("The capture lease is invalid or expired.");
    if (
      state.captureLease &&
      (state.captureLease.captureId !== captureId || state.captureLease.expiresAt !== expiresAt)
    )
      throw new Error("Another capture is already in progress.");
    if (!document.documentElement.contains(host)) {
      throw new Error("The UniMate interface is not mounted.");
    }
    if (!state.captureHidden) {
      const active = shadow.activeElement;
      state.captureFocus = active
        ? {
            element: active,
            selectionStart: active.selectionStart,
            selectionEnd: active.selectionEnd,
            selectionDirection: active.selectionDirection,
          }
        : null;
      document.addEventListener("focusin", handleCaptureFocusChange, true);
      state.captureStyle = {
        display: host.style.getPropertyValue("display"),
        displayPriority: host.style.getPropertyPriority("display"),
        pointerEvents: host.style.getPropertyValue("pointer-events"),
        pointerEventsPriority: host.style.getPropertyPriority("pointer-events"),
      };
      host.style.setProperty("pointer-events", "none", "important");
      host.style.setProperty("display", "none", "important");
      state.captureHidden = true;
      state.captureLease = { captureId, expiresAt };
      state.captureTimer = setTimeout(
        () => {
          restoreAfterCapture(captureId);
        },
        expiresAt + 2000 - now,
      );
    }
    try {
      await nextPaint();
      if (state.captureLease?.captureId !== captureId || Date.now() >= expiresAt) {
        throw new Error("The capture lease expired before the interface was ready.");
      }
      if (getComputedStyle(host).display !== "none") {
        throw new Error("The UniMate interface could not be hidden safely.");
      }
      return { hidden: true, captureId };
    } catch (error) {
      restoreAfterCapture(captureId);
      throw error;
    }
  }

  function restoreAfterCapture(captureId, force = false) {
    if (!force && (!captureId || captureId !== state.captureLease?.captureId)) {
      return { restored: false };
    }
    clearTimeout(state.captureTimer);
    state.captureTimer = null;
    state.captureLease = null;
    if (!state.captureHidden) return { restored: true };
    document.removeEventListener("focusin", handleCaptureFocusChange, true);
    const focus = state.captureFocus;
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
    state.captureFocus = null;
    if (
      focus?.element.isConnected &&
      (state.open || focus.element === mascot) &&
      canRestorePanelFocus()
    ) {
      focus.element.focus({ preventScroll: true });
      if (typeof focus.selectionStart === "number") {
        focus.element.setSelectionRange(
          focus.selectionStart,
          focus.selectionEnd,
          focus.selectionDirection,
        );
      }
    }
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
            error.retryable = response?.retryable;
            error.backgroundResponded = typeof response?.ok === "boolean";
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
    if (error?.retryable === false) return false;
    return /receiving end does not exist|message port closed|could not establish connection/i.test(
      String(error?.message || ""),
    );
  }

  async function send(request) {
    if (
      [
        "LOAD_CHAT_STATE",
        "LOAD_STUDY_WORKSPACE",
        "SAVE_STUDY_ITEM",
        "SELECT_STUDY_CONVERSATION",
        "OPEN_STUDY_WORKSPACE",
        "SEND_CHAT",
      ].includes(request.type)
    ) {
      request = { ...request, expectedUserId: request.expectedUserId || state.auth?.userId };
    }
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
    state.initialFocusPending = nextOpen;
    panel.classList.toggle("open", state.open);
    panel.inert = !state.open;
    panel.setAttribute("aria-hidden", String(!state.open));
    mascot.setAttribute("aria-expanded", String(state.open));
    if (state.open) {
      if (!state.auth || !state.auth.isPro || !state.privacyConsent?.accepted) initialize();
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
    const sessionVersion = state.sessionVersion;
    const loadVersion = ++state.historyLoadVersion;
    try {
      if (state.pendingSave || state.failedQuestion || state.workspaceDraft) {
        // Keep unresolved work in its conversation, but still revalidate access.
        // Skipping history replacement must not also skip a revocation/sign-out.
        const auth = await send({ type: "AUTH_STATE" });
        if (
          !state.open ||
          state.busy ||
          sessionVersion !== state.sessionVersion ||
          loadVersion !== state.historyLoadVersion
        )
          return;
        const accountChanged = applyAuthState(auth);
        if (state.view === "privacy") return;
        if (!auth.authenticated) return renderAuth();
        if (!auth.isPro) return renderNotPro();
        if (accountChanged) return initialize();
        return;
      }
      const chatState = await send({ type: "LOAD_CHAT_STATE" });
      if (
        !state.open ||
        state.busy ||
        state.pendingSave ||
        state.failedQuestion ||
        sessionVersion !== state.sessionVersion ||
        loadVersion !== state.historyLoadVersion
      )
        return;
      if (state.activeConversationId !== chatState.conversationId) {
        state.pageHistory = [];
        state.draft = "";
      }
      state.messages = chatState.messages;
      state.activeConversationId = chatState.conversationId;
      state.activeConversationTitle = chatState.conversationTitle;
      state.workspaceItem = chatState.workspaceItem || null;
      state.workspaceUnavailable = Boolean(chatState.workspaceUnavailable);
      // Shared history is visible for continuity, but it is not treated as
      // evidence about the current webpage in the next screenshot request.
      state.conversationStartIndex = chatState.messages.length;
      if (state.view !== "privacy") renderChat();
    } catch (error) {
      if (
        state.open &&
        !state.busy &&
        sessionVersion === state.sessionVersion &&
        loadVersion === state.historyLoadVersion &&
        state.view !== "privacy"
      ) {
        if (handleAccessRequired(error)) return;
        renderChat(error?.message || "Shared chat history could not be refreshed.", true);
      }
    }
  }

  async function handleBrowserChatChanged() {
    if (!(state.open && !state.busy && state.auth?.isPro)) return;
    try {
      const result = await send({ type: "WEBSITE_ORIGIN_CHECK" });
      if (result?.trusted) await refreshMessagesOnOpen();
    } catch {
      // Website-to-extension signals are optional and fail closed.
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
    const preferred = panel.querySelector(".um-input, .um-signin");
    (preferred || focusableControls()[0] || panel).focus({ preventScroll: true });
  }

  function prepareRenderFocus() {
    const active = shadow.activeElement;
    const restore =
      state.open &&
      (body.contains(active) || (state.initialFocusPending && panel.contains(active)));
    state.initialFocusPending = false;
    return restore;
  }

  function restoreRenderedFocus() {
    if (canRestorePanelFocus()) focusInitialControl();
  }

  function handlePanelKeyboard(event) {
    if (!state.open) return;
    if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      event.stopPropagation();
      toggle(false);
    }
  }

  function containWheel(event) {
    if (!state.open || !panel.contains(event.target)) return;
    if (event.ctrlKey) return; // Preserve the browser's zoom gesture.
    if (!event.deltaY) {
      if (event.deltaX) event.preventDefault();
      return;
    }
    let current = event.target instanceof Element ? event.target : null;
    let passedScrollable = false;
    while (current && current !== panel) {
      const styles = getComputedStyle(current);
      if (/(auto|scroll)/.test(styles.overflowY) && current.scrollHeight > current.clientHeight) {
        const atTop = current.scrollTop <= 0;
        const atBottom =
          Math.ceil(current.scrollTop + current.clientHeight) >= current.scrollHeight;
        if (event.deltaY < 0 ? !atTop : !atBottom) {
          if (passedScrollable) {
            // A textarea or message list has reached its edge. Move the panel's
            // next scrollable parent without passing this gesture to the page.
            event.preventDefault();
            const unit =
              event.deltaMode === 1
                ? parseFloat(styles.lineHeight) || 16
                : event.deltaMode === 2
                  ? current.clientHeight
                  : 1;
            current.scrollTop += event.deltaY * unit;
          }
          return;
        }
        passedScrollable = true;
      }
      current = current.parentElement;
    }
    event.preventDefault();
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
      .replace(/\n{3,}/g, "\n\n");
  }

  function studentFacingError(error, captureAttempted = false) {
    const raw = String(error?.message || "");
    if (error?.code === "AI_RESPONSE_TRUNCATED")
      return "That answer was cut short, so I haven’t shown an incomplete explanation. Your question is kept here. Try asking for one part at a time.";
    if (
      ["AI_BILLING_UNAVAILABLE", "AI_CONFIGURATION_ERROR", "AI_NOT_CONFIGURED"].includes(
        error?.code,
      )
    ) {
      return "AI help is temporarily unavailable while UniMate restores service. Your question is kept here.";
    }
    if (error?.code === "AUTH_REQUIRED") {
      return "Your UniMate session has ended. Sign in again to continue.";
    }
    if (error?.code === "PRO_REQUIRED") {
      return "Browser Companion requires an active UniMate Pro profile.";
    }
    if (error?.phase === "entitlement") {
      return "UniMate couldn't verify your Pro access. Please try again in a moment.";
    }
    if (error?.retryable === false) {
      return "AI help is temporarily unavailable. Your question is kept here.";
    }
    if (/429|rate limit|too many requests/i.test(raw)) {
      return error?.retryAfterMs > 0
        ? `UniMate is a little busy right now. Your question is kept here; try again in about ${Math.ceil(error.retryAfterMs / 1000)} seconds.`
        : "UniMate is a little busy right now. Your question is kept here; wait a moment, then try again.";
    }
    if (error?.code === "AUTH_TIMEOUT" || error?.phase === "auth") {
      return "I couldn't verify your UniMate session just now. Your question is kept here; try again in a moment.";
    }
    if (/updated or reloaded|receiving end|message port|could not establish/i.test(raw)) {
      return "UniMate needs to reconnect to this page. Refresh once, then try again.";
    }
    if (
      [
        "CAPTURE_RESTRICTED_PAGE",
        "CAPTURE_PERMISSION_DENIED",
        "CONTENT_SCRIPT_RESTRICTED_PAGE",
      ].includes(error?.code) ||
      /(?:^|[\s"'(<])(?:chrome(?:-extension)?|edge(?:-extension)?|brave|opera|about|moz-extension|safari-web-extension):|web store|edge add-ons|opera addons|extensions gallery|cannot access contents|permission|not allowed|restricted/i.test(
        raw,
      )
    ) {
      return captureAttempted
        ? "Your browser won't allow screen access on this page. Try UniMate on a regular website."
        : "Your browser restricts access to this page.";
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
    try {
      if (globalThis.UniMateContextExtractor) {
        return globalThis.UniMateContextExtractor.extractRenderedContext();
      }
    } catch {
      // An unusual page can defeat DOM extraction; screenshot capture remains
      // available after the same consent and entitlement preflight.
    }
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

  function renderAuth(error = "") {
    const restoreFocus = prepareRenderFocus();
    state.view = "auth";
    const configured = state.auth?.configured !== false;
    body.innerHTML = `
      <div class="um-auth">
        <div class="um-mark" style="margin:0 auto 16px">✦</div>
        <h2>${configured ? "Welcome back" : "Setup needed"}</h2>
        <p>${configured ? "Open a private UniMate window to sign in with your existing account. You’ll be ready to continue here when you’re done." : "Run npm run companion:configure, then reload this extension."}</p>
        ${error ? `<div class="um-status error" role="alert">${escapeHtml(error)}</div>` : ""}
        ${
          configured
            ? `
          <button class="um-primary um-signin" type="button">Sign in securely</button>`
            : ""
        }
      </div>`;
    body.querySelector(".um-signin")?.addEventListener("click", handleOpenSignIn);
    if (restoreFocus) queueMicrotask(restoreRenderedFocus);
  }

  function renderPrivacyConsent(error = "") {
    const restoreFocus = prepareRenderFocus();
    rememberReadingPosition();
    state.view = "privacy";
    // A disclosure opened deliberately must supersede an older access/history load.
    state.historyLoadVersion += 1;
    const privacyPolicyUrl = state.privacyConsent?.privacyPolicyUrl;
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
        <button class="um-secondary um-consent-decline" type="button">${state.privacyConsent?.accepted ? "Pause page sharing" : "Not now"}</button>
        ${privacyPolicyUrl ? '<p><a class="um-privacy-policy" target="_blank" rel="noopener noreferrer">Read UniMate\'s Privacy Policy</a></p>' : "<p>Privacy Policy link unavailable. Check your Companion setup.</p>"}
      </div>`;
    // Only worker-validated configuration supplies this URL, never host-page data.
    if (privacyPolicyUrl) body.querySelector(".um-privacy-policy").href = privacyPolicyUrl;
    body.querySelector(".um-consent-accept").addEventListener("click", handlePrivacyConsent);
    body.querySelector(".um-consent-decline").addEventListener("click", async () => {
      try {
        state.privacyConsent = await send({ type: "SET_PRIVACY_CONSENT", accepted: false });
        toggle(false);
      } catch {
        renderPrivacyConsent("We couldn’t save that choice. Please try again.");
      }
    });
    if (restoreFocus) queueMicrotask(restoreRenderedFocus);
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

  function renderNotPro(error = "") {
    const restoreFocus = prepareRenderFocus();
    state.view = "upgrade";
    body.innerHTML = `
      <div class="um-auth">
        <div class="um-mark" style="margin:0 auto 16px">✦</div>
        <h2>Meet UniMate Pro</h2>
        <p>A little help, right beside your coursework. Companion unlocks after your Pro purchase is confirmed.</p>
        ${error ? `<div class="um-status error" role="alert">${escapeHtml(error)}</div>` : ""}
        <button class="um-primary um-upgrade" type="button">Explore UniMate Pro</button>
        <button class="um-secondary um-check-plan" type="button">I’ve upgraded · Check access</button>
        <button class="um-link um-signout" type="button">Sign out</button>
      </div>`;
    body.querySelector(".um-signout").addEventListener("click", handleSignOut);
    body
      .querySelector(".um-workspace-retry")
      ?.addEventListener("click", () => openStudyWorkspace("assignment"));
    body
      .querySelector(".um-upgrade")
      .addEventListener("click", () =>
        send({ type: "OPEN_UPGRADE" }).catch(() =>
          renderNotPro("We couldn’t open UniMate. Please try again."),
        ),
      );
    body.querySelector(".um-check-plan").addEventListener("click", initialize);
    if (restoreFocus) queueMicrotask(restoreRenderedFocus);
  }

  function rememberReadingPosition() {
    if (state.view !== "chat") return;
    const messages = body.querySelector(".um-messages");
    if (!messages) return;
    state.readingPosition = {
      conversationId: state.renderedConversationId,
      top: messages.scrollTop,
      atBottom: messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 4,
    };
  }

  function announce(message, isError = false) {
    // This node survives body rerenders; insert text only after it already exists.
    // History refreshes intentionally do not announce the entire conversation.
    announcer.textContent = isError ? "" : String(message || "");
    alertAnnouncer.textContent = isError ? String(message || "") : "";
  }

  function renderChat(status = "", isError = false, scrollToLatest = false) {
    if (!state.privacyConsent?.accepted) return renderPrivacyConsent();
    if (!state.auth?.authenticated) return renderAuth();
    if (!state.auth.isPro) return renderNotPro();
    rememberReadingPosition();
    const readingPosition = state.readingPosition;
    const preserveReading =
      !scrollToLatest &&
      readingPosition &&
      readingPosition.conversationId === state.activeConversationId &&
      !readingPosition.atBottom;
    state.view = "chat";
    state.renderedConversationId = state.activeConversationId;
    const restoreFocus = prepareRenderFocus();
    const previousAction = [
      ".um-privacy-settings",
      ".um-signout",
      ".um-retry-save",
      ".um-skip-save",
      ".um-retry-question",
      ".um-discard-question",
    ].find((selector) => shadow.activeElement?.matches?.(selector));
    const previousInput = body.querySelector(".um-input");
    const restoreInputFocus = previousInput && shadow.activeElement === previousInput;
    const selection = restoreInputFocus
      ? [previousInput.selectionStart, previousInput.selectionEnd]
      : null;
    const messages = state.messages.length
      ? state.messages
          .map(
            (item) =>
              `<div class="um-message ${item.role === "assistant" ? "assistant" : "user"}"><span class="um-sr-only">${item.role === "assistant" ? "UniMate" : "You"}: </span>${
                item.role === "assistant"
                  ? formatAssistantMessage(item.message)
                  : escapeHtml(item.message)
              }</div>`,
          )
          .join("")
      : `<div class="um-empty"><strong>A little help, right where you are.</strong>Understand an assignment, find a first step, or ask anything about your schoolwork. You can use Companion on its own and save to a class whenever you’re ready.</div>`;
    body.innerHTML = `
      ${status ? `<div class="um-status ${isError ? "error" : ""}">${escapeHtml(status)}</div>` : ""}
      ${state.failedQuestion ? `<div class="um-status"><strong>${state.unresolvedRequest ? "Your earlier question’s status is uncertain." : "Your earlier question is still here."}</strong> Your new draft is safe below. ${state.unresolvedRequest ? "Retry checks the same request; it does not start a separate question." : "Retry this question or discard it before sending your new draft."}<p class="um-recovery-question" tabindex="0" aria-label="Earlier question">${escapeHtml(state.failedQuestion)}</p><button class="um-secondary um-retry-question" type="button" ${state.busy ? "disabled" : ""}>Retry earlier question</button><button class="um-link um-discard-question" type="button" ${state.busy ? "disabled" : ""}>Discard earlier question</button></div>` : ""}
      ${state.pendingSave ? '<div class="um-status">This answer has not synced yet. Copy it before continuing without saving if you want to keep it.<button class="um-secondary um-retry-save" type="button">Save this answer again</button><button class="um-link um-skip-save" type="button">Continue without saving</button></div>' : ""}
      ${state.workspaceUnavailable ? '<div class="um-status">Saved assignment context couldn’t be loaded. Replies can use this page and chat only.<button class="um-link um-workspace-retry" type="button">Retry saved work</button></div>' : ""}
      ${state.workspaceItem ? `<div class="um-resume"><strong>${escapeHtml(state.workspaceItem.title)}</strong>${escapeHtml(state.workspaceItem.status === "done" ? "Marked complete. You can revisit it any time." : state.workspaceItem.nextStep || "Your assignment is saved. Choose a next step when you’re ready.")}</div>` : ""}
      <div class="um-messages" role="log" aria-live="off" aria-busy="${state.busy}">${messages}${state.busy ? '<div class="um-thinking" aria-label="UniMate is thinking"><i></i><i></i><i></i></div>' : ""}</div>
      <div class="um-composer">
        <div class="um-context-row">
          <span class="um-context">${escapeHtml(state.activeConversationTitle)}</span>
          <span class="um-context">${state.pendingSave ? "Not yet synced" : "Shared with Ask UniMate"}</span>
        </div>
        <form class="um-form">
          <textarea class="um-input" rows="1" maxlength="4000" placeholder="What would you like help with?" aria-label="Ask UniMate about this page" aria-describedby="um-composer-hint">${escapeHtml(state.draft)}</textarea>
          <button class="um-send" type="submit" aria-label="Send" ${state.busy ? "disabled" : ""}>↑</button>
        </form>
        <span id="um-composer-hint" class="um-hidden">Press Enter to send. Press Shift and Enter for a new line.</span>
        <div class="um-actions" aria-label="Ways to get help">
          <button class="um-chip um-understand" type="button" ${state.busy ? "disabled" : ""}>Understand this</button>
          <button class="um-chip um-get-started" type="button" ${state.busy ? "disabled" : ""}>Help me start</button>
          ${state.workspaceItem ? `<button class="um-chip um-continue-work" type="button" ${state.busy ? "disabled" : ""}>Pick up where I left off</button>` : ""}
        </div>
        <p class="um-context" style="white-space:normal;margin:8px 4px 0;line-height:1.5">${state.contextMode === "text-fallback" ? "Last answer used visible page text; a screenshot wasn’t available." : "Send shares one image of this tab and a short text sample. Nothing is captured while you type."}</p>
        <div class="um-actions" style="margin:10px 0 0" aria-label="Keep your work">
          <details class="um-save-menu"><summary class="um-chip">Save to UniMate</summary><div class="um-actions" style="margin:8px 0 0">
          <button class="um-chip um-save-progress" type="button" ${state.busy ? "disabled" : ""}>${state.workspaceItem ? "Update progress" : "Save assignment"}</button>
          <button class="um-chip um-save-note" type="button" ${state.busy || !state.messages.some((item) => item.role === "assistant") ? "disabled" : ""}>Save note</button>
          <button class="um-chip um-save-link" type="button" ${state.busy ? "disabled" : ""}>Save link</button>
          </div></details>
          <button class="um-chip um-saved-work" type="button" ${state.busy ? "disabled" : ""}>Saved work</button>
        </div>
        <div style="display:flex;justify-content:space-between"><button class="um-link um-privacy-settings" type="button" ${state.busy ? "disabled" : ""}>Page sharing</button><button class="um-link um-signout" type="button" ${state.busy ? "disabled" : ""}>Sign out</button></div>
      </div>`;
    const messagesNode = body.querySelector(".um-messages");
    messagesNode.scrollTop = preserveReading ? readingPosition.top : messagesNode.scrollHeight;
    if (status)
      announce(
        `${status}${isError && state.failedQuestion ? " Your earlier question and new draft are both kept here. Retry or discard the earlier question before sending your new draft." : ""}`,
        isError,
      );
    const input = body.querySelector(".um-input");
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
    input.addEventListener("input", () => {
      state.draft = input.value;
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        body.querySelector(".um-form").requestSubmit();
      }
    });
    body.querySelector(".um-form").addEventListener("submit", handleChat);
    body
      .querySelector(".um-privacy-settings")
      .addEventListener("click", () => renderPrivacyConsent());
    body.querySelector(".um-signout").addEventListener("click", handleSignOut);
    body
      .querySelector(".um-understand")
      .addEventListener("click", () => chooseStudyPrompt("understand"));
    body
      .querySelector(".um-get-started")
      .addEventListener("click", () => chooseStudyPrompt("start"));
    body
      .querySelector(".um-continue-work")
      ?.addEventListener("click", () => chooseStudyPrompt("continue"));
    body
      .querySelector(".um-save-progress")
      .addEventListener("click", () => openStudyWorkspace("assignment"));
    body.querySelector(".um-save-note").addEventListener("click", () => openStudyWorkspace("note"));
    body.querySelector(".um-save-link").addEventListener("click", () => openStudyWorkspace("link"));
    body
      .querySelector(".um-saved-work")
      .addEventListener("click", () => openStudyWorkspace("list"));
    body.querySelector(".um-retry-save")?.addEventListener("click", retrySaving);
    body.querySelector(".um-retry-question")?.addEventListener("click", () => {
      if (!state.busy && state.failedQuestion) void submitChat(state.failedQuestion, true);
    });
    body.querySelector(".um-discard-question")?.addEventListener("click", () => {
      if (state.busy) return;
      state.failedQuestion = null;
      state.unresolvedRequest = null;
      renderChat("Earlier question discarded. Your new draft is ready below.");
    });
    body.querySelector(".um-skip-save")?.addEventListener("click", () => {
      state.pendingSave = null;
      renderChat(
        "You can keep studying. The unsaved answer may disappear when this chat refreshes.",
      );
    });
    if (restoreInputFocus && state.open) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(...selection);
    } else if (restoreFocus)
      queueMicrotask(() => {
        if (!state.open || !canRestorePanelFocus()) return;
        const action = previousAction && body.querySelector(previousAction);
        if (action && !action.disabled) action.focus({ preventScroll: true });
        else focusInitialControl();
      });
  }

  function chooseStudyPrompt(intent) {
    if (state.busy) return;
    if (state.draft.trim())
      return renderChat("Your draft is kept. Send or clear it before choosing a starter.");
    const prompts = {
      understand:
        "Help me understand this assignment. Explain what I need to do, what I need to hand in, and anything unclear. Use the instructions you can see and ask me for anything missing.",
      start:
        "Help me get started on this assignment. Suggest one small first step I can work through in about 15 minutes, then guide me while I try it. Ask for any missing instructions.",
      continue:
        "Help me pick up my saved assignment. Use my saved progress and next step, check what I need now, and guide me through the next small step.",
    };
    state.draft = prompts[intent] || prompts.understand;
    renderChat(
      "Your question is ready. Review it, then Send when you’re ready to share this page.",
    );
    body.querySelector(".um-input")?.focus({ preventScroll: true });
  }

  function studyPageUrl() {
    try {
      const url = new URL(location.href);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
      url.hash = "";
      for (const name of [...url.searchParams.keys()]) {
        if (/token|secret|password|session|auth|^code$|api.?key/i.test(name))
          url.searchParams.delete(name);
      }
      return url.href;
    } catch {
      return "";
    }
  }

  async function openStudyWorkspace(kind) {
    if (state.busy || state.workspaceBusy) return;
    if (state.workspaceDraft) return renderStudyEditor();
    const sessionVersion = state.sessionVersion;
    const loadVersion = ++state.workspaceLoadVersion;
    state.workspaceBusy = true;
    state.view = "workspace";
    body.innerHTML =
      '<div class="um-workspace" role="status"><p>Opening your saved work…</p></div>';
    try {
      const workspace = await send({
        type: "LOAD_STUDY_WORKSPACE",
        filters:
          kind === "list"
            ? { kind: "assignment" }
            : { kind: "assignment", conversationId: state.activeConversationId },
      });
      if (sessionVersion !== state.sessionVersion || loadVersion !== state.workspaceLoadVersion)
        return;
      state.workspaceItems = workspace.items;
      state.workspaceCourses = workspace.courses;
      state.workspaceNextOffset = workspace.nextOffset ?? null;
      state.workspaceBusy = false;
      if (kind === "list") return renderStudyList();
      state.workspaceUnavailable = false;
      state.workspaceItem =
        workspace.items.find(
          (item) =>
            item.kind === "assignment" && item.conversationId === state.activeConversationId,
        ) || null;
      const current = kind === "assignment" ? state.workspaceItem : null;
      const answer =
        [...state.messages].reverse().find((item) => item.role === "assistant")?.message || "";
      state.workspaceDraft = current
        ? { ...current }
        : {
            id: crypto.randomUUID(),
            kind,
            title: String(
              kind === "note"
                ? state.workspaceItem?.title
                  ? `${state.workspaceItem.title} — note`
                  : "Study note"
                : document.title || "Untitled assignment",
            ).slice(0, 160),
            content: kind === "note" ? answer : "",
            // A saved answer may come from an earlier page. Do not attribute
            // that answer to whichever tab happens to be open now.
            sourceUrl: kind === "note" ? "" : studyPageUrl(),
            sourceTitle: kind === "note" ? "" : String(document.title || "").slice(0, 200),
            nextStep: "",
            progress: "",
            status: "active",
            courseId: state.workspaceItem?.courseId || null,
            conversationId: state.activeConversationId,
          };
      renderStudyEditor();
      body.querySelector("#um-work-title")?.focus({ preventScroll: true });
    } catch (error) {
      if (sessionVersion !== state.sessionVersion || loadVersion !== state.workspaceLoadVersion)
        return;
      state.workspaceBusy = false;
      if (handleAccessRequired(error)) return;
      renderChat(
        "Your saved workspace is unavailable right now. Your chat and draft are kept; try again in a moment.",
        true,
      );
    }
  }

  function renderStudyEditor(error = "") {
    const draft = state.workspaceDraft;
    if (!draft) return renderChat();
    state.view = "workspace";
    const assignment = draft.kind === "assignment";
    const label = assignment
      ? "Save your place"
      : draft.kind === "note"
        ? "Keep a study note"
        : "Keep this link";
    body.innerHTML = `<div class="um-workspace">
      <button type="button" class="um-chip um-work-back" ${state.workspaceBusy ? "disabled" : ""}>Back to chat</button>
      <h2>${label}</h2>
      <p>${assignment ? "Keep the instructions and your next step together. A class is optional." : draft.kind === "note" ? "Review and edit this answer before saving it to Notes." : "Review the address before saving it to your Bulletin Board."}</p>
      ${error ? `<div class="um-status error" role="alert">${escapeHtml(error)}</div>` : ""}
      ${draft.content.length > 12000 ? '<div class="um-status">The full text is kept here. Shorten it to 12,000 characters or fewer before saving.</div>' : ""}
      ${draft.pageTextNotice ? `<p>${escapeHtml(draft.pageTextNotice)}</p>` : ""}
      <form class="um-study-form"><fieldset style="border:0;padding:0;margin:0;min-width:0" ${state.workspaceBusy ? "disabled" : ""}>
        <label for="um-work-title">Title</label><input id="um-work-title" class="um-field" name="title" maxlength="160" required value="${escapeHtml(draft.title)}" />
        <label for="um-work-course">Class (optional)</label><select id="um-work-course" class="um-field" name="courseId"><option value="">No class — keep it in my workspace</option>${state.workspaceCourses.map((course) => `<option value="${escapeHtml(course.id)}" ${course.id === draft.courseId ? "selected" : ""}>${escapeHtml(course.name)}</option>`).join("")}</select>
        ${assignment ? `<button type="button" class="um-chip um-use-page" ${state.workspaceBusy ? "disabled" : ""}>Use text from this page</button>` : ""}
        ${draft.kind !== "link" ? `<label for="um-work-content">${assignment ? "Assignment instructions (paste what matters)" : "Note"}</label><textarea id="um-work-content" class="um-field" name="content" maxlength="12000" ${assignment ? "" : "required"}>${escapeHtml(draft.content)}</textarea>` : ""}
        <label for="um-work-url">${draft.kind === "link" ? "Link" : "Source link (optional)"}</label><input id="um-work-url" class="um-field" name="sourceUrl" type="url" ${draft.kind === "link" ? "required" : ""} value="${escapeHtml(draft.sourceUrl || "")}" />
        ${assignment ? `<label for="um-work-progress">What have you done so far?</label><textarea id="um-work-progress" class="um-field" name="progress" maxlength="4000">${escapeHtml(draft.progress)}</textarea><label for="um-work-next">Next small step</label><textarea id="um-work-next" class="um-field" name="nextStep" maxlength="2000" placeholder="For example: find one source for my introduction">${escapeHtml(draft.nextStep)}</textarea><label for="um-work-status">Status</label><select id="um-work-status" class="um-field" name="status"><option value="active" ${draft.status === "active" ? "selected" : ""}>In progress</option><option value="done" ${draft.status === "done" ? "selected" : ""}>Complete</option></select>` : ""}
        <p>Only these fields are saved to your UniMate account. Nothing is added until you choose Save.</p>
        <button type="submit" class="um-primary" ${state.workspaceBusy ? "disabled" : ""}>${state.workspaceBusy ? "Saving…" : "Save"}</button>
        <button type="button" class="um-link um-discard-work" ${state.workspaceBusy ? "disabled" : ""}>Discard these edits</button>
      </fieldset></form></div>`;
    const form = body.querySelector(".um-study-form");
    form.addEventListener("input", (event) => {
      const field = event.target;
      if (
        ["title", "content", "sourceUrl", "courseId", "nextStep", "progress", "status"].includes(
          field.name,
        )
      ) {
        draft[field.name] = field.name === "courseId" ? field.value || null : field.value;
      }
    });
    // Some browsers emit only change for selects.
    form.addEventListener("change", (event) => {
      const field = event.target;
      if (field.name === "courseId" || field.name === "status")
        draft[field.name] = field.value || null;
    });
    form.addEventListener("submit", saveStudyDraft);
    body.querySelector(".um-use-page")?.addEventListener("click", useStudyPageText);
    body
      .querySelector(".um-work-back")
      .addEventListener("click", () =>
        renderChat("Your workspace edits are kept here. Reopen Save to continue editing."),
      );
    body.querySelector(".um-discard-work").addEventListener("click", () => {
      state.workspaceDraft = null;
      renderChat("Workspace edits discarded. Your chat is unchanged.");
    });
  }

  async function useStudyPageText() {
    const draft = state.workspaceDraft;
    if (!draft || state.workspaceBusy) return;
    if (draft.content.trim())
      return renderStudyEditor(
        "Your instructions are kept. Clear that field first if you want to replace it with page text.",
      );
    const sessionVersion = state.sessionVersion;
    state.workspaceBusy = true;
    renderStudyEditor();
    try {
      const consent = await send({ type: "PRIVACY_CONSENT_STATE" });
      if (sessionVersion !== state.sessionVersion || state.workspaceDraft !== draft) return;
      if (!consent.accepted)
        throw new Error(
          "Page sharing is off. Review Page sharing in the chat before using page text.",
        );
      const context = extractContext();
      const text = String(context.highlightedText || context.visiblePageText || "").trim();
      if (!text)
        throw new Error(
          "There’s no readable page text to use. Paste the assignment instructions into the field instead.",
        );
      draft.content = text;
      draft.sourceUrl = studyPageUrl();
      draft.sourceTitle = String(context.pageTitle || document.title || "").slice(0, 200);
      draft.pageTextNotice = context.highlightedText
        ? "Your highlighted text is ready to review. Check that it includes all the instructions you need."
        : "A short visible-text sample is ready to review. It may omit instructions elsewhere on the page; add anything missing before saving.";
      state.workspaceBusy = false;
      renderStudyEditor();
    } catch (error) {
      if (sessionVersion !== state.sessionVersion || state.workspaceDraft !== draft) return;
      state.workspaceBusy = false;
      renderStudyEditor(error?.message || "Page text could not be read. Your draft is kept.");
    }
  }

  async function loadMoreStudyWork() {
    if (state.workspaceBusy || state.workspaceNextOffset === null) return;
    const sessionVersion = state.sessionVersion;
    state.workspaceBusy = true;
    renderStudyList();
    try {
      const result = await send({
        type: "LOAD_STUDY_WORKSPACE",
        filters: { kind: "assignment", offset: state.workspaceNextOffset },
      });
      if (sessionVersion !== state.sessionVersion) return;
      const merged = new Map(state.workspaceItems.map((item) => [item.id, item]));
      for (const item of result.items) merged.set(item.id, item);
      state.workspaceItems = [...merged.values()];
      state.workspaceNextOffset = result.nextOffset ?? null;
      state.workspaceBusy = false;
      renderStudyList();
    } catch (error) {
      if (sessionVersion !== state.sessionVersion) return;
      state.workspaceBusy = false;
      if (handleAccessRequired(error)) return;
      renderStudyList(
        "More assignments could not be loaded. The saved work already shown is kept; try again.",
      );
    }
  }

  async function saveStudyDraft(event) {
    event.preventDefault();
    if (state.workspaceBusy || !state.workspaceDraft) return;
    const draft = state.workspaceDraft;
    if (draft.content.length > 12000)
      return renderStudyEditor(
        "Your full text is kept. Shorten it to 12,000 characters or fewer before saving.",
      );
    const sessionVersion = state.sessionVersion;
    state.workspaceBusy = true;
    renderStudyEditor();
    const item = Object.fromEntries(
      [
        "id",
        "kind",
        "title",
        "content",
        "sourceUrl",
        "sourceTitle",
        "nextStep",
        "progress",
        "status",
        "courseId",
        "conversationId",
      ].map((key) => [key, draft[key]]),
    );
    item.sourceUrl = item.sourceUrl || null;
    try {
      const result = await send({ type: "SAVE_STUDY_ITEM", item, expectedVersion: draft.version });
      if (sessionVersion !== state.sessionVersion || state.workspaceDraft !== draft) return;
      if (!result?.item?.id) throw new Error("The save could not be confirmed.");
      state.workspaceBusy = false;
      state.workspaceDraft = null;
      if (result.item.kind === "assignment") state.workspaceItem = result.item;
      renderChat(
        result.item.kind === "assignment"
          ? "Saved. Your instructions, progress and next step are ready whenever you return."
          : result.item.kind === "note"
            ? "Saved to Notes in your UniMate workspace."
            : "Saved to your Bulletin Board in UniMate.",
      );
    } catch (error) {
      if (sessionVersion !== state.sessionVersion || state.workspaceDraft !== draft) return;
      state.workspaceBusy = false;
      if (handleAccessRequired(error)) return;
      renderStudyEditor(
        error?.code === "WORKSPACE_CONFLICT"
          ? "This item changed elsewhere. Your edits are kept here. Copy any changes you want to keep, then discard these edits and reopen the saved item to review its latest version."
          : "We couldn’t confirm the save. Your edits are kept here; try saving again.",
      );
    }
  }

  function renderStudyList(error = "") {
    state.view = "workspace";
    const items = state.workspaceItems.filter((item) => item.kind === "assignment");
    body.innerHTML = `<div class="um-workspace"><button type="button" class="um-chip um-list-back">Back to chat</button><h2>Pick up where you left off</h2><p>Your saved assignments stay with your account, with or without a class.</p>${error ? `<div class="um-status error" role="alert">${escapeHtml(error)}</div>` : ""}<button type="button" class="um-primary um-new-assignment" ${state.workspaceBusy || state.draft.trim() || state.pendingSave || state.failedQuestion || state.workspaceDraft ? "disabled" : ""}>Start a new assignment chat</button>${state.draft.trim() || state.pendingSave || state.failedQuestion || state.workspaceDraft ? "<p>Finish or discard your current draft before switching chats.</p>" : ""}<ul class="um-workspace-list">${items.map((item, index) => `<li><button type="button" class="um-secondary um-resume-item" data-index="${index}" ${state.workspaceBusy || state.draft.trim() || state.pendingSave || state.failedQuestion || state.workspaceDraft ? "disabled" : ""}><strong>${escapeHtml(item.title)}</strong><br/>${escapeHtml(item.status === "done" ? "Complete" : item.nextStep || "Continue your assignment")}</button></li>`).join("") || "<li>No saved assignments yet. Save one from your chat whenever you’re ready.</li>"}</ul>${state.workspaceNextOffset !== null ? `<button type="button" class="um-secondary um-more-work" ${state.workspaceBusy ? "disabled" : ""}>Load more assignments</button>` : ""}<button type="button" class="um-link um-reload-work" ${state.workspaceBusy ? "disabled" : ""}>Refresh saved work</button><br/><button type="button" class="um-link um-open-notes">Open Notes</button> <button type="button" class="um-link um-open-links">Open Bulletin Board</button></div>`;
    body.querySelector(".um-list-back").addEventListener("click", () => renderChat());
    body.querySelector(".um-more-work")?.addEventListener("click", loadMoreStudyWork);
    body
      .querySelector(".um-new-assignment")
      .addEventListener("click", () => selectStudyChat(crypto.randomUUID(), true));
    for (const button of body.querySelectorAll(".um-resume-item"))
      button.addEventListener("click", () =>
        selectStudyChat(
          items[Number(button.dataset.index)].conversationId,
          false,
          items[Number(button.dataset.index)],
        ),
      );
    body
      .querySelector(".um-reload-work")
      .addEventListener("click", () => openStudyWorkspace("list"));
    body
      .querySelector(".um-open-notes")
      .addEventListener("click", () =>
        send({ type: "OPEN_STUDY_WORKSPACE", section: "note" }).catch(() =>
          renderStudyList("UniMate could not be opened. Try again."),
        ),
      );
    body
      .querySelector(".um-open-links")
      .addEventListener("click", () =>
        send({ type: "OPEN_STUDY_WORKSPACE", section: "link" }).catch(() =>
          renderStudyList("UniMate could not be opened. Try again."),
        ),
      );
  }

  async function selectStudyChat(conversationId, create = false, savedItem = null) {
    if (
      state.workspaceBusy ||
      state.draft.trim() ||
      state.pendingSave ||
      state.failedQuestion ||
      state.workspaceDraft
    )
      return;
    const sessionVersion = state.sessionVersion;
    const needsAttachment = !conversationId && savedItem;
    if (needsAttachment) {
      conversationId =
        state.workspaceResume?.itemId === savedItem.id
          ? state.workspaceResume.conversationId
          : crypto.randomUUID();
      state.workspaceResume = { itemId: savedItem.id, conversationId };
    }
    state.workspaceBusy = true;
    renderStudyList();
    let createdChat = false;
    try {
      const chat = await send({
        type: "SELECT_STUDY_CONVERSATION",
        conversationId,
        create: create || Boolean(needsAttachment),
      });
      if (sessionVersion !== state.sessionVersion) return;
      createdChat = Boolean(needsAttachment);
      if (needsAttachment) {
        const result = await send({
          type: "SAVE_STUDY_ITEM",
          item: { id: savedItem.id, conversationId },
          expectedVersion: savedItem.version,
        });
        if (sessionVersion !== state.sessionVersion) return;
        if (!result?.item?.id) throw new Error("The assignment could not be attached.");
        chat.workspaceItem = result.item;
        state.workspaceResume = null;
      }
      if (sessionVersion !== state.sessionVersion) return;
      state.workspaceBusy = false;
      state.activeConversationId = chat.conversationId;
      state.activeConversationTitle = chat.conversationTitle;
      state.messages = chat.messages;
      state.workspaceItem = chat.workspaceItem || null;
      state.workspaceUnavailable = Boolean(chat.workspaceUnavailable) && !needsAttachment;
      state.pageHistory = [];
      state.conversationStartIndex = chat.messages.length;
      renderChat(
        create
          ? "A fresh assignment chat is ready. Ask about this page, then save your progress whenever you like."
          : "Welcome back. Your saved progress is here; review it and choose your next step.",
      );
    } catch (error) {
      if (sessionVersion !== state.sessionVersion) return;
      state.workspaceBusy = false;
      if (handleAccessRequired(error)) return;
      renderStudyList(
        createdChat
          ? "A new chat was created, but your saved assignment could not be attached. Your progress is unchanged. Refresh saved work, then try opening it again."
          : "Your assignment chat could not be opened. Try again.",
      );
    }
  }

  async function retrySaving(event) {
    const sessionVersion = state.sessionVersion;
    const requestId = state.pendingSave;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await send({ type: "RETRY_CHAT_PERSISTENCE", requestId });
      if (sessionVersion !== state.sessionVersion || requestId !== state.pendingSave) return;
      state.pendingSave = null;
      renderChat("Saved. You can pick this up in Ask UniMate, too.");
    } catch (error) {
      if (sessionVersion !== state.sessionVersion || requestId !== state.pendingSave) return;
      if (handleAccessRequired(error)) return;
      renderChat(
        error?.code === "PERSISTENCE_EXPIRED"
          ? error.message
          : "Your answer is still here. We couldn’t save it yet; please try again.",
        true,
      );
    }
  }

  async function handleOpenSignIn(event) {
    const sessionVersion = state.sessionVersion;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Opening secure sign-in…";
    try {
      await send({ type: "OPEN_SIGN_IN" });
      if (sessionVersion !== state.sessionVersion) return;
      button.disabled = false;
      button.textContent = "Sign in securely";
    } catch (error) {
      if (sessionVersion !== state.sessionVersion) return;
      renderAuth("We couldn’t open your secure sign-in window. Please try again.");
    }
  }

  function applyAuthState(auth, forceReset = false) {
    const accountChanged =
      forceReset || Boolean(state.auth?.userId && state.auth.userId !== auth.userId);
    state.auth = auth;
    if (!accountChanged) return false;
    state.sessionVersion += 1;
    state.historyLoadVersion += 1;
    state.busy = false;
    state.messages = [];
    state.activeConversationId = null;
    state.activeConversationTitle = "Browser Companion";
    state.conversationStartIndex = 0;
    state.pageHistory = [];
    state.pageHistoryUrl = location.href;
    state.draft = "";
    state.failedQuestion = null;
    state.unresolvedRequest = null;
    state.pendingSave = null;
    state.workspaceItem = null;
    state.workspaceUnavailable = false;
    state.workspaceNextOffset = null;
    state.workspaceItems = [];
    state.workspaceCourses = [];
    state.workspaceDraft = null;
    state.workspaceResume = null;
    state.workspaceBusy = false;
    state.workspaceLoadVersion = (state.workspaceLoadVersion || 0) + 1;
    state.contextMode = null;
    state.diagnostics = null;
    state.readingPosition = null;
    state.renderedConversationId = null;
    announce("");
    return true;
  }

  function handleAccessRequired(error) {
    if (error?.code === "AUTH_REQUIRED") {
      // A definitive rejection is an identity boundary, not a network outage.
      // Clear account-scoped work exactly as on sign-out before showing login.
      applyAuthState({ configured: true, authenticated: false, isPro: false }, true);
      renderAuth("Your UniMate session has ended. Sign in securely to continue.");
      return true;
    }
    if (error?.code !== "PRO_REQUIRED" || !state.auth?.authenticated) return false;
    // Entitlement changed, not identity: keep drafts, conversation and unsaved
    // work so the same account can resume after access is restored.
    applyAuthState({ ...state.auth, isPro: false });
    state.busy = false;
    renderNotPro("Your Pro access is not active. Your draft and earlier work are kept here.");
    return true;
  }

  function handleSessionChanged() {
    // Only the extension runtime can deliver this signal. Re-read account state
    // from the background; never accept identity or tokens from event payloads.
    applyAuthState({ configured: true, authenticated: false, isPro: false }, true);
    state.privacyConsent = null;
    if (state.open) void initialize();
    else renderAuth();
  }

  async function handleSignOut() {
    if (state.busy) return;
    const sessionVersion = state.sessionVersion;
    state.busy = true;
    try {
      await send({ type: "SIGN_OUT" });
    } catch {
      if (sessionVersion !== state.sessionVersion) return;
      state.busy = false;
      const error = "We couldn’t sign you out. Please try again.";
      if (state.auth?.isPro) renderChat(error, true);
      else renderNotPro(error);
      return;
    }
    if (sessionVersion !== state.sessionVersion) return;
    state.busy = false;
    applyAuthState({ configured: true, authenticated: false, isPro: false });
    renderAuth();
  }

  async function handleWebsiteSignOut() {
    const sessionVersion = state.sessionVersion;
    try {
      await send({ type: "WEBSITE_SIGN_OUT" });
      if (sessionVersion !== state.sessionVersion) return;
      // Even a sign-in that has not returned yet belongs to the old session.
      if (!state.auth?.userId) state.sessionVersion += 1;
      applyAuthState({ configured: true, authenticated: false, isPro: false });
      if (state.open) renderAuth();
    } catch {
      // Untrusted host pages cannot sign the extension out by spoofing a DOM event.
    }
  }

  function syncWebsiteAuthState() {
    if (document.documentElement.dataset.unimateAuthState === "signed-out") {
      void handleWebsiteSignOut();
    }
  }

  async function handleChat(event) {
    event.preventDefault();
    if (state.busy || state.workspaceBusy) return;
    const input = event.currentTarget.querySelector(".um-input");
    const message = input.value.trim();
    if (!message) return;
    await submitChat(message, false);
  }

  function retainFailedQuestion(message) {
    if (state.failedQuestion || (state.draft && state.draft !== message)) {
      state.failedQuestion = String(message).slice(0, 4000);
    } else state.draft = message;
  }

  async function submitChat(message, retryFailed = false) {
    if (state.busy || state.workspaceBusy) return;
    if (state.workspaceDraft?.kind === "assignment") {
      return renderChat(
        "You have unsaved assignment instructions or progress. Open Save assignment to save or discard those edits before asking UniMate to use them.",
        true,
      );
    }
    if (state.failedQuestion && !retryFailed)
      return renderChat(
        "Retry or discard your earlier question first. Your new draft is safe below.",
        true,
      );
    if (state.pendingSave)
      return renderChat(
        "Please save the answer above before sending your next question. You can also copy it to keep a personal note.",
        true,
      );
    const sessionVersion = state.sessionVersion;
    const unresolved = retryFailed ? state.unresolvedRequest : null;
    state.historyLoadVersion += 1;
    if (!retryFailed) state.draft = "";
    state.busy = true;
    renderChat("Getting ready to help…", false, true);
    try {
      const consent = await send({ type: "PRIVACY_CONSENT_STATE" });
      if (sessionVersion !== state.sessionVersion) return;
      state.privacyConsent = consent;
      if (!consent.accepted) {
        retainFailedQuestion(message);
        return renderPrivacyConsent();
      }
      const auth = await send({ type: "AUTH_STATE" });
      if (sessionVersion !== state.sessionVersion) return;
      if (applyAuthState(auth)) {
        return renderChat("Your account changed. Ask your question again to start fresh.");
      }
      if (!auth.authenticated || !auth.isPro) {
        retainFailedQuestion(message);
        return !auth.authenticated ? renderAuth() : renderNotPro();
      }
    } catch (error) {
      if (sessionVersion !== state.sessionVersion) return;
      state.busy = false;
      retainFailedQuestion(message);
      if (handleAccessRequired(error)) return;
      renderChat(studentFacingError(error), true);
      return;
    } finally {
      if (sessionVersion === state.sessionVersion) state.busy = false;
    }
    // V2 is screenshot-first: every explicit Send captures exactly what the
    // student sees. DOM context stays small and supplemental.
    const extractedContext = unresolved?.payload.context || extractContext();
    let context = extractedContext;
    try {
      context = unresolved
        ? extractedContext
        : globalThis.UniMateContextExtractor?.buildFocusedContextPacket(
            extractedContext,
            message,
          ) || extractedContext;
    } catch {
      // A page-specific text issue must not strand the composer. The screenshot
      // remains available after the same consent and entitlement checks.
    }
    const decision = { useScreenshot: true, reason: "screenshot-first", confidence: 1 };
    state.diagnostics = {
      activeTabUrl: context.pageUrl,
      selectedText: String(context.highlightedText || "").slice(0, 300),
      contextCharacterCount: context.visiblePageText?.length || 0,
      screenshotFallbackStatus: "pending",
    };
    // Saved dialogue supports follow-ups after reloads and website handoffs.
    // It is bounded conversational context, separate from the freshly collected
    // page evidence; the backend forbids treating past page claims as sources.
    if (state.pageHistoryUrl !== location.href) {
      state.pageHistory = [];
      state.pageHistoryUrl = location.href;
    }
    const previousHistory = state.messages
      .filter((item) => item?.role === "user" || item?.role === "assistant")
      .slice(-10)
      .map((item) => ({ role: item.role, message: String(item.message || "").slice(0, 4000) }));
    const requestPageUrl = unresolved?.pageUrl || location.href;
    const requestUserId = state.auth.userId;
    const requestId = unresolved?.payload.requestId || crypto.randomUUID();
    const requestPayload = unresolved?.payload || {
      type: "SEND_CHAT",
      requestId,
      conversationId: state.activeConversationId,
      ...(state.workspaceItem?.conversationId === state.activeConversationId
        ? { workspaceId: state.workspaceItem.id }
        : {}),
      message,
      context,
      useScreenshot: decision.useScreenshot,
      screenshotReason: decision.reason,
      contextConfidence: decision.confidence,
      history: previousHistory,
    };
    const optimisticMessage = { role: "user", message, created_at: new Date().toISOString() };
    state.messages.push(optimisticMessage);
    state.busy = true;
    renderChat(undefined, false, true);
    announce("UniMate is thinking.");
    const acceptResult = (result) => {
      if (
        sessionVersion !== state.sessionVersion ||
        !state.auth?.authenticated ||
        state.auth.userId !== requestUserId
      )
        return;
      if (result.conversationId && result.conversationId !== state.activeConversationId) {
        state.activeConversationId = result.conversationId;
        state.activeConversationTitle = "Browser Companion";
        state.workspaceItem = null;
        state.messages = [result.user, result.assistant];
        state.pageHistory = [];
      } else {
        state.messages[state.messages.length - 1] = result.user;
        state.messages.push(result.assistant);
      }
      if (requestPageUrl === location.href) state.pageHistory.push(result.user, result.assistant);
      state.contextMode = result.contextMode;
      if (result.persistenceWarning) state.pendingSave = result.requestId;
      if (result.diagnostics) {
        state.diagnostics = { ...state.diagnostics, ...result.diagnostics };
      }
      state.failedQuestion = null;
      state.unresolvedRequest = null;
      state.busy = false;
      renderChat(result.persistenceWarning || undefined);
      announce(
        `UniMate: ${result.assistant.message}${result.persistenceWarning ? ` ${result.persistenceWarning}` : ""}`,
      );
    };
    try {
      if (unresolved) {
        const recovery = await send({ type: "RECOVER_CHAT_REQUEST", requestId });
        if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId) return;
        if (recovery?.status === "complete" && recovery.response) {
          acceptResult(recovery.response);
          return;
        }
        let samePage = requestPageUrl === location.href;
        if (samePage) {
          try {
            const fresh = extractContext();
            const focused =
              globalThis.UniMateContextExtractor?.buildFocusedContextPacket(fresh, message) ||
              fresh;
            const provenance = (value) =>
              JSON.stringify([
                value.pageUrl || "",
                value.pageTitle || "",
                value.highlightedText || "",
                value.nearbyText || "",
                value.visiblePageText || "",
                value.relevance?.matchedQuestionNumber || "",
                value.relevance?.bestBlockId || "",
                value.matchedQuestionText || "",
              ]);
            samePage = provenance(focused) === provenance(requestPayload.context);
          } catch {
            samePage = false; // Never combine unverified page text with a new screenshot.
          }
        }
        if (!samePage) {
          state.messages = state.messages.filter((item) => item !== optimisticMessage);
          state.busy = false;
          renderChat(
            "Your earlier question’s status is still uncertain, and the page has changed. Return to the original page and content before retrying, or discard it to ask about this page. Your new draft is safe below.",
            true,
          );
          return;
        }
      }
      acceptResult(await send(requestPayload));
    } catch (error) {
      if (
        sessionVersion !== state.sessionVersion ||
        !state.auth?.authenticated ||
        state.auth.userId !== requestUserId
      )
        return;
      const failureDetails = {
        message: error?.message || "Unknown error",
        code: error?.code || "COMPANION_ERROR",
        phase: error?.phase || "runtime",
      };
      const uncertain =
        !error?.backgroundResponded ||
        ["DUPLICATE_REQUEST", "DUPLICATE_IN_FLIGHT"].includes(error?.code);
      if (uncertain) {
        try {
          const recovery = await send({ type: "RECOVER_CHAT_REQUEST", requestId });
          if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId)
            return;
          if (recovery?.status === "complete" && recovery.response) {
            acceptResult(recovery.response);
            return;
          }
        } catch (recoveryError) {
          if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId)
            return;
          if (recoveryError?.code === "AUTH_REQUIRED" && handleAccessRequired(recoveryError))
            return;
          // The outcome is still unknown. Never substitute a new paid request ID.
        }
        if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId) return;
        state.unresolvedRequest = { payload: requestPayload, pageUrl: requestPageUrl };
        state.failedQuestion = String(message).slice(0, 4000);
      } else {
        state.unresolvedRequest = null;
      }
      try {
        // Refresh history, but never infer request identity from matching text.
        if (!state.pendingSave) {
          const messages = await send({ type: "LOAD_MESSAGES" });
          if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId)
            return;
          state.messages = messages;
        }
      } catch (historyError) {
        if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId) return;
        if (historyError?.code === "AUTH_REQUIRED" && handleAccessRequired(historyError)) return;
        // Keep earlier answers when the connection is unavailable.
      }
      if (sessionVersion !== state.sessionVersion || state.auth?.userId !== requestUserId) return;
      state.messages = state.messages.filter((item) => item !== optimisticMessage);
      retainFailedQuestion(message);
      state.runtime.lastError = failureDetails.message;
      state.runtime.lastErrorCode = failureDetails.code;
      state.runtime.lastErrorPhase = failureDetails.phase;
      const isCaptureFailure =
        error?.phase === "capture" ||
        /capture|cannot access contents|active tab|permission|not allowed|restricted|(?:^|[\s"'(<])(?:chrome(?:-extension)?|edge(?:-extension)?|brave|opera|about|moz-extension|safari-web-extension):|web store|edge add-ons|opera addons|extensions gallery/i.test(
          error.message,
        );
      const messageText = uncertain
        ? "The connection was interrupted, so I can’t confirm whether your earlier question finished. It’s kept here; retry will use the same request."
        : studentFacingError(error, decision.useScreenshot && isCaptureFailure);
      if (state.diagnostics && decision.useScreenshot) {
        state.diagnostics.screenshotFallbackStatus = `unavailable (${decision.reason})`;
      }
      state.busy = false;
      if (handleAccessRequired(error)) return;
      renderChat(messageText, true);
    } finally {
      if (sessionVersion === state.sessionVersion) {
        state.busy = false;
        const sendButton = body.querySelector(".um-send");
        if (sendButton) sendButton.disabled = false;
      }
    }
  }

  async function initialize() {
    if (state.busy) return;
    const restoreFocus = state.open && body.contains(shadow.activeElement);
    const sessionVersion = state.sessionVersion;
    const loadVersion = ++state.historyLoadVersion;
    const isCurrent = () =>
      sessionVersion === state.sessionVersion && loadVersion === state.historyLoadVersion;
    state.view = "loading";
    body.innerHTML =
      '<div class="um-auth" role="status"><p>Checking your Companion access…</p></div>';
    if (restoreFocus) {
      state.initialFocusPending = true;
      panel.focus({ preventScroll: true });
    }
    try {
      const consent = await send({ type: "PRIVACY_CONSENT_STATE" });
      if (!isCurrent()) return;
      state.privacyConsent = consent;
      if (!state.privacyConsent.accepted) return renderPrivacyConsent();
      const auth = await send({ type: "AUTH_STATE" });
      if (!isCurrent()) return;
      if (applyAuthState(auth)) return initialize();
      state.runtime.serviceWorker = await send({ type: "RUNTIME_DIAGNOSTICS" }).catch(() => null);
      if (!isCurrent()) return;
      if (!state.auth.authenticated) return renderAuth();
      if (!state.auth.isPro) return renderNotPro();
      if (state.pendingSave || state.failedQuestion) return renderChat();
      if (state.workspaceDraft) return renderStudyEditor();
      const chatState = await send({ type: "LOAD_CHAT_STATE" });
      if (!isCurrent()) return;
      if (state.activeConversationId && state.activeConversationId !== chatState.conversationId) {
        state.pageHistory = [];
        state.draft = "";
      }
      state.messages = chatState.messages;
      state.activeConversationId = chatState.conversationId;
      state.activeConversationTitle = chatState.conversationTitle;
      state.workspaceItem = chatState.workspaceItem || null;
      state.workspaceUnavailable = Boolean(chatState.workspaceUnavailable);
      state.conversationStartIndex = state.messages.length;
      renderChat();
    } catch (error) {
      if (!isCurrent()) return;
      if (handleAccessRequired(error)) return;
      if (state.auth?.authenticated) {
        if (!state.auth.isPro && state.privacyConsent?.accepted)
          return renderNotPro("We couldn’t check your Pro access. Please try again in a moment.");
        return renderChat(
          "We couldn’t refresh your Companion. Please try again in a moment.",
          true,
        );
      }
      state.auth = { configured: true, authenticated: false, isPro: false };
      renderAuth(error.message);
    }
  }

  mascot.addEventListener("click", () => toggle());
  root.querySelector(".um-close").addEventListener("click", () => toggle(false));

  // Let controls handle events normally, then stop those events at the closed
  // shadow boundary so host-page shortcuts and delegated handlers cannot react.
  shadow.addEventListener("keydown", handlePanelKeyboard);
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
    if (request?.type === "SESSION_CHANGED") {
      handleSessionChanged();
      sendResponse?.({ ok: true });
      return undefined;
    }
    if (request?.type === "TOGGLE_COMPANION") {
      toggle();
      return undefined;
    }
    if (request?.type === "COMPANION_PING") {
      sendResponse?.({ ok: true, nonce: request.nonce, protocolVersion: 2, extensionVersion });
      return undefined;
    }
    if (request?.type === "PREPARE_COMPANION_CAPTURE") {
      prepareForCapture(request)
        .then((result) => sendResponse?.({ ok: true, ...result }))
        .catch((error) => sendResponse?.({ ok: false, error: error?.message || "Hide failed." }));
      return true;
    }
    if (request?.type === "RESTORE_COMPANION_CAPTURE") {
      sendResponse?.({ ok: true, ...restoreAfterCapture(request.captureId) });
      return undefined;
    }
    if (request?.type === "DISPOSE_COMPANION_INSTANCE") {
      const compatible = request.preserveIfCompatible;
      if (compatible?.protocolVersion === 2 && compatible.extensionVersion === extensionVersion) {
        sendResponse?.({ ok: true, preserved: true, protocolVersion: 2, extensionVersion });
        return undefined;
      }
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

  function refreshVisiblePanel() {
    if (document.visibilityState === "visible" && state.open && !state.busy) {
      if (state.auth?.isPro) void refreshMessagesOnOpen();
      else void initialize();
    }
  }
  addEventListener("focus", refreshVisiblePanel);
  document.addEventListener("visibilitychange", refreshVisiblePanel);

  let currentPageUrl = location.href;
  function updatePageBoundary() {
    if (location.href === currentPageUrl) return;
    currentPageUrl = location.href;
    state.conversationStartIndex = state.messages.length;
    state.pageHistory = [];
    state.pageHistoryUrl = location.href;
    state.contextMode = null;
    state.diagnostics = null;
    if (state.open && !state.busy && state.view !== "privacy") renderChat();
  }
  const urlObserver = new MutationObserver(updatePageBoundary);
  urlObserver.observe(document.documentElement, { childList: true, subtree: true });
  const urlPoll = setInterval(updatePageBoundary, 1_000);
  addEventListener("popstate", updatePageBoundary);
  addEventListener("hashchange", updatePageBoundary);
  addEventListener("pageshow", updatePageBoundary);

  function dispose() {
    disposed = true;
    state.sessionVersion += 1;
    state.historyLoadVersion += 1;
    restoreAfterCapture(undefined, true);
    mountObserver.disconnect();
    urlObserver.disconnect();
    clearInterval(urlPoll);
    removeEventListener("pageshow", mount);
    document.removeEventListener("unimate-auth-signed-out", handleWebsiteSignOut);
    document.removeEventListener("unimate-browser-chat-changed", handleBrowserChatChanged);
    websiteAuthObserver.disconnect();
    removeEventListener("focus", refreshVisiblePanel);
    document.removeEventListener("visibilitychange", refreshVisiblePanel);
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
  globalThis.__unimateCompanionPrivateDispose = Object.assign(dispose, {
    protocolVersion: 2,
    extensionVersion,
    isActive: () => !disposed && Boolean(extensionRuntime()),
  });
})();
