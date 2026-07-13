import { Type, type Static, type TSchema } from 'typebox';

export const ScreenshotSchema = Type.Object(
  {
    fullPage: Type.Optional(Type.Boolean({ description: 'Capture the full page instead of the viewport.' })),
  },
  { description: 'Take a screenshot of the current browser tab.' }
);

export const ScrollSchema = Type.Object(
  {
    direction: Type.Optional(Type.String({ description: 'Direction to scroll: "top", "bottom", or omit if using selector.' })),
    selector: Type.Optional(Type.String({ description: 'CSS selector of the element to scroll into view.' })),
  },
  { description: 'Scroll the page or a specific element into view.' }
);

export const ClickSchema = Type.Object(
  {
    selector: Type.String({ description: 'CSS selector of the element to click.' }),
  },
  { description: 'Click an element on the page.' }
);

export const TypeSchema = Type.Object(
  {
    selector: Type.String({ description: 'CSS selector of the input element.' }),
    text: Type.String({ description: 'Text to type into the element.' }),
    submit: Type.Optional(Type.Boolean({ description: 'Whether to press Enter after typing.' })),
  },
  { description: 'Type text into an input or textarea.' }
);

export const NavigateSchema = Type.Object(
  {
    url: Type.String({ description: 'URL to navigate the current tab to.' }),
  },
  { description: 'Navigate the current tab to a URL.' }
);

export const GetTextSchema = Type.Object(
  {
    selector: Type.Optional(Type.String({ description: 'CSS selector to extract text from. If omitted, returns page body text.' })),
  },
  { description: 'Get the visible text content of the page or an element.' }
);

export const FindElementSchema = Type.Object(
  {
    description: Type.Optional(Type.String({ description: 'Natural language description of the element being looked for.' })),
    selector: Type.Optional(Type.String({ description: 'Candidate CSS selector to verify.' })),
  },
  { description: 'Find interactive elements on the page or verify a candidate selector.' }
);

export type BrowserToolName =
  | 'browser_screenshot'
  | 'browser_scroll'
  | 'browser_click'
  | 'browser_type'
  | 'browser_navigate'
  | 'browser_get_text'
  | 'browser_find_element';

export type ScreenshotArgs = Static<typeof ScreenshotSchema>;
export type ScrollArgs = Static<typeof ScrollSchema>;
export type ClickArgs = Static<typeof ClickSchema>;
export type TypeArgs = Static<typeof TypeSchema>;
export type NavigateArgs = Static<typeof NavigateSchema>;
export type GetTextArgs = Static<typeof GetTextSchema>;
export type FindElementArgs = Static<typeof FindElementSchema>;
