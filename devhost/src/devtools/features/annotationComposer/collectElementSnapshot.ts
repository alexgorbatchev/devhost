import type { IAnnotationMarkerPayload, ISelectedElementDraft } from "./types";

const DEFAULT_STYLE_VALUES: ReadonlySet<string> = new Set([
  "none",
  "normal",
  "auto",
  "0px",
  "rgba(0, 0, 0, 0)",
  "transparent",
  "static",
  "visible",
]);
const TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "li",
  "td",
  "th",
  "blockquote",
  "figcaption",
  "caption",
  "legend",
  "dt",
  "dd",
  "pre",
  "code",
  "em",
  "strong",
  "b",
  "i",
  "a",
  "time",
  "cite",
  "q",
]);
const FORM_INPUT_ELEMENTS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);
const MEDIA_ELEMENTS: ReadonlySet<string> = new Set(["img", "video", "canvas", "svg"]);
const CONTAINER_ELEMENTS: ReadonlySet<string> = new Set([
  "div",
  "section",
  "article",
  "nav",
  "header",
  "footer",
  "aside",
  "main",
  "ul",
  "ol",
  "form",
  "fieldset",
]);
const FORENSIC_PROPERTIES: readonly string[] = [
  "color",
  "backgroundColor",
  "borderColor",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "width",
  "height",
  "padding",
  "margin",
  "border",
  "borderRadius",
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "zIndex",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
  "opacity",
  "visibility",
  "overflow",
  "boxShadow",
  "transform",
];

export interface IIdentifiedElement {
  name: string;
  path: string;
}

export function collectElementSnapshot(draft: ISelectedElementDraft): IAnnotationMarkerPayload {
  const boundingBox = readBoundingBox(draft.element);

  return {
    accessibility: getAccessibilityInfo(draft.element),
    boundingBox,
    computedStyles: getForensicComputedStyles(draft.element),
    computedStylesObj: getDetailedComputedStyles(draft.element),
    cssClasses: getElementClasses(draft.element),
    element: draft.elementName,
    elementPath: draft.elementPath,
    fullPath: getFullElementPath(draft.element),
    isFixed: isElementFixed(draft.element),
    markerNumber: draft.markerNumber,
    nearbyElements: getNearbyElements(draft.element),
    nearbyText: getNearbyText(draft.element),
    selectedText: draft.selectedText,
  };
}

