'use client';

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { GameIcon } from '@/components/GameIcon';
import '@/app/city-sheet.css';

type Props = {
  open: boolean;
  title: string;
  eyebrow?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
};

function preserveStyles(style: CSSStyleDeclaration, properties: string[]) {
  const previous = properties.map((property) => ({
    property,
    value: style.getPropertyValue(property),
    priority: style.getPropertyPriority(property),
  }));
  return () => {
    for (const { property, value, priority } of previous) {
      if (value) style.setProperty(property, value, priority);
      else style.removeProperty(property);
    }
  };
}

export function CityActionSheet({ open, title, eyebrow = 'Выбрано на карте', closeLabel = 'Закрыть действия на карте', onClose, children }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropPressRef = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const root = document.documentElement;
    const body = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const bodyPadding = getComputedStyle(body).paddingRight;
    const restoreRoot = preserveStyles(root.style, ['overflow-x', 'overflow-y', 'overscroll-behavior-x', 'overscroll-behavior-y', 'scroll-behavior']);
    const restoreBody = preserveStyles(body.style, ['position', 'top', 'left', 'right', 'width', 'overflow-x', 'overflow-y', 'overscroll-behavior-x', 'overscroll-behavior-y', 'padding-right']);

    // A fixed body also prevents background scrolling in iOS Telegram webviews.
    root.style.setProperty('overflow', 'hidden');
    root.style.setProperty('overscroll-behavior', 'none');
    root.style.setProperty('scroll-behavior', 'auto');
    body.style.setProperty('position', 'fixed');
    body.style.setProperty('top', `${-scrollY}px`);
    body.style.setProperty('left', '0');
    body.style.setProperty('right', '0');
    body.style.setProperty('width', '100%');
    body.style.setProperty('overflow', 'hidden');
    body.style.setProperty('overscroll-behavior', 'none');
    if (scrollbarWidth > 0) body.style.setProperty('padding-right', `calc(${bodyPadding} + ${scrollbarWidth}px)`);

    if (!dialog.open) dialog.showModal();
    if (contentRef.current) contentRef.current.scrollTop = 0;
    closeRef.current?.focus({ preventScroll: true });

    return () => {
      backdropPressRef.current = false;
      if (dialog.open) dialog.close();
      restoreBody();
      // Keep scroll restoration immediate even when the page uses smooth scrolling.
      root.style.setProperty('overflow', 'auto');
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
      restoreRoot();
    };
  }, [open]);

  function isOutsidePanel(clientX: number, clientY: number) {
    const panel = panelRef.current;
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom;
  }

  return <dialog ref={dialogRef} className="cityActionSheet" aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]',
      )].filter((element) => element.tabIndex >= 0 && !element.matches(':disabled')
        && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
        && getComputedStyle(element).visibility === 'visible');
      // Native dialogs can pass focus through the browser chrome at a Tab edge.
      // Wrap those edges explicitly while leaving normal control navigation native.
      focusable.sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
      const first = focusable[0] ?? closeRef.current;
      const last = focusable.at(-1) ?? closeRef.current;
      const active = document.activeElement;
      if (!panel.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }}
    onPointerDown={(event) => {
      backdropPressRef.current = event.target === event.currentTarget && isOutsidePanel(event.clientX, event.clientY);
    }}
    onPointerCancel={() => { backdropPressRef.current = false; }}
    onClick={(event) => {
      const close = backdropPressRef.current && event.target === event.currentTarget && isOutsidePanel(event.clientX, event.clientY);
      backdropPressRef.current = false;
      if (close) onClose();
    }}>
    <div ref={panelRef} className="cityActionSheetPanel">
      <header className="cityActionSheetHeader">
        <h2 id={`${id}-title`} className="cityActionSheetTitle">{title}</h2>
        <span className="cityActionSheetEyebrow" aria-hidden="true">{eyebrow}</span>
        <button ref={closeRef} type="button" autoFocus className="cityActionSheetClose" onClick={onClose} aria-label={closeLabel}>
          <GameIcon name="close" size={20} /><span>Закрыть</span>
        </button>
      </header>
      <div ref={contentRef} className="cityActionSheetContent">{children}</div>
    </div>
  </dialog>;
}
