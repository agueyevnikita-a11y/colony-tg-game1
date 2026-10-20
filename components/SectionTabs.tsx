'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { GameIcon } from '@/components/GameIcon';
import '@/app/section-tabs.css';

type Props = {
  label: string;
  items: readonly { key: string; label: string; icon?: string; badge?: number }[];
  value: string;
  onChange: (key: string) => void;
};

/** Move only the horizontal strip, leaving the page's vertical position intact. */
function centerButton(container: HTMLDivElement, button: HTMLButtonElement, smooth: boolean) {
  const containerRect = container.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const left = Math.max(0, Math.min(container.scrollWidth - container.clientWidth,
    container.scrollLeft + buttonRect.left - containerRect.left - (container.clientWidth - buttonRect.width) / 2));
  if (Math.abs(container.scrollLeft - left) < 1) return;
  container.scrollTo({ left, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}

export function SectionTabs({ label, items, value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousValue = useRef<string | null>(null);
  const itemKeys = items.map((item) => item.key).join('\0');

  useEffect(() => {
    const container = containerRef.current;
    const button = buttonRefs.current.get(value);
    if (!container || !button) return;
    centerButton(container, button, previousValue.current !== null && previousValue.current !== value);
    previousValue.current = value;
    let containerWidth = container.clientWidth, buttonWidth = button.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (containerWidth === container.clientWidth && buttonWidth === button.offsetWidth) return;
      containerWidth = container.clientWidth;
      buttonWidth = button.offsetWidth;
      centerButton(container, button, false);
    });
    observer.observe(container);
    observer.observe(button);
    return () => observer.disconnect();
  }, [value, itemKeys]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, currentKey: string) {
    const index = items.findIndex((item) => item.key === currentKey);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % items.length
      : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length : -1;
    if (next < 0 || items.length === 0) return;
    const button = buttonRefs.current.get(items[next].key);
    if (!button) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    if (containerRef.current) centerButton(containerRef.current, button, false);
  }

  if (!items.length) return null;

  return <nav className="sectionTabs" aria-label={label}>
    <div className="sectionTabsStrip" ref={containerRef}>
      {items.map((item) => {
        const count = typeof item.badge === 'number' && Number.isFinite(item.badge) && item.badge > 0 ? Math.floor(item.badge) : 0;
        return <button type="button" className={`sectionTab${item.key === value ? ' isActive' : ''}`} key={item.key}
          ref={(element) => { if (element) buttonRefs.current.set(item.key, element); else buttonRefs.current.delete(item.key); }}
          aria-pressed={item.key === value} data-section-tab={item.key}
          onClick={() => onChange(item.key)} onKeyDown={(event) => moveFocus(event, item.key)}>
          {item.icon && <GameIcon name={item.icon} size={16} />}<span>{item.label}</span>
          {count > 0 && <span className="sectionTabBadge" aria-label={`Количество: ${count}`}>{count > 99 ? '99+' : count}</span>}
        </button>;
      })}
    </div>
  </nav>;
}