export function identifyElement(target: HTMLElement): IIdentifiedElement {
  const path: string = getElementPath(target);
  const tagName: string = target.tagName.toLowerCase();

  if (target.dataset.element !== undefined && target.dataset.element.length > 0) {
    return {
      name: target.dataset.element,
      path,
    };
  }

  if (tagName === "button") {
    const ariaLabel: string | null = target.getAttribute("aria-label");
    const textContent: string = target.textContent?.trim() ?? "";

    if (ariaLabel !== null && ariaLabel.length > 0) {
      return {
        name: `button [${ariaLabel}]`,
        path,
      };
    }

    return {
      name: textContent.length > 0 ? `button "${textContent.slice(0, 25)}"` : "button",
      path,
    };
  }

  if (tagName === "a") {
    const textContent: string = target.textContent?.trim() ?? "";
    const href: string | null = target.getAttribute("href");

    if (textContent.length > 0) {
      return {
        name: `link "${textContent.slice(0, 25)}"`,
        path,
      };
    }

    if (href !== null && href.length > 0) {
      return {
        name: `link to ${href.slice(0, 30)}`,
        path,
      };
    }

    return {
      name: "link",
      path,
    };
  }

  if (tagName === "input") {
    const type: string = target.getAttribute("type") ?? "text";
    const placeholder: string | null = target.getAttribute("placeholder");
    const name: string | null = target.getAttribute("name");

    if (placeholder !== null && placeholder.length > 0) {
      return {
        name: `input "${placeholder}"`,
        path,
      };
    }

    if (name !== null && name.length > 0) {
      return {
        name: `input [${name}]`,
        path,
      };
    }

    return {
      name: `${type} input`,
      path,
    };
  }

  if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
    const textContent: string = target.textContent?.trim() ?? "";

    return {
      name: textContent.length > 0 ? `${tagName} "${textContent.slice(0, 35)}"` : tagName,
      path,
    };
  }

  if (tagName === "p") {
    const textContent: string = target.textContent?.trim() ?? "";

    if (textContent.length > 0) {
      const truncatedText: string = textContent.length > 40 ? `${textContent.slice(0, 40)}...` : textContent;

      return {
        name: `paragraph: "${truncatedText}"`,
        path,
      };
    }

    return {
      name: "paragraph",
      path,
    };
  }

  if (tagName === "span" || tagName === "label") {
    const textContent: string = target.textContent?.trim() ?? "";

    if (textContent.length > 0 && textContent.length < 40) {
      return {
        name: `"${textContent}"`,
        path,
      };
    }

    return {
      name: tagName,
      path,
    };
  }

  if (tagName === "li") {
    const textContent: string = target.textContent?.trim() ?? "";

    if (textContent.length > 0 && textContent.length < 40) {
      return {
        name: `list item: "${textContent.slice(0, 35)}"`,
        path,
      };
    }

    return {
      name: "list item",
      path,
    };
  }

  if (["div", "section", "article", "nav", "header", "footer", "aside", "main"].includes(tagName)) {
    const ariaLabel: string | null = target.getAttribute("aria-label");
    const role: string | null = target.getAttribute("role");
    const directTextContent: string = getDirectTextContent(target);

    if (ariaLabel !== null && ariaLabel.length > 0) {
      return {
        name: `${tagName} [${ariaLabel}]`,
        path,
      };
    }

    if (role !== null && role.length > 0) {
      return {
        name: role,
        path,
      };
    }

    if (directTextContent.length > 0 && directTextContent.length < 50) {
      return {
        name: `"${directTextContent}"`,
        path,
      };
    }

    const className: string = typeof target.className === "string" ? target.className : "";
    const classWords: string[] = className
      .split(/[\s_-]+/)
      .map((value: string): string => value.replace(/[A-Z0-9]{5,}.*$/, ""))
      .filter((value: string): boolean => value.length > 2 && !/^[a-z]{1,2}$/.test(value))
      .slice(0, 2);

    if (classWords.length > 0) {
      return {
        name: classWords.join(" "),
        path,
      };
    }

    return {
      name: tagName === "div" ? "container" : tagName,
      path,
    };
  }

  return {
    name: tagName,
    path,
  };
}

export function isElementFixed(element: HTMLElement): boolean {
  let currentElement: HTMLElement | null = element;

  while (currentElement !== null && currentElement !== document.body) {
    const computedStyle: CSSStyleDeclaration = window.getComputedStyle(currentElement);
    const position: string = computedStyle.position;

    if (position === "fixed" || position === "sticky") {
      return true;
    }

    currentElement = currentElement.parentElement;
  }

  return false;
}

function readBoundingBox(element: HTMLElement): IAnnotationMarkerPayload["boundingBox"] {
  const elementRectangle: DOMRect = element.getBoundingClientRect();
  const elementIsFixed: boolean = isElementFixed(element);

  return {
    height: elementRectangle.height,
    width: elementRectangle.width,
    x: elementRectangle.left,
    y: elementIsFixed ? elementRectangle.top : elementRectangle.top + window.scrollY,
  };
}

function getParentElement(element: Element): Element | null {
  if (element.parentElement !== null) {
    return element.parentElement;
  }

  const rootNode: Node = element.getRootNode();

  if (rootNode instanceof ShadowRoot) {
    return rootNode.host;
  }

  return null;
}

function getElementPath(target: HTMLElement, maxDepth: number = 4): string {
  const parts: string[] = [];
  let currentElement: HTMLElement | null = target;
  let depth: number = 0;

  while (currentElement !== null && depth < maxDepth) {
    const tagName: string = currentElement.tagName.toLowerCase();

    if (tagName === "html" || tagName === "body") {
      break;
    }

    let identifier: string = tagName;

    if (currentElement.id.length > 0) {
      identifier = `#${currentElement.id}`;
    } else if (typeof currentElement.className === "string" && currentElement.className.length > 0) {
      const meaningfulClass: string | undefined = currentElement.className
        .split(/\s+/)
        .find((value: string): boolean => value.length > 2 && !/^[a-z]{1,2}$/.test(value) && !/[A-Z0-9]{5,}/.test(value));

      if (meaningfulClass !== undefined) {
        identifier = `.${meaningfulClass.split("_")[0]}`;
      }
    }

    const nextParent: Element | null = getParentElement(currentElement);

    if (currentElement.parentElement === null && nextParent !== null) {
      identifier = `⟨shadow⟩ ${identifier}`;
    }

    parts.unshift(identifier);
    currentElement = nextParent instanceof HTMLElement ? nextParent : null;
    depth += 1;
  }

  return parts.join(" > ");
}

