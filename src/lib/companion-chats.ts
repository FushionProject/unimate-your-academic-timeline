import { supabase } from "./supabase";

export interface CompanionChatRow {
  id: string;
  user_id: string;
  message: string;
  role: "user" | "assistant";
  created_at: string;
  conversation_id: string;
}

export interface CompanionConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface CompanionConversationDashboard {
  conversations: CompanionConversation[];
  activeBrowserConversationId: string | null;
}

const HISTORY_LIMIT = 100;

export class CompanionChatError extends Error {
  constructor(
    public readonly code:
      | "NOT_CONFIGURED"
      | "INVALID_USER"
      | "INVALID_MESSAGE"
      | "INVALID_CONVERSATION"
      | "LOAD_FAILED"
      | "SAVE_FAILED"
      | "CREATE_FAILED"
      | "DELETE_FAILED"
      | "PREFERENCE_FAILED",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CompanionChatError";
  }
}

function requireConversationId(conversationId: string) {
  const normalized = conversationId.trim();
  if (!normalized) {
    throw new CompanionChatError("INVALID_CONVERSATION", "Choose a conversation first.");
  }
  return normalized;
}

export async function loadConversationDashboard(
  userId: string,
): Promise<CompanionConversationDashboard> {
  const client = requireSupabase();
  const expectedUserId = requireUserId(userId);
  const [conversationResult, preferenceResult] = await Promise.all([
    client
      .from("companion_conversations")
      .select("id,user_id,title,created_at,updated_at")
      .eq("user_id", expectedUserId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false }),
    client
      .from("companion_preferences")
      .select("active_conversation_id")
      .eq("user_id", expectedUserId)
      .maybeSingle(),
  ]);
  if (conversationResult.error || preferenceResult.error) {
    throw new CompanionChatError(
      "LOAD_FAILED",
      "Your conversations could not be loaded.",
      conversationResult.error || preferenceResult.error,
    );
  }
  const conversations = (conversationResult.data || []) as CompanionConversation[];
  if (conversations.some((conversation) => conversation.user_id !== expectedUserId)) {
    throw new CompanionChatError("LOAD_FAILED", "A conversation belonged to another user.");
  }
  return {
    conversations,
    activeBrowserConversationId: preferenceResult.data?.active_conversation_id || null,
  };
}

export async function createCompanionConversation(
  userId: string,
  title = "New chat",
): Promise<CompanionConversation> {
  const client = requireSupabase();
  const expectedUserId = requireUserId(userId);
  const safeTitle = title.trim().slice(0, 120) || "New chat";
  const { data, error } = await client
    .from("companion_conversations")
    .insert({ user_id: expectedUserId, title: safeTitle })
    .select("id,user_id,title,created_at,updated_at")
    .single();
  if (error || !data) {
    throw new CompanionChatError(
      "CREATE_FAILED",
      "A new conversation could not be created.",
      error,
    );
  }
  return data as CompanionConversation;
}

export async function deleteCompanionConversation(userId: string, conversationId: string) {
  const client = requireSupabase();
  const expectedUserId = requireUserId(userId);
  const safeConversationId = requireConversationId(conversationId);
  const { error } = await client
    .from("companion_conversations")
    .delete()
    .eq("id", safeConversationId)
    .eq("user_id", expectedUserId);
  if (error) {
    throw new CompanionChatError("DELETE_FAILED", "The conversation could not be deleted.", error);
  }
}

export async function setBrowserConversation(userId: string, conversationId: string) {
  const client = requireSupabase();
  const expectedUserId = requireUserId(userId);
  const safeConversationId = requireConversationId(conversationId);
  const { error } = await client.from("companion_preferences").upsert({
    user_id: expectedUserId,
    active_conversation_id: safeConversationId,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new CompanionChatError(
      "PREFERENCE_FAILED",
      "The browser conversation could not be changed.",
      error,
    );
  }
  // The extension runs in an isolated world and owns its own Supabase client.
  // Send no IDs or tokens through the page; this signal only tells it to
  // re-read the RLS-protected active preference from Supabase.
  document.dispatchEvent(new CustomEvent("unimate-browser-chat-changed"));
}

function requireSupabase() {
  if (!supabase) {
    throw new CompanionChatError("NOT_CONFIGURED", "Supabase is not configured.");
  }
  return supabase;
}

function requireUserId(userId: string) {
  const normalized = userId.trim();
  if (!normalized) {
    throw new CompanionChatError("INVALID_USER", "A signed-in user is required.");
  }
  return normalized;
}

function requireMessage(message: string, label: string) {
  if (!message.trim()) {
    throw new CompanionChatError("INVALID_MESSAGE", `${label} cannot be empty.`);
  }
  if (message.length > 50_000) {
    throw new CompanionChatError("INVALID_MESSAGE", `${label} exceeds the shared-history limit.`);
  }
  return message;
}

export async function loadCompanionChats(
  userId: string,
  conversationId: string,
): Promise<CompanionChatRow[]> {
  const client = requireSupabase();
  const expectedUserId = requireUserId(userId);
  const safeConversationId = requireConversationId(conversationId);
  const { data, error } = await client
    .from("companion_chats")
    .select("id,user_id,message,role,created_at,conversation_id")
    // RLS is authoritative. This predicate is defense in depth and avoids
    // accidentally mixing histories if the signed-in account changes mid-load.
    .eq("user_id", expectedUserId)
    .eq("conversation_id", safeConversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    throw new CompanionChatError("LOAD_FAILED", "Shared history could not be loaded.", error);
  }

  const rows = (data || []) as CompanionChatRow[];
  if (
    rows.some((row) => row.user_id !== expectedUserId || row.conversation_id !== safeConversationId)
  ) {
    throw new CompanionChatError(
      "LOAD_FAILED",
      "Shared history returned data for a different user.",
    );
  }
  return rows.reverse();
}

export async function saveCompanionExchange(
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<CompanionChatRow[]> {
  const client = requireSupabase();
  const expectedUserId = requireUserId(userId);
  const safeConversationId = requireConversationId(conversationId);
  const safeUserMessage = requireMessage(userMessage, "Question");
  const safeAssistantMessage = requireMessage(assistantMessage, "Answer");
  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const { data, error } = await client
    .from("companion_chats")
    .insert([
      {
        user_id: expectedUserId,
        conversation_id: safeConversationId,
        message: safeUserMessage,
        role: "user",
        created_at: userCreatedAt.toISOString(),
      },
      {
        user_id: expectedUserId,
        conversation_id: safeConversationId,
        message: safeAssistantMessage,
        role: "assistant",
        created_at: assistantCreatedAt.toISOString(),
      },
    ])
    .select("id,user_id,message,role,created_at,conversation_id");

  if (error) {
    // Both messages use one INSERT statement, so Postgres commits both or neither.
    throw new CompanionChatError("SAVE_FAILED", "Shared history could not be saved.", error);
  }

  const rows = (data || []) as CompanionChatRow[];
  if (
    rows.length !== 2 ||
    rows.some(
      (row) => row.user_id !== expectedUserId || row.conversation_id !== safeConversationId,
    ) ||
    !rows.some((row) => row.role === "user") ||
    !rows.some((row) => row.role === "assistant")
  ) {
    throw new CompanionChatError(
      "SAVE_FAILED",
      "Shared history did not confirm the complete exchange.",
    );
  }
  return rows.sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
      left.id.localeCompare(right.id),
  );
}
