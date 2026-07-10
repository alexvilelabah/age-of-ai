// Pequenos utilitários de DOM e notificações (toasts).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

let toastBox: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  if (!toastBox) {
    toastBox = el('div');
    toastBox.id = 'toasts';
    document.body.appendChild(toastBox);
  }
  const item = el('div', `toast ${kind}`, message);
  toastBox.appendChild(item);
  while (toastBox.children.length > 5) toastBox.firstChild?.remove();
  window.setTimeout(() => {
    item.classList.add('out');
    window.setTimeout(() => item.remove(), 450);
  }, 4000);
}
