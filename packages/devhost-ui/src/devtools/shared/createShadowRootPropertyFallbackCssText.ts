export interface IRegisteredCustomProperty {
  inherits: boolean;
  initialValue: string | null;
  name: string;
}

/**
 * Builds the `@layer properties` fallback that gives Tailwind's `--tw-*` custom properties their defaults inside the
 * devtools shadow root.
 *
 * Browsers ignore `@property` registrations declared in a shadow root stylesheet, so variables such as
 * `--tw-border-style` or `--tw-shadow` stay undefined there and every border, ring, and shadow utility that reads
 * them computes to nothing. Tailwind emits the same fallback for browsers without `@property`, but gates it behind
 * `@supports`; inside a shadow root it must apply unconditionally. Non-inherited properties are declared on every
 * element (mirroring `@property` initial values) in the lowest layer, so utilities still override them.
 */
export function createShadowRootPropertyFallbackCssText(properties: IRegisteredCustomProperty[]): string {
  const declaredProperties: IRegisteredCustomProperty[] = properties.filter(
    (property: IRegisteredCustomProperty): boolean => property.initialValue !== null,
  );

  if (declaredProperties.length === 0) {
    return "";
  }

  const elementDeclarations: string = createDeclarations(
    declaredProperties.filter((property: IRegisteredCustomProperty): boolean => !property.inherits),
  );
  const hostDeclarations: string = createDeclarations(
    declaredProperties.filter((property: IRegisteredCustomProperty): boolean => property.inherits),
  );
  const elementRule: string =
    elementDeclarations.length > 0 ? ` *, ::before, ::after, ::backdrop { ${elementDeclarations} }` : "";
  const hostRule: string = hostDeclarations.length > 0 ? ` :host { ${hostDeclarations} }` : "";

  return `@layer properties {${elementRule}${hostRule} }`;
}

function createDeclarations(properties: IRegisteredCustomProperty[]): string {
  return properties
    .map((property: IRegisteredCustomProperty): string => `${property.name}: ${property.initialValue};`)
    .join(" ");
}
