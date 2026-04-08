export const managedCaddyNotFoundPageCss: string = `:root {
  color-scheme: dark;
  --devhost-not-found-background: #0b1020;
  --devhost-not-found-surface: rgba(15, 23, 42, 0.82);
  --devhost-not-found-surface-border: rgba(148, 163, 184, 0.24);
  --devhost-not-found-text: #e2e8f0;
  --devhost-not-found-text-muted: #94a3b8;
  --devhost-not-found-accent: #7dd3fc;
  --devhost-not-found-accent-strong: #38bdf8;
  --devhost-not-found-shadow: rgba(15, 23, 42, 0.5);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  min-height: 100vh;
  padding: 24px;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 36%),
    radial-gradient(circle at bottom, rgba(14, 165, 233, 0.16), transparent 28%),
    var(--devhost-not-found-background);
  color: var(--devhost-not-found-text);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.devhost-not-found {
  width: min(760px, 100%);
  padding: 40px 32px;
  border: 1px solid var(--devhost-not-found-surface-border);
  border-radius: 24px;
  background: var(--devhost-not-found-surface);
  box-shadow: 0 32px 80px var(--devhost-not-found-shadow);
  backdrop-filter: blur(18px);
  text-align: center;
}

.devhost-not-found__code {
  margin: 0;
  font-size: clamp(5rem, 18vw, 8rem);
  line-height: 0.92;
  letter-spacing: -0.06em;
}

.devhost-not-found__title {
  margin: 16px 0 0;
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  line-height: 1.08;
}

.devhost-not-found__body {
  max-width: 42rem;
  margin: 16px auto 0;
  color: var(--devhost-not-found-text-muted);
  font-size: 1rem;
  line-height: 1.65;
}

.devhost-not-found__routes {
  margin-top: 32px;
  text-align: left;
}

.devhost-not-found__label {
  margin: 0 0 12px;
  color: var(--devhost-not-found-text-muted);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.devhost-not-found__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.devhost-not-found__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.55);
  color: inherit;
  text-decoration: none;
  transition:
    transform 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease;
}

.devhost-not-found__link:hover,
.devhost-not-found__link:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.56);
  background: rgba(15, 23, 42, 0.72);
}

.devhost-not-found__link:focus-visible {
  outline: 2px solid var(--devhost-not-found-accent-strong);
  outline-offset: 3px;
}

.devhost-not-found__route {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}

.devhost-not-found__arrow {
  flex: none;
  color: var(--devhost-not-found-accent);
  font-size: 1.1rem;
}

.devhost-not-found__empty {
  margin: 0;
  padding: 20px;
  border: 1px dashed rgba(148, 163, 184, 0.32);
  border-radius: 16px;
  color: var(--devhost-not-found-text-muted);
  background: rgba(15, 23, 42, 0.42);
}

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .devhost-not-found {
    padding: 32px 20px;
  }

  .devhost-not-found__link {
    align-items: flex-start;
  }
}
`;
