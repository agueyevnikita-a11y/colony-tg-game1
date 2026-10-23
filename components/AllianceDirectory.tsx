'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GameIcon } from '@/components/GameIcon';
import type { AllianceDirectoryItem, AllianceDirectoryState } from '@/lib/game/alliance-directory';

type Props = {
  initial: AllianceDirectoryState;
  busy: boolean;
  joinIssue: string;
  pendingJoin: string;
  onSearch?: (query: string, page: number) => Promise<AllianceDirectoryState>;
  onJoin: (entry: AllianceDirectoryItem) => void;
  renderFeedback: (id: string) => ReactNode;
};
const n = (value: number) => Number(value).toLocaleString('ru-RU');

export function AllianceDirectory({ initial, busy, joinIssue, pendingJoin, onSearch, onJoin, renderFeedback }: Props) {
  const [query, setQuery] = useState(initial.query);
  const [result, setResult] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const searched = useRef(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const locked = busy || pending;

  useEffect(() => { if (!searched.current) setResult(initial); }, [initial]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function search(nextQuery: string, page = 0) {
    if (!onSearch || locked || guard.current) return;
    guard.current = true; setPending(true); setError('');
    try {
      const data = await onSearch(nextQuery.trim(), page);
      if (!data || !Array.isArray(data.items) || !Number.isInteger(data.page) || typeof data.query !== 'string') throw new Error('Не удалось прочитать список альянсов. Попробуй обновить его.');
      if (!mounted.current) return;
      searched.current = true;
      setResult(data); setQuery(data.query); setNow(Date.now());
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Не удалось найти альянсы. Попробуй ещё раз.');
    } finally {
      guard.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <div className="allianceDirectory" data-alliance-directory>
    <form className="allianceDirectorySearch" onSubmit={event => { event.preventDefault(); void search(query); }}>
      <label htmlFor="alliance-directory-query">Название или код<input id="alliance-directory-query" type="search" value={query} maxLength={64} autoComplete="off" disabled={locked || !onSearch} placeholder="Найти свою команду" onChange={event => setQuery(event.target.value)} /></label>
      <button type="submit" className="miniButton" disabled={locked || !onSearch}>{pending ? 'Ищем…' : 'Найти'}</button>
    </form>
    <div className="allianceDirectoryTools"><span>{result.query ? <>Поиск: «{result.query}»</> : 'Альянсы со свободными местами'}</span>{onSearch && <button type="button" className="miniButton" disabled={locked} onClick={() => { void search(result.query, result.page); }}>Обновить</button>}{result.query && onSearch && <button type="button" className="miniButton" disabled={locked} onClick={() => { void search(''); }}>Все</button>}</div>
    {error && <div className="allianceFeedback isError" role="alert">{error}</div>}
    {!onSearch && <p className="finePrint">Показан сохранённый список. Поиск по всем альянсам появится после обновления соединения.</p>}
    <p className="allianceDirectoryHint">Выше команды с большим числом оплаченных смен за 7 дней. Это история добычи, а не число игроков онлайн.</p>
    {joinIssue && <p className="allianceDirectoryIssue">{joinIssue}</p>}
    <div className="allianceDirectoryList" aria-busy={pending}>{result.items.map(entry => {
      const operation = entry.operation && Date.parse(entry.operation.endsAt) > now ? entry.operation : null;
      const full = entry.members >= entry.memberLimit;
      return <article className="allianceDirectoryCard" key={entry.id} data-directory-alliance={entry.id}>
        <div className="allianceDirectoryIdentity"><GameIcon name="shield" size={26} /><div><h3>{entry.name}</h3><small>{entry.members}/{entry.memberLimit} участников · код {entry.code}</small></div></div>
        <div className="allianceDirectoryActivity"><span><GameIcon name="ore" size={15} /><b>{n(entry.modules7d)}</b> смен за 7 дней</span><span><GameIcon name="social" size={15} /><b>{n(entry.contributors7d)}</b> участников добычи</span></div>
        {operation ? <p className="allianceDirectoryOperation"><GameIcon name="signal" size={15} /><span>Добыча открыта · {n(operation.participants)} участников · {operation.roles.length}/3 ролей</span></p> : <p className="allianceDirectoryOperation isQuiet">Новую добычу может запустить любой участник.</p>}
        <button type="button" className="action secondary" disabled={locked || !!joinIssue || full} onClick={() => onJoin(entry)}>{pendingJoin === `join-${entry.id}` ? 'Вступаем…' : full ? 'Мест нет' : 'Вступить бесплатно'}</button>
        {renderFeedback(entry.id)}
      </article>;
    })}</div>
    {!result.items.length && <div className="allianceDirectoryEmpty"><GameIcon name="network" size={30} /><strong>{result.query ? 'Подходящих команд не нашли' : 'Свободных альянсов пока нет'}</strong><p>{result.query ? 'Проверь название или код. Можно сбросить поиск и посмотреть другие команды.' : 'Можно вступить по приглашению или создать свой альянс во вкладке «Создать».'}</p></div>}
    {(result.page > 0 || result.hasMore) && <div className="allianceMemberPagination" aria-label="Страницы альянсов"><button type="button" className="miniButton" disabled={locked || !onSearch || result.page === 0} onClick={() => { void search(result.query, result.page - 1); }}>Назад</button><span aria-live="polite">Страница {result.page + 1}</span><button type="button" className="miniButton" disabled={locked || !onSearch || !result.hasMore} onClick={() => { void search(result.query, result.page + 1); }}>Далее</button></div>}
  </div>;
}
