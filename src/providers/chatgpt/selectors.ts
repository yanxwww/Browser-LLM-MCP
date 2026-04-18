export const chatGptSelectors = {
  composer: [
    "#prompt-textarea",
    "textarea[data-testid='prompt-textarea']",
    "div[contenteditable='true'][id='prompt-textarea']",
    "[data-testid='composer-text-input']",
    "div.ProseMirror[contenteditable='true']"
  ],
  sendButton: [
    "[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label*='Send']",
    "button[aria-label*='发送']"
  ],
  stopButton: [
    "[data-testid='stop-button']",
    "button[aria-label*='Stop']",
    "button[aria-label*='停止']"
  ],
  assistantMessage: [
    "[data-message-author-role='assistant']",
    "[data-testid='conversation-turn-assistant']",
    "article:has([data-message-author-role='assistant'])"
  ],
  userMessage: [
    "[data-message-author-role='user']",
    "[data-testid='conversation-turn-user']",
    "article:has([data-message-author-role='user'])"
  ],
  loginIndicators: [
    "a[href*='/auth/login']",
    "button:has-text('Log in')",
    "button:has-text('登录')",
    "button:has-text('Sign up')"
  ],
  newChat: [
    "a[href='/']",
    "a[aria-label*='New chat']",
    "button[aria-label*='New chat']",
    "a:has-text('New chat')",
    "button:has-text('New chat')"
  ]
} as const;
