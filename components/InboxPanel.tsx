'use client';

import { useEffect, useRef, useState } from 'react';
import { GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { isInboxPage, inboxMessageAppearance, type InboxFilter, type InboxPage, type InboxPageQuery } from '@/lib/game/inbox';
import '@/app/inbox.css';

type Props = {
  initialInbox?: InboxPage;
  busy: boolean;
  onLoadPage: (query: InboxPageQuery) => Promise<InboxPage>;
  onRead: (ids: string[]) => Promise<{ total: number; unread: number } | void>;
};

const PAGE_SIZE = 5;
const n = (value: number) => value.toLocaleString('ru-RU');
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

export function InboxPanel({ initialInbox, busy, onLoadPage, onRead }: Props) {
  const [page, setPage] = useState<InboxPage | null>(() => isInboxPage(initialInbox) ? initialInbox : null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const pendingRef = useRef(false);
  const loadRef = useRef(onLoadPage);
  loadRef.current = onLoadPage;
  const mountedRef = useRef(true);

  useEffect(() => {
    let current = true;
    mountedRef.current = true;
    if (!isInboxPage(initialInbox)) {
      setLoading(true);
      pendingRef.current = true;
      loadRef.current({ filter: 'all', limit: PAGE_SIZE }).then(result => {
        if (!isInboxPage(result)) throw new Error('Почта пришла не полностью. Повтори загрузку.');
        if (current) setPage(result);
      }).catch(cause => {
        if (current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить почту. Попробуй ещё раз.');
      }).finally(() => {
        if (current) { pendingRef.current = false; setLoading(false); }
      });
    }
    return () => { current = false; mountedRef.current = false; };
    // Background game refreshes must not reset the page the player is reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const total = initialInbox?.total;
    const unread = initialInbox?.unread;
    if (!Number.isFinite(unread)) return;
    setPage(previous => previous && {
      ...previous,
      total: Number.isFinite(total) ? Number(total) : previous.total,
      unread: Number(unread),
      matchingTotal: previous.filter === 'unread' ? Number(unread) : Number.isFinite(total) ? Number(total) : previous.matchingTotal,
    });
    // Only counters follow background sessions. Keep the letters, cursor and
    // navigation history stable until the player explicitly changes the page.
  }, [initialInbox?.total, initialInbox?.unread]);

  async function load(nextFilter: InboxFilter, nextIndex: number, cursor: string | null, reset = false) {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setLoading(true);
    setError('');
    setFeedback('');
    try {
      const result = await onLoadPage({ filter: nextFilter, limit: PAGE_SIZE, cursor });
      if (!isInboxPage(result)) throw new Error('Почта пришла не полностью. Повтори загрузку.');
      if (!mountedRef.current) return;
      setPage(result);
      setFilter(nextFilter);
      setPageIndex(nextIndex);
      setCursors(previous => reset ? [null] : [...previous.slice(0, nextIndex), cursor]);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить почту. Попробуй ещё раз.');
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }

  async function markRead(ids: string[]) {
    if (!ids.length || pendingRef.current || busy) return;
    pendingRef.current = true;
    setReading(true);
    setError('');
    setFeedback('');
    try {
      const counts = await onRead(ids);
      if (!mountedRef.current) return;
      // Keep this snapshot in place, including in the unread filter. The next
      // page uses its original cursor, so removing unread rows cannot skip mail.
      const readAt = new Date().toISOString();
      const selected = new Set(ids);
      setPage(previous => previous && {
        ...previous,
        items: previous.items.map(item => selected.has(item.id) && !item.read_at ? { ...item, read_at: readAt } : item),
        total: counts?.total ?? previous.total,
        unread: counts?.unread ?? Math.max(0, previous.unread - previous.items.filter(item => selected.has(item.id) && !item.read_at).length),
        matchingTotal: previous.filter === 'unread'
          ? counts?.unread ?? Math.max(0, previous.matchingTotal - previous.items.filter(item => selected.has(item.id) && !item.read_at).length)
          : counts?.total ?? previous.matchingTotal,
      });
      setFeedback(ids.length === 1 ? 'Сообщение отмечено прочитанным.' : 'Сообщения этой страницы отмечены прочитанными.');
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'Не удалось отметить сообщения. Попробуй ещё раз.');
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setReading(false);
    }
  }

  const blocked = busy || loading || reading;
  const visibleUnread = page?.items.filter(item => !item.read_at).map(item => item.id) ?? [];

  return <section className="card inboxPanel" aria-busy={loading || reading}>
    <div className="inboxHeading"><div><h2><GameIcon name="mail" />Почта колонии</h2><p>Результаты событий, награды и важные сообщения.</p></div><span className="pill">{n(page?.unread ?? initialInbox?.unread ?? 0)} новых</span></div>
    <div className="inboxToolbar"><div className="inboxFilters" role="group" aria-label="Фильтр сообщений"><button className={filter === 'all' ? 'isActive' : ''} aria-pressed={filter === 'all'} disabled={blocked} onClick={() => load('all', 0, null, true)}>Все{page ? ` · ${n(page.total)}` : ''}</button><button className={filter === 'unread' ? 'isActive' : ''} aria-pressed={filter === 'unread'} disabled={blocked} onClick={() => load('unread', 0, null, true)}>Непрочитанные</button></div><button className="miniButton inboxRefresh" aria-label="Обновить почту" title="Обновить почту" disabled={blocked} onClick={() => load(filter, 0, null, true)}><GameIcon name="refresh" size={17} /></button></div>
    <MechanicGuide steps={[
      'Открой письмо, чтобы посмотреть подробности результата или покупки. Сам просмотр ничего не списывает и не выдаёт награду повторно.',
      'Отметь прочитанным отдельное письмо или только сообщения этой страницы. Открытие само по себе не меняет счётчик.',
      'Фильтр «Непрочитанные» помогает найти новое. Кнопка обновления загрузит актуальную первую страницу.',
    ]} />
    {error && <div className="notice error inboxError" role="alert"><span>{error}</span><button type="button" className="miniButton" disabled={blocked} onClick={() => load(filter, pageIndex, cursors[pageIndex] ?? null)}>Повторить загрузку</button></div>}
    {feedback && <div className="notice" role="status">{feedback}</div>}
    {loading && <p className="inboxStatus" role="status">Загружаем сообщения…</p>}
    {page && !page.items.length && <div className="inboxEmpty"><GameIcon name="mail" size={32} /><strong>{filter === 'unread' ? 'Все сообщения прочитаны' : 'Пока нет сообщений'}</strong><p>{filter === 'unread' ? 'Старые письма доступны в разделе «Все».' : 'Здесь появятся важные результаты и новости твоей колонии.'}</p>{filter === 'unread' && <button className="miniButton" disabled={blocked} onClick={() => load('all', 0, null, true)}>Открыть все сообщения</button>}</div>}
    {page && page.items.length > 0 && <>
      <div className="inboxMessages">{page.items.map(item => <article className={`inboxMessage ${item.read_at ? 'isRead' : 'isUnread'}`} key={item.id}>
        <details><summary><span className="inboxMessageIcon"><GameIcon name={inboxMessageAppearance(item.kind).icon} size={21} /></span><span className="inboxMessageHeading"><strong>{item.title}</strong><span><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time><span className={item.read_at ? 'inboxReadLabel' : 'inboxNewLabel'}>{item.read_at ? 'Прочитано' : 'Новое'}</span><span>{inboxMessageAppearance(item.kind).label}</span></span></span><GameIcon name="arrow" size={16} /></summary><div className="inboxMessageBody"><p>{item.body}</p>{!item.read_at && <button className="miniButton" disabled={blocked} onClick={() => markRead([item.id])}><GameIcon name="check" size={15} />Отметить прочитанным</button>}</div></details>
      </article>)}</div>
      {visibleUnread.length > 0 && <button className="miniButton inboxReadPage" disabled={blocked} onClick={() => markRead(visibleUnread)}>{reading ? 'Отмечаем…' : 'Отметить эту страницу прочитанной'}</button>}
      {(pageIndex > 0 || page.hasMore) && <nav className="inboxPagination" aria-label="Страницы почты"><button className="miniButton" disabled={blocked || pageIndex === 0} onClick={() => load(filter, pageIndex - 1, cursors[pageIndex - 1])}>Назад</button><span>Страница {pageIndex + 1}</span><button className="miniButton" disabled={blocked || !page.hasMore || !page.nextCursor} onClick={() => load(filter, pageIndex + 1, page.nextCursor)}>Далее</button></nav>}
      <p className="inboxPageNote">Показано {page.items.length} сообщений. {filter === 'unread' ? `Непрочитанных: ${n(page.unread)}.` : `Всего: ${n(page.total)}.`}</p>
    </>}
  </section>;
}
