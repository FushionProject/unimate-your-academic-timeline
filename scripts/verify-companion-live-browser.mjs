import assert from "node:assert/strict";

// Called only from the owner-operated, authenticated isolated preview. Sends
// one synthetic coursework question through the real UI, provider and database.
// Never returns credentials, previous chat content, or screenshots of the user.
export async function verifyLiveCompanion({ context, page, worker }) {
  assert.equal(new URL(page.url()).hostname, "127.0.0.1");
  assert.equal(await page.title(), "UniMate Companion · Practice page");
  const auth = await worker.evaluate(async () => {
    const result = await globalThis.authState();
    return { authenticated: result.authenticated, isPro: result.isPro };
  });
  assert.equal(auth.authenticated, true, "Owner sign-in is required");
  assert.equal(auth.isPro, true, "An existing Pro entitlement is required");
  const cdp = await context.newCDPSession(page);
  async function panel(selector, action = "text", value = "") {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    function find(node) {
      if (
        node.attributes?.some(
          (entry, i, list) => entry === "id" && list[i + 1] === "unimate-companion-host",
        )
      )
        return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const match = find(child);
        if (match) return match;
      }
    }
    const host = find(root);
    if (!host?.shadowRoots?.[0]) return null;
    const { object } = await cdp.send("DOM.resolveNode", {
      backendNodeId: host.shadowRoots[0].backendNodeId,
    });
    try {
      const { result, exceptionDetails } = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function(selector, action, value) {
          const element=this.querySelector(selector);
          if(action==='submission-state')return {composerPresent:Boolean(element),composerFocused:Boolean(element)&&this.activeElement===element,pageFocused:document.hasFocus(),draftMatches:element?.value===value,draftLength:element?.value?.length??0,sendDisabled:this.querySelector('.um-send')?.disabled,panelVisible:this.querySelector('.um-panel')?.getBoundingClientRect().height>0,panelInert:this.querySelector('.um-panel')?.inert,panelHidden:this.querySelector('.um-panel')?.getAttribute('aria-hidden'),thinking:Boolean(this.querySelector('.um-thinking')),signin:Boolean(this.querySelector('.um-signin')),upgrade:Boolean(this.querySelector('.um-upgrade')),consent:Boolean(this.querySelector('.um-consent-accept')),loading:/Checking your Companion access|Loading your UniMate session/.test(this.querySelector('.um-auth p')?.textContent||'')};
          if(!element)return null;
          if(action==='click'){element.click();return true;}
          if(action==='fill'){element.focus();element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));return true;}
          if(action==='focused')return this.activeElement===element;
          if(action==='visible'){const r=element.getBoundingClientRect();return getComputedStyle(element).visibility!=='hidden'&&r.width>0&&r.height>0;}
          return element.textContent;
        }`,
        arguments: [{ value: selector }, { value: action }, { value }],
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error("Companion panel action failed");
      return result.value;
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    }
  }
  async function until(check, label, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out at ${label}`);
  }
  const question = `Companion verification ${Date.now()}: Help me understand the practice question on this fictional biology page in a warm, simple way. Give the answer and one short explanation.`;
  await worker.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.__unimateLiveCheck = { originalFetch, requests: [] };
    globalThis.fetch = async function (input, init) {
      const url = new URL(typeof input === "string" ? input : input.url);
      const response = await originalFetch.call(this, input, init);
      if (
        ["/api/analyze-screenshot", "/api/dashboard-ai", "/rest/v1/companion_chats"].includes(
          url.pathname,
        )
      ) {
        let screenshot = false;
        let errorCode = null;
        if (!response.ok && url.pathname.startsWith("/api/")) {
          const payload = await response
            .clone()
            .json()
            .catch(() => null);
          if (typeof payload?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(payload.code))
            errorCode = payload.code;
        }
        if (url.pathname === "/api/analyze-screenshot" && typeof init?.body === "string") {
          screenshot = /^data:image\/jpeg;base64,/.test(JSON.parse(init.body).imageBase64 || "");
        }
        globalThis.__unimateLiveCheck.requests.push({
          path: url.pathname,
          method: init?.method || "GET",
          status: response.status,
          screenshot,
          errorCode,
        });
      }
      return response;
    };
  });
  try {
    await page.bringToFront();
    await until(() => panel(".um-mascot", "visible"), "mascot");
    if (!(await panel(".um-panel", "visible"))) await panel(".um-mascot", "click");
    if (await panel(".um-consent-accept", "visible")) await panel(".um-consent-accept", "click");
    await until(() => panel(".um-input", "visible"), "Pro composer");
    console.log("LIVE PASS Authenticated Pro composer and consent flow");
    assert.equal(await panel(".um-input", "fill", question), true);
    console.log(
      JSON.stringify({
        check: "live_submission_before",
        state: await panel(".um-input", "submission-state", question),
      }),
    );
    await page.keyboard.press("Enter");
    console.log(
      JSON.stringify({
        check: "live_submission_after",
        state: await panel(".um-input", "submission-state", question),
      }),
    );
    await until(
      async () => {
        const failed = await panel(".um-status.error", "text");
        if (failed) throw new Error(`Companion reported: ${failed}`);
        const state = await panel(".um-input", "submission-state", question);
        if (!state?.composerPresent)
          throw new Error(`Companion left the composer: ${JSON.stringify(state)}`);
        return await worker.evaluate((expected) => {
          const requests = globalThis.__unimateLiveCheck.requests;
          return requests.some(
            (entry) =>
              entry.path === "/rest/v1/companion_chats" &&
              entry.method === "POST" &&
              entry.status < 300,
          );
        }, question);
      },
      "real answer and save",
      60000,
    );
    await until(async () => !(await panel(".um-thinking", "visible")), "rendered reply");
    const evidence = await worker.evaluate(async (expected) => {
      const session = await globalThis.requireProSession();
      const state = await globalThis.loadChatState(session);
      const index = state.messages.findIndex(
        (message) => message.role === "user" && message.message === expected,
      );
      const answer =
        index >= 0 && state.messages[index + 1]?.role === "assistant"
          ? state.messages[index + 1].message
          : "";
      return {
        saved: index >= 0 && Boolean(answer),
        answer,
        requests: globalThis.__unimateLiveCheck.requests,
      };
    }, question);
    assert.equal(evidence.saved, true, "Both new test messages must be readable from Supabase");
    assert.match(
      evidence.answer,
      /mitochondri/i,
      "The answer must address the visible biology question",
    );
    assert.ok(
      evidence.requests.some(
        (request) =>
          request.path === "/api/analyze-screenshot" &&
          request.status === 200 &&
          request.screenshot,
      ),
      "Must use real screenshot endpoint successfully",
    );
    assert.ok(
      (await panel(".um-messages")).includes(evidence.answer.split("\n")[0].replace(/^#+\s*/, "")),
      "Answer must render in the panel",
    );
    await page.reload();
    await until(() => panel(".um-mascot", "visible"), "reloaded mascot");
    await panel(".um-mascot", "click");
    await until(
      async () => (await panel(".um-messages"))?.includes(question),
      "saved history after reload",
    );
    console.log(
      JSON.stringify({
        check: "live_companion",
        result: "passed",
        boundaries: [
          "private sign-in",
          "Pro entitlement",
          "consent",
          "active-tab screenshot",
          "real AI answer",
          "Supabase save and readback",
          "history after reload",
        ],
        syntheticAnswer: evidence.answer,
        requests: evidence.requests,
      }),
    );
  } catch (error) {
    const requests = await worker
      .evaluate(() => globalThis.__unimateLiveCheck?.requests || [])
      .catch(() => []);
    console.log(JSON.stringify({ check: "live_companion_http", result: "failed", requests }));
    console.log(
      JSON.stringify({
        check: "live_submission_failed",
        state: await panel(".um-input", "submission-state", question).catch(() => null),
      }),
    );
    throw error;
  } finally {
    await worker
      .evaluate(() => {
        if (globalThis.__unimateLiveCheck)
          globalThis.fetch = globalThis.__unimateLiveCheck.originalFetch;
        delete globalThis.__unimateLiveCheck;
      })
      .catch(() => {});
    await cdp.detach();
  }
}
