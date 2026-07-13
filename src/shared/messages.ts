export interface UserMessage {
  type: 'user';
  text: string;
}

export interface ToolCallMessage {
  type: 'tool_call';
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultMessage {
  type: 'tool_result';
  id: string;
  result: unknown;
  elapsedMs: number;
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
  | ToolCallMessage
  | ToolResultMessage
  | DoneMessage
  | ErrorMessage;
