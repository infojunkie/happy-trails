type AttrValue = string | number | boolean | null | undefined;

/** Query helper that throws early if the markup and code drift apart. */
export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node as T;
}

/**
 * Small createElement helper. Attribute values are set with `setAttribute`,
 * except for `class` and `text`; text always goes through `textContent`, so
 * database values can never be interpreted as HTML.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') {
      node.className = String(value);
    } else if (name === 'text') {
      node.textContent = String(value);
    } else {
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  node.append(...children);
  return node;
}
