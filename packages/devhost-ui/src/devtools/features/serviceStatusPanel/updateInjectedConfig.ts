// Returns the injected configuration after a health message. devhost sends its current configuration with each
// one, so an edit to the manifest reaches the page without a reload. Readers tell a change by the object's identity:
// a changed configuration replaces the object, and an unchanged one keeps the current object.
export function updateInjectedConfig(sentConfig: object | undefined, injectedConfig: unknown): unknown {
  if (sentConfig === undefined) {
    return injectedConfig;
  }

  // Both come from the same encoder, so equal configurations encode to the same text.
  if (JSON.stringify(sentConfig) === JSON.stringify(injectedConfig)) {
    return injectedConfig;
  }

  return sentConfig;
}
