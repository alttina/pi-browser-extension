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
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage
  | DoneMessage
  | ErrorMessage;
