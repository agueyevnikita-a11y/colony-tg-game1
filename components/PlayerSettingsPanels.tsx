'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ColonyIdentity } from '@/components/CosmeticAppearance';
import { GameIcon } from '@/components/GameIcon';
import { MechanicGuide } from '@/components/MechanicGuide';
import { requestTelegramWriteAccess } from '@/lib/client/telegram';
import '@/app/player-settings.css';

type Notice = { error: boolean; text: string } | null;
type ProfileDraft = { colonyName: string; bio: string };
const sameDraft = (a: ProfileDraft, b: ProfileDraft) => a.colonyName === b.colonyName && a.bio === b.bio;

export function ColonyProfilePanel({ colonyName, bio, draft, onDraftChange, cosmetics, hqLevel, cityScore, premium, busy, onSave, onOpenCollection }: {
  colonyName: string; bio: string; cosmetics: any[]; hqLevel: number; cityScore: number; premium: boolean; busy: boolean;
  draft: ProfileDraft; onDraftChange: (draft: ProfileDraft) => void;
  onSave: (draft: ProfileDraft) => Promise<unknown>; onOpenCollection: () => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy || pending;
  const changed = !sameDraft(draft, { colonyName, bio });
  const normalizedName = draft.colonyName.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  const issue = normalizedName.length < 3 || normalizedName.length > 24 ? 'Название — от 3 до 24 символов.'
    : /https?:\/\/|t\.me\//i.test(normalizedName) ? 'В названии нельзя размещать ссылки.' : '';

  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || guard.current || !changed || issue) return;
    guard.current = true; setPending(true); setNotice(null);
    try {
      const reply = await onSave(draft) as { ok?: boolean; profile?: { colony_name?: unknown; profile_bio?: unknown } } | null;
      if (reply?.ok !== true || typeof reply.profile?.colony_name !== 'string'
        || !(reply.profile.profile_bio === null || typeof reply.profile.profile_bio === 'string')) {
        throw new Error('Сохранение пока не подтверждено. Обнови колонию и проверь профиль.');
      }
      if (!mounted.current) return;
      onDraftChange({ colonyName: reply.profile.colony_name, bio: reply.profile.profile_bio ?? '' });
      setNotice({ error: false, text: 'Профиль сохранён. Изменения видны другим колонистам.' });
    } catch (cause) {
      if (mounted.current) setNotice({ error: true, text: cause instanceof Error ? cause.message : 'Не удалось сохранить профиль. Попробуй ещё раз.' });
    } finally { guard.current = false; if (mounted.current) setPending(false); }
  }

  return <section className="card profileCard playerSettingsPanel" aria-labelledby={`${id}-title`} aria-busy={pending}>
    <h2 id={`${id}-title`}><GameIcon name="social" />Профиль колонии</h2>
    <p>Название и описание видны другим игрокам.</p>
    <ColonyIdentity name={colonyName || 'Твоя колония'} cosmetics={cosmetics} />
    <p className="profileCityStats">Центр ур. {hqLevel} · Рейтинг города {cityScore.toLocaleString('ru-RU')}{premium ? ' · Premium' : ''}</p>
    <form onSubmit={event => void save(event)}>
      <label className="profileField" htmlFor={`${id}-name`}>Название колонии<input id={`${id}-name`} value={draft.colonyName} maxLength={24} disabled={locked} autoComplete="off" aria-describedby={`${id}-name-help`} onChange={event => { onDraftChange({ ...draft, colonyName: event.target.value }); setNotice(null); }} /></label>
      <p className="settingsFieldHint" id={`${id}-name-help`}>{issue || `${draft.colonyName.length}/24 · без ссылок`}</p>
      <label className="profileField" htmlFor={`${id}-bio`}>Описание · необязательно<textarea id={`${id}-bio`} value={draft.bio} maxLength={80} disabled={locked} placeholder="Расскажи о своей колонии" aria-describedby={`${id}-bio-help`} onChange={event => { onDraftChange({ ...draft, bio: event.target.value }); setNotice(null); }} /></label>
      <p className="settingsFieldHint" id={`${id}-bio-help`}>{draft.bio.length}/80 · можно оставить пустым</p>
      <div className="settingsActions"><button type="submit" className="action secondary" disabled={locked || !changed || !!issue}>{pending ? 'Сохраняем…' : 'Сохранить профиль'}</button>{changed && <button type="button" className="miniButton" disabled={locked} onClick={() => { onDraftChange({ colonyName, bio }); setNotice(null); }}>Отменить изменения</button>}</div>
    </form>
    {notice && <div className={`notice settingsFeedback${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
    <button type="button" className="miniButton settingsCollection" onClick={onOpenCollection}><GameIcon name="palette" size={16} />Оформить профиль<GameIcon name="arrow" size={14} /></button>
    <MechanicGuide steps={['Измени название или описание и нажми «Сохранить профиль». Сам ввод ничего не меняет для других игроков.', 'Рамки, титулы и значки выбираются в магазине → «Моё оформление». Предпросмотр не покупает предмет.']} />
  </section>;
}

type NotificationPreferences = { enabled: boolean; bot_write_allowed: boolean };
export function NotificationSettings({ preferences, available, busy, onChange, onRefresh }: {
  preferences?: NotificationPreferences; available: boolean; busy: boolean;
  onChange: (enabled: boolean) => Promise<unknown>; onRefresh: () => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const guard = useRef(false), mounted = useRef(true);
  const access = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; access.current?.abort(); }; }, []);
  const enabled = preferences?.enabled === true;
  const awaiting = enabled && preferences?.bot_write_allowed !== true;
  const locked = busy || pending;
  async function change() {
    if (locked || guard.current || !enabled && !available) return;
    guard.current = true; setPending(true); setNotice(null);
    try {
      if (!enabled) {
        const controller = new AbortController(); access.current = controller;
        const granted = await requestTelegramWriteAccess(window.Telegram?.WebApp, controller.signal);
        if (!granted) throw new Error('Разрешение не получено. Уведомления остались выключены.');
      }
      if (!mounted.current) return;
      const result = await onChange(!enabled) as Partial<NotificationPreferences> | null;
      if (typeof result?.enabled !== 'boolean' || typeof result.bot_write_allowed !== 'boolean' || result.enabled !== !enabled) {
        throw new Error('Настройка пока не подтверждена. Обнови состояние уведомлений.');
      }
      if (mounted.current) setNotice({ error: false, text: result.enabled
        ? result.bot_write_allowed ? 'Уведомления включены.' : 'Настройка сохранена. Ждём подтверждения разрешения от Telegram.'
        : 'Уведомления выключены.' });
    } catch (cause) {
      if (mounted.current) setNotice({ error: true, text: cause instanceof Error ? cause.message : 'Не удалось изменить уведомления. Попробуй ещё раз.' });
    } finally { access.current = null; guard.current = false; if (mounted.current) setPending(false); }
  }
  return <section className="card notificationCard playerSettingsPanel" aria-labelledby={`${id}-title`} aria-busy={pending}>
    <div className="cardTitleRow"><div><h2 id={`${id}-title`}><GameIcon name="signal" />Уведомления Telegram</h2><p>Сообщим о готовности стройки, исследований и экспедиций.</p></div><span className="pill">{enabled ? awaiting ? 'Ожидают Telegram' : 'Включены' : 'Выключены'}</span></div>
    {!available && <p className="settingsFieldHint">Отправка уведомлений временно отключена в этом тесте.{enabled ? ' Сохранённое разрешение можно выключить.' : ''}</p>}
    <button type="button" className={`action${enabled ? ' secondary' : ''}`} disabled={locked || !enabled && !available} onClick={() => void change()}>{pending ? 'Ждём подтверждения…' : enabled ? 'Выключить уведомления' : 'Разрешить уведомления'}</button>
    {awaiting && <p className="settingsFieldHint">Одного разрешения в окне Telegram недостаточно: бот ждёт подтверждение от сервера Telegram.</p>}
    {(awaiting || notice?.error) && <button type="button" className="miniButton settingsRefresh" disabled={locked} onClick={onRefresh}>Обновить состояние</button>}
    {notice && <div className={`notice settingsFeedback${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
    <MechanicGuide steps={['Нажми «Разрешить уведомления» и подтверди запрос Telegram. Настройка не включается при отказе.', 'Бот присылает только сообщения о готовности работ. Уведомления можно выключить в любой момент; прогресс игры сохранится.']} />
  </section>;
}

export function FeedbackPanel({ category, message, busy, onCategoryChange, onMessageChange, onSend, onOpenInbox }: {
  category: string; message: string; busy: boolean; onCategoryChange: (value: string) => void; onMessageChange: (value: string) => void;
  onSend: (body: { category: string; message: string }) => Promise<unknown>; onOpenInbox: () => void;
}) {
  const id = useId(), guard = useRef(false), mounted = useRef(true);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<Notice>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy || pending;
  const length = message.trim().length;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (locked || guard.current || length < 5 || length > 2000) return;
    guard.current = true; setPending(true); setNotice(null);
    try {
      const result = await onSend({ category, message }) as { ok?: boolean; id?: unknown } | null;
      if (result?.ok !== true || typeof result.id !== 'string' || !result.id) throw new Error('Отправка пока не подтверждена. Проверь почту колонии перед повтором.');
      if (!mounted.current) return;
      onMessageChange('');
      setNotice({ error: false, text: 'Сообщение сохранено. Подтверждение появилось в почте колонии.' });
    } catch (cause) {
      if (mounted.current) setNotice({ error: true, text: cause instanceof Error ? cause.message : 'Не удалось отправить сообщение. Текст сохранён в форме.' });
    } finally { guard.current = false; if (mounted.current) setPending(false); }
  }
  return <section className="card feedbackCard playerSettingsPanel" aria-labelledby={`${id}-title`} aria-busy={pending}>
    <h2 id={`${id}-title`}><GameIcon name="mail" />Обратная связь</h2><p>Сообщение получит команда закрытого теста вместе с твоим игровым ID.</p>
    <form className="feedbackForm" onSubmit={event => void send(event)}>
      <label htmlFor={`${id}-category`}>Тема<select id={`${id}-category`} value={category} disabled={locked} onChange={event => onCategoryChange(event.target.value)}><option value="general">Общее</option><option value="bug">Ошибка</option><option value="balance">Баланс</option><option value="idea">Идея</option><option value="payment">Платёж</option></select></label>
      <label htmlFor={`${id}-message`}>Что произошло или что стоит улучшить?<textarea id={`${id}-message`} value={message} maxLength={2000} disabled={locked} aria-describedby={`${id}-message-help`} onChange={event => { onMessageChange(event.target.value); setNotice(null); }} /></label>
      <p className="settingsFieldHint" id={`${id}-message-help`}>{message.length}/2000{length < 5 ? ' · напиши хотя бы 5 символов' : ''}</p>
      <button type="submit" className="action secondary" disabled={locked || length < 5 || length > 2000}>{pending ? 'Отправляем…' : 'Отправить сообщение'}</button>
    </form>
    {notice && <div className={`notice settingsFeedback${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}<button type="button" className="miniButton" disabled={locked} onClick={onOpenInbox}>Открыть почту</button></div>}
    <MechanicGuide steps={['Выбери тему и опиши ситуацию. До нажатия «Отправить сообщение» текст остаётся черновиком.', 'В закрытом тесте сообщения читаются вручную. Можно отправить до пяти сообщений в час; подтверждение сохранения приходит в почту колонии.']} />
  </section>;
}
