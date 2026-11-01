// Fixed vocabularies for the structure report (P-0005 item 6). A key name or
// enumerated value read from the export is reported verbatim only when it is
// in one of these lists; anything else is counted as "(other)", so no string
// chosen by the export (a title, a file name, an account detail) can reach
// the report. The lists follow the publicly described export shape and are
// not a claim about real exports; the "(other)" counts show what is missing.

export const OTHER_TOKEN = "(other)";

export const CONVERSATION_KEYS: ReadonlySet<string> = new Set([
  "async_status",
  "blocked_urls",
  "conversation_id",
  "conversation_origin",
  "conversation_template_id",
  "create_time",
  "current_node",
  "default_model_slug",
  "disabled_tool_ids",
  "gizmo_id",
  "gizmo_type",
  "id",
  "is_archived",
  "is_do_not_remember",
  "is_read_only",
  "is_starred",
  "is_study_mode",
  "mapping",
  "memory_scope",
  "moderation_results",
  "owner",
  "plugin_ids",
  "safe_urls",
  "sugar_item_id",
  "sugar_item_visible",
  "title",
  "update_time",
  "voice",
]);

export const MESSAGE_KEYS: ReadonlySet<string> = new Set([
  "author",
  "channel",
  "content",
  "create_time",
  "end_turn",
  "id",
  "metadata",
  "recipient",
  "status",
  "update_time",
  "weight",
]);

export const ROLE_TOKENS: ReadonlySet<string> = new Set(["assistant", "system", "tool", "user"]);

export const CONTENT_TYPES: ReadonlySet<string> = new Set([
  "code",
  "computer_output",
  "execution_output",
  "model_editable_context",
  "multimodal_text",
  "reasoning_recap",
  "sonic_webpage",
  "system_error",
  "tether_browsing_display",
  "tether_quote",
  "text",
  "thoughts",
  "user_editable_context",
]);

export function reportToken(token: unknown, vocabulary: ReadonlySet<string>): string {
  return typeof token === "string" && vocabulary.has(token) ? token : OTHER_TOKEN;
}
