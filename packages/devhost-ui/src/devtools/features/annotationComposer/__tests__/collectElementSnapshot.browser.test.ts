import { assert, describe, expect, it } from "vitest";

import { placeElement } from "../../../../../test-support/hostPageUtils";
import { collectElementSnapshot, identifyElement, isElementFixed } from "../collectElementSnapshot";

function selectElement(markup: string): HTMLElement {
  const container = document.createElement("section");
  container.id = "fixture";
  container.innerHTML = markup;
  document.body.append(container);
  const element = container.firstElementChild;
  assert(element instanceof HTMLElement);
  return element;
}

function snapshot(element: HTMLElement) {
  const identity = identifyElement(element);
  return collectElementSnapshot({
    element,
    elementName: identity.name,
    elementPath: identity.path,
    markerNumber: 3,
    selectedText: "Selected words",
    sourceLocation: { fileName: "src/Checkout.tsx", lineNumber: 12 },
  });
}

describe("annotation element identity", () => {
  it.each([
    ['<button data-element="Pay now">Checkout</button>', "Pay now"],
    ['<button aria-label="Confirm payment">Pay</button>', "button [Confirm payment]"],
    ["<button>Pay</button>", 'button "Pay"'],
    ["<button></button>", "button"],
    ['<a href="/checkout">Checkout</a>', 'link "Checkout"'],
    ['<a href="/checkout"></a>', "link to /checkout"],
    ["<a></a>", "link"],
    ['<input placeholder="Email address" name="email">', 'input "Email address"'],
    ['<input name="email">', "input [email]"],
    ['<input type="checkbox">', "checkbox input"],
    ["<input>", "text input"],
    ["<h2>Order summary</h2>", 'h2 "Order summary"'],
    ["<h2></h2>", "h2"],
    ["<p>Ready to order</p>", 'paragraph: "Ready to order"'],
    ["<p></p>", "paragraph"],
    [
      "<p>One long paragraph explaining how checkout works for a new customer.</p>",
      'paragraph: "One long paragraph explaining how checko..."',
    ],
    ["<label>Email</label>", '"Email"'],
    ["<span></span>", "span"],
    ["<li>Shipping</li>", 'list item: "Shipping"'],
    ["<li></li>", "list item"],
    ['<nav aria-label="Checkout">Steps</nav>', "nav [Checkout]"],
    ['<div role="status">Saved</div>', "status"],
    ["<div>Order <strong>confirmed</strong></div>", '"Order"'],
    ['<div class="order_summary_ABCDE"></div>', "order summary"],
    ["<div></div>", "container"],
    ["<section></section>", "section"],
    ["<textarea></textarea>", "textarea"],
  ])("names the selected host element %s", (markup, name) => {
    expect(identifyElement(selectElement(markup)).name).toBe(name);
  });

  it("keeps a useful path across a shadow boundary and strips generated class suffixes", () => {
    const host = selectElement('<div id="payment-widget"></div>');
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<button class="pay_ABCDE pay_FGHIJ">Pay</button>';
    const button = root.firstElementChild;
    assert(button instanceof HTMLElement);
    const result = snapshot(button);
    expect(result.elementPath).toBe("#fixture > #payment-widget > ⟨shadow⟩ button");
    expect(result.fullPath).toBe("body > section#fixture > div#payment-widget > ⟨shadow⟩ button.pay.pay");
    expect(result.cssClasses).toBe("pay");
    expect(result.element).toBe('button "Pay"');
    expect(result.markerNumber).toBe(3);
    expect(result.selectedText).toBe("Selected words");
    expect(result.sourceLocation).toEqual({ fileName: "src/Checkout.tsx", lineNumber: 12 });
  });
});

describe("annotation snapshot context", () => {
  it("captures accessibility and adjacent context without losing the selected element", () => {
    const parent = selectElement(
      '<div class="actions_ABCDE"><p>Review order</p><button id="pay" role="button" aria-label="Pay now" aria-describedby="terms" tabindex="0" aria-hidden="true">Pay</button><a class="cancel_ABCDE" href="/cart">Cancel</a><span>Help</span><hr><p>Terms</p></div>',
    );
    const button = parent.querySelector("button");
    assert(button);
    const result = snapshot(button);
    expect(result.accessibility).toBe(
      'role="button", aria-label="Pay now", aria-describedby="terms", tabindex=0, aria-hidden, focusable',
    );
    expect(result.nearbyText).toBe('[before: "Review order"] Pay [after: "Cancel"]');
    expect(result.nearbyElements).toBe('p, a.cancel "Cancel", span, hr (6 total in .actions)');
    expect(result.fullPath).toBe("body > section#fixture > div.actions > button#pay");
  });

  it("captures a detached element without inventing parent or sibling context", () => {
    const element = document.createElement("button");
    const result = snapshot(element);
    expect(result.nearbyElements).toBe("");
    expect(result.nearbyText).toBe("");
    expect(result.fullPath).toBe("button");
    expect(result.cssClasses).toBe("");
  });

  it.each(["fixed", "sticky"])("recognizes a %s ancestor and records the real bounds", (position) => {
    const parent = selectElement("<div><button>Pay</button></div>");
    parent.style.position = position;
    const button = parent.querySelector("button");
    assert(button);
    placeElement(button, { x: 60, y: 80, width: 140, height: 40 });
    button.style.position = "absolute";
    expect(isElementFixed(button)).toBe(true);
    const rect = button.getBoundingClientRect();
    expect(snapshot(button).boundingBox).toEqual({ x: rect.left, y: rect.top, width: 140, height: 40 });
  });

  it("records document coordinates for an ordinary element", () => {
    const element = selectElement("<p>Receipt</p>");
    expect(isElementFixed(element)).toBe(false);
    const rect = element.getBoundingClientRect();
    expect(snapshot(element).boundingBox).toEqual({
      x: rect.left,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    });
  });

  it.each([
    ["p", "fontSize", "font-size", "23px"],
    ["button", "padding", "padding", "7px"],
    ["input", "padding", "padding", "9px"],
    ["img", "width", "width", "123px"],
    ["div", "gap", "gap", "11px"],
    ["meter", "margin", "margin", "13px"],
  ])("extracts the live %s element styles for agent context", (tag, property, cssProperty, value) => {
    const element = document.createElement(tag);
    document.body.append(element);
    element.style.setProperty(cssProperty, value);
    expect(snapshot(element).computedStylesObj[property]).toBe(getComputedStyle(element).getPropertyValue(cssProperty));
    element.style.setProperty(cssProperty, "17px");
    expect(snapshot(element).computedStylesObj[property]).toBe("17px");
  });
});
