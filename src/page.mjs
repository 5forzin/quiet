// Serialized into the owned browser target. This function has no Node dependencies.
export function pageAction(action, args = {}) {
  const text = (value, length = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
  const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  let state = globalThis.__quietDesktop;
  if (!state) state = globalThis.__quietDesktop = { document: crypto.randomUUID(), refs: new Map(), ids: new WeakMap(), next: 0 };
  const name = element => text(element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || element.innerText || element.getAttribute('title') || element.getAttribute('alt') || element.querySelector('[aria-label]')?.getAttribute('aria-label') || element.querySelector('img[alt]')?.getAttribute('alt'));
  const collect = root => {
    const result = [...root.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')];
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) result.push(...collect(element.shadowRoot));
    return result;
  };
  if (action === 'read') {
    state.refs.clear();
    const elements = collect(document).filter(visible).slice(0, args.limit ?? 120).map(element => {
      if (!state.ids.has(element)) state.ids.set(element, ++state.next);
      const ref = `${state.document}:${state.ids.get(element)}`;
      state.refs.set(ref, element);
      const secret = element.type === 'password' || element.autocomplete === 'one-time-code';
      return {
        ref, role: element.getAttribute('role') || element.tagName.toLowerCase(), name: name(element),
        ...(element.hasAttribute('disabled') ? { disabled: true } : {}),
        ...(element.href ? { href: element.href } : {}),
        ...('value' in element && !secret ? { value: text(element.value, 250) } : {})
      };
    });
    return { url: location.href, title: document.title, text: text(document.body?.innerText, args.maxText ?? 5000), elements, frames: document.querySelectorAll('iframe').length };
  }
  const element = state.refs.get(args.ref);
  if (!element || !element.isConnected) throw new Error('Stale element reference. Read the page again.');
  if (!visible(element) || element.matches(':disabled,[aria-disabled="true"]')) throw new Error('Element is hidden or disabled.');
  if (action === 'fill') {
    if (element.type === 'password' || element.type === 'file') throw new Error('Password and file fields require a dedicated workflow.');
    if (element.readOnly) throw new Error('Field is read-only.');
    if (element.isContentEditable) element.textContent = args.text;
    else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error('Element is not a text field.');
      setter.call(element, args.text);
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: args.text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { verified: (element.isContentEditable ? element.textContent : element.value) === args.text, action: 'fill' };
  }
  if (action === 'select') {
    if (!(element instanceof HTMLSelectElement)) throw new Error('Element is not a select field.');
    element.value = args.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { verified: element.value === args.value, action: 'select' };
  }
  if (action === 'click') {
    const link = element.closest('a[href]');
    if (link) return { navigate: link.href };
    const before = text(document.body?.innerText, 10000);
    element.click();
    return { action: 'click', dispatched: true, changedImmediately: before !== text(document.body?.innerText, 10000), verified: false, note: 'Read or wait to verify the intended result.' };
  }
  throw new Error('Unsupported page action.');
}
