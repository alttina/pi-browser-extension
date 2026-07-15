export interface UserMessage {
  type: 'user';
  text: string;
}

export interface AssistantMessage {
  type: 'assistant';
  text: string;
}

export interface ToolCallMessage {
  type: 'tool_call';
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** When true, this message is for UI visualization only and should not be executed. */
  ui?: boolean;
}

export interface ToolResultMessage {
  type: 'tool_result';
  id: string;
  result: unknown;
  elapsedMs: number;
  /** When true, this message is for UI visualization only. */
  ui?: boolean;
}

export interface DoneMessage {
  type: 'done';
  summary: string;
  toolCount: number;
  totalMs: number;
  totalTokens?: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type AgentStatus = 'thinking' | 'writing' | 'screenshotting' | 'working';

export interface StatusMessage {
  type: 'status';
  state: AgentStatus;
  toolCount: number;
  totalTokens?: number;
}

export interface ClearChatMessage {
  type: 'clear_chat';
}

/**
 * Instructs the native host to dispose the current Pi AgentSession and start
 * a fresh one with the same tools. Used by the side-panel "New chat" button
 * and by the E2E runner between tasks to prevent context pollution.
 */
export interface NewSessionMessage {
  type: 'new_session';
}

export interface ConfigMessage {
  type: 'config';
  provider?: string;
  model?: string;
}

export interface GetConfigMessage {
  type: 'get_config';
}

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage
  | DoneMessage
  | ErrorMessage
  | StatusMessage
  | ClearChatMessage
  | NewSessionMessage
  | ConfigMessage
  | GetConfigMessage;
