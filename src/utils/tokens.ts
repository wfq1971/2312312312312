/**
 * Token calculation utility
 */

import {  ALL_SPECIAL_TOKENS, encode } from "gpt-tokenizer";
import type {
  AnthropicMessageRequest,
  ChatCompletionRequest,
  Message,
  ResponseRequest,
} from "../types";
import { extractAllMessageText } from "./message-processing";

const CHAR_TO_TOKEN_RATIO = 4;

/**
 * User prompts are untrusted text and may legitimately contain strings that
 * look like OpenAI special tokens (`<|endoftext|>`, `<|im_start|>`, `<|fim_*|>`,
 * ...). Those are common when a chat/tool template leaks into the prompt, or
 * when the user asks the model to talk about tokenizers.
 *
 * `encode()` throws `Disallowed special token found: ...` on any of them by
 * default, which used to bubble up as an "Token calculation failed" error log on
 * every such request. We are only counting tokens of arbitrary text here, not
 * building a chat prompt, so special tokens must be treated as ordinary text.
 */
const PERMISSIVE_ENCODE_OPTIONS = {
  allowedSpecial: ALL_SPECIAL_TOKENS,
} as const;

export function calculateTokens(text: string, _model?: string): number {
    if (!text) return 0;
  try {
    return encode(text, PERMISSIVE_ENCODE_OPTIONS).length;
  } catch (error) {
    console.error("Token calculation failed:", error);
    return estimateTokenCount(text);
  }
}

/**
 * Estimate input tokens from a messages array
 */
export function estimateInputTokens(messages: Message[]): number {
  return calculateTokens(extractAllMessageText(messages));
}

/**
 * Calculate token count for a Chat Completions request body.
 */
export function calculateChatRequestTokens(
  body: ChatCompletionRequest,
): number {
  const text = extractAllMessageText(body.messages ?? []);
  return calculateTokens(text, body.model);
}

/**
 * Calculate token count for a Responses API request body.
 */
export function calculateResponseRequestTokens(body: ResponseRequest): number {
  let text = "";
  if (typeof body.input === "string") {
    text = body.input;
  } else if (body.messages) {
    text = extractAllMessageText(body.messages);
  }
  return calculateTokens(text, body.model);
}

/**
 * Calculate token count for an Anthropic Messages request body.
 */
export function calculateAnthropicRequestTokens(
  body: AnthropicMessageRequest,
): number {
  const messageText = extractAllMessageText(body.messages ?? []);

  let systemText = "";
  if (typeof body.system === "string") {
    systemText = body.system;
  } else if (Array.isArray(body.system)) {
    systemText = body.system.map((b) => b.text).join(" ");
  }

  return calculateTokens(`${systemText} ${messageText}`.trim(), body.model);
}

function estimateTokenCount(text: string): number {
  // More sophisticated estimation than simple division
  // Account for whitespace, punctuation, and common patterns
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;

  // Heuristic: average English word is ~4-5 characters + space
  // Tokens are roughly 0.75 words on average
  const wordBasedEstimate = Math.ceil(words * 0.75);
  const charBasedEstimate = Math.ceil(chars / CHAR_TO_TOKEN_RATIO);

  // Use the higher estimate for safety in rate limiting
  return Math.max(wordBasedEstimate, charBasedEstimate);
}
