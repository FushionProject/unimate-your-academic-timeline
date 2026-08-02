import assert from "node:assert/strict";
import fs from "node:fs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const webData = fs.readFileSync(
  new URL("../../src/lib/companion-chats.ts", import.meta.url),
  "utf8",
);
const askRoute = fs.readFileSync(new URL("../../src/routes/ask.tsx", import.meta.url), "utf8");
const authContext = fs.readFileSync(
  new URL("../../src/lib/auth-context.tsx", import.meta.url),
  "utf8",
);
const migration = fs.readFileSync(
  new URL("../../supabase/companion_conversations.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /create table if not exists public\.companion_conversations/);
assert.match(migration, /create table if not exists public\.companion_preferences/);
assert.match(migration, /foreign key \(active_conversation_id, user_id\)/);
assert.match(migration, /foreign key \(conversation_id, user_id\)/);
assert.match(migration, /on delete cascade/);
assert.match(migration, /alter column conversation_id set not null/);
assert.match(migration, /auth\.uid\(\)\) = user_id/g);

assert.match(webData, /loadConversationDashboard/);
assert.match(webData, /createCompanionConversation/);
assert.match(webData, /deleteCompanionConversation/);
assert.match(webData, /setBrowserConversation/);
assert.match(
  webData,
  /document\.dispatchEvent\(new CustomEvent\("unimate-browser-chat-changed"\)\)/,
);
assert.match(webData, /\.eq\("conversation_id", safeConversationId\)/);
assert.match(webData, /conversation_id: safeConversationId/g);

assert.match(askRoute, /Your chats/);
assert.match(askRoute, /Use in browser/);
assert.match(askRoute, /handleCreateConversation/);
assert.match(askRoute, /handleDeleteConversation/);
assert.match(askRoute, /handleUseInBrowser/);

assert.match(background, /ensureActiveConversation/);
assert.match(background, /loadChatState/);
assert.match(background, /ACCOUNT_SWITCH_REQUIRES_SIGN_OUT/);
assert.match(background, /completedChatRequests\.clear\(\)/);
assert.match(background, /companion_preferences/);
assert.match(background, /conversation_id: conversationId/g);
assert.match(content, /refreshMessagesOnOpen/);
assert.match(content, /LOAD_CHAT_STATE/);
assert.match(content, /visibilitychange/);
assert.match(content, /handleBrowserChatChanged/);
assert.match(content, /document\.addEventListener\("unimate-browser-chat-changed"/);
assert.match(askRoute, /New chat created and selected/);
assert.match(authContext, /unimate-auth-signed-out/);
assert.match(authContext, /document\.dispatchEvent/);
assert.match(authContext, /dataset\.unimateAuthState = session \? "signed-in" : "signed-out"/);
assert.match(content, /handleWebsiteSignOut/);
assert.match(content, /document\.addEventListener\("unimate-auth-signed-out"/);
assert.match(content, /function syncWebsiteAuthState/);

console.log("PASS named conversation dashboard and browser selection contract");