function getDirectTextContent(element: HTMLElement): string {
  const parts: string[] = [];

  for (const childNode of element.childNodes) {
    if (childNode.nodeType !== Node.TEXT_NODE) {
      continue;
    }

    const textContent: string = childNode.textContent?.trim() ?? "";

    if (textContent.length > 0) {
      parts.push(textContent);
    }
  }

  return parts.join(" ");
}

function getNearbyText(element: HTMLElement): string {
  const texts: string[] = [];
  const ownText: string = element.textContent?.trim() ?? "";

  if (ownText.length > 0 && ownText.length < 100) {
    texts.push(ownText);
  }

  const previousElementSibling: Element | null = element.previousElementSibling;
  const nextElementSibling: Element | null = element.nextElementSibling;

  if (previousElementSibling instanceof HTMLElement) {
    const previousText: string = previousElementSibling.textContent?.trim() ?? "";

    if (previousText.length > 0 && previousText.length < 50) {
      texts.unshift(`[before: "${previousText.slice(0, 40)}"]`);
    }
  }

  if (nextElementSibling instanceof HTMLElement) {
    const nextText: string = nextElementSibling.textContent?.trim() ?? "";

    if (nextText.length > 0 && nextText.length < 50) {
      texts.push(`[after: "${nextText.slice(0, 40)}"]`);
    }
  }

  return texts.join(" ");
}

function getNearbyElements(element: HTMLElement): string {
  const parentElement: Element | null = getParentElement(element);

  if (!(parentElement instanceof HTMLElement)) {
    return "";
  }

  const siblingElements: HTMLElement[] = Array.from(parentElement.children).filter(
    (childElement: Element): childElement is HTMLElement => {
      return childElement !== element && childElement instanceof HTMLElement;
    },
  );

  if (siblingElements.length === 0) {
    return "";
  }

  const siblingIdentifiers: string[] = siblingElements.slice(0, 4).map((siblingElement: HTMLElement): string => {
    const tagName: string = siblingElement.tagName.toLowerCase();
    const className: string = typeof siblingElement.className === "string" ? siblingElement.className : "";
    const meaningfulClass: string | undefined = className
      .split(/\s+/)
      .map((value: string): string => value.replace(/[_][a-zA-Z0-9]{5,}.*$/, ""))
      .find((value: string): boolean => value.length > 2 && !/^[a-z]{1,2}$/.test(value));
    const classSuffix: string = meaningfulClass === undefined ? "" : `.${meaningfulClass}`;

    if (tagName === "button" || tagName === "a") {
      const textContent: string = siblingElement.textContent?.trim().slice(0, 15) ?? "";

      if (textContent.length > 0) {
        return `${tagName}${classSuffix} "${textContent}"`;
      }
    }

    return `${tagName}${classSuffix}`;
  });
  const parentTagName: string = parentElement.tagName.toLowerCase();
  const parentClassName: string = typeof parentElement.className === "string" ? parentElement.className : "";
  const parentMeaningfulClass: string | undefined = parentClassName
    .split(/\s+/)
    .map((value: string): string => value.replace(/[_][a-zA-Z0-9]{5,}.*$/, ""))
    .find((value: string): boolean => value.length > 2 && !/^[a-z]{1,2}$/.test(value));
  const parentIdentifier: string = parentMeaningfulClass === undefined ? parentTagName : `.${parentMeaningfulClass}`;
  const totalChildren: number = parentElement.children.length;
  const suffix: string =
    totalChildren > siblingIdentifiers.length + 1 ? ` (${totalChildren} total in ${parentIdentifier})` : "";

  return `${siblingIdentifiers.join(", ")}${suffix}`;
}

function getElementClasses(target: HTMLElement): string {
  const className: string = typeof target.className === "string" ? target.className : "";

  if (className.length === 0) {
    return "";
  }

  const classes: string[] = className
    .split(/\s+/)
    .filter((value: string): boolean => value.length > 0)
    .map((value: string): string => {
      const match: RegExpMatchArray | null = value.match(/^([a-zA-Z][a-zA-Z0-9_-]*?)(?:_[a-zA-Z0-9]{5,})?$/);

      return match?.[1] ?? value;
    })
    .filter((value: string, index: number, values: string[]): boolean => values.indexOf(value) === index);

  return classes.join(", ");
}

function getDetailedComputedStyles(target: HTMLElement): Record<string, string> {
  const computedStyles: CSSStyleDeclaration = window.getComputedStyle(target);
  const result: Record<string, string> = {};
  const tagName: string = target.tagName.toLowerCase();
  let properties: string[] = [];

  if (TEXT_ELEMENTS.has(tagName)) {
    properties = ["color", "fontSize", "fontWeight", "fontFamily", "lineHeight"];
  } else if (tagName === "button" || (tagName === "a" && target.getAttribute("role") === "button")) {
    properties = ["backgroundColor", "color", "padding", "borderRadius", "fontSize"];
  } else if (FORM_INPUT_ELEMENTS.has(tagName)) {
    properties = ["backgroundColor", "color", "padding", "borderRadius", "fontSize"];
  } else if (MEDIA_ELEMENTS.has(tagName)) {
    properties = ["width", "height", "objectFit", "borderRadius"];
  } else if (CONTAINER_ELEMENTS.has(tagName)) {
    properties = ["display", "padding", "margin", "gap", "backgroundColor"];
  } else {
    properties = ["color", "fontSize", "margin", "padding", "backgroundColor"];
  }

  for (const property of properties) {
    const cssPropertyName: string = property.replace(/([A-Z])/g, "-$1").toLowerCase();
    const value: string = computedStyles.getPropertyValue(cssPropertyName);

    if (value.length > 0 && !DEFAULT_STYLE_VALUES.has(value)) {
      result[property] = value;
    }
  }

  return result;
}

function getForensicComputedStyles(target: HTMLElement): string {
  const computedStyles: CSSStyleDeclaration = window.getComputedStyle(target);
  const parts: string[] = [];

  for (const property of FORENSIC_PROPERTIES) {
    const cssPropertyName: string = property.replace(/([A-Z])/g, "-$1").toLowerCase();
    const value: string = computedStyles.getPropertyValue(cssPropertyName);

    if (value.length > 0 && !DEFAULT_STYLE_VALUES.has(value)) {
      parts.push(`${cssPropertyName}: ${value}`);
    }
  }

  return parts.join("; ");
}

function getAccessibilityInfo(target: HTMLElement): string {
  const parts: string[] = [];
  const role: string | null = target.getAttribute("role");
  const ariaLabel: string | null = target.getAttribute("aria-label");
  const ariaDescribedBy: string | null = target.getAttribute("aria-describedby");
  const tabIndex: string | null = target.getAttribute("tabindex");
  const ariaHidden: string | null = target.getAttribute("aria-hidden");

  if (role !== null && role.length > 0) {
    parts.push(`role="${role}"`);
  }

  if (ariaLabel !== null && ariaLabel.length > 0) {
    parts.push(`aria-label="${ariaLabel}"`);
  }

  if (ariaDescribedBy !== null && ariaDescribedBy.length > 0) {
    parts.push(`aria-describedby="${ariaDescribedBy}"`);
  }

  if (tabIndex !== null && tabIndex.length > 0) {
    parts.push(`tabindex=${tabIndex}`);
  }

  if (ariaHidden === "true") {
    parts.push("aria-hidden");
  }

  if (target.matches("a, button, input, select, textarea, [tabindex]")) {
    parts.push("focusable");
  }

  return parts.join(", ");
}

function getFullElementPath(target: HTMLElement): string {
  const parts: string[] = [];
  let currentElement: HTMLElement | null = target;

  while (currentElement !== null && currentElement.tagName.toLowerCase() !== "html") {
    const tagName: string = currentElement.tagName.toLowerCase();
    let identifier: string = tagName;

    if (currentElement.id.length > 0) {
      identifier = `${tagName}#${currentElement.id}`;
    } else if (typeof currentElement.className === "string" && currentElement.className.length > 0) {
      const className: string | undefined = currentElement.className
        .split(/\s+/)
        .map((value: string): string => value.replace(/[_][a-zA-Z0-9]{5,}.*$/, ""))
        .find((value: string): boolean => value.length > 2);

      if (className !== undefined) {
        identifier = `${tagName}.${className}`;
      }
    }

    const nextParent: Element | null = getParentElement(currentElement);

    if (currentElement.parentElement === null && nextParent !== null) {
      identifier = `⟨shadow⟩ ${identifier}`;
    }

    parts.unshift(identifier);
    currentElement = nextParent instanceof HTMLElement ? nextParent : null;
  }

  return parts.join(" > ");
}
