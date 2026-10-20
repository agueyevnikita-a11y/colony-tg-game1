'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { GameIcon } from '@/components/GameIcon';
import '@/app/onboarding.css';

type Props = {
  colonyName: string;
  onNameChange: (name: string) => void;
  bio: string;
  onBioChange: (bio: string) => void;
  busy: boolean;
  onSubmit: () => Promise<void>;
  error?: string;
  onClose?: () => void;
};

export function ColonyWelcome({ colonyName, onNameChange, bio, onBioChange, busy, onSubmit, error, onClose }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const submitGuard = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const locked = busy || submitting;
  const visibleError = localError || error;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Keep the introduction visible without opening the mobile keyboard immediately.
    dialog.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || submitGuard.current) return;
    const name = colonyName.replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 24) {
      setLocalError('Название колонии должно содержать от 3 до 24 символов.');
      nameRef.current?.focus({ preventScroll: true });
      return;
    }
    submitGuard.current = true;
    setSubmitting(true);
    setLocalError('');
    try {
      await onSubmit();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Не удалось основать колонию. Попробуй ещё раз.');
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }

  return <dialog ref={dialogRef} autoFocus tabIndex={-1} className="onboardingDialog welcomeDialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
    onCancel={(event) => { event.preventDefault(); if (!locked) onClose?.(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !locked) onClose?.(); }}>
    <div className="onboardingDialogBody welcomeBody">
      <div className="welcomeHero">
        <img src="/art/colony-arrival.webp" width={1672} height={941} alt="Производственный город колонистов на далёкой планете" fetchPriority="high" />
        {onClose && <button type="button" className="onboardingClose welcomeClose" aria-label="Закрыть приветствие" disabled={locked} onClick={onClose}><GameIcon name="close" size={20} /></button>}
      </div>
      <div className="welcomeContent">
        <span className="onboardingEyebrow">COLONY · Твой производственный город</span>
        <h1 id={`${id}-title`}>Твоя колония начинается здесь</h1>
        <p id={`${id}-intro`} className="welcomeIntro">Решай, что строить и как связать производство. Из небольшой базы вырастет город, который работает даже без тебя.</p>
        <ol className="welcomeSteps" aria-label="Как развивается колония">
          <li><span className="welcomeStepIcon"><GameIcon name="build" size={23} /></span><strong>Строй и добывай</strong><span>Шахты дают руду, электростанции — энергию.</span></li>
          <li><span className="welcomeStepIcon"><GameIcon name="parts" size={23} /></span><strong>Производи детали</strong><span>Плавь ресурсы для новых зданий и улучшений.</span></li>
          <li><span className="welcomeStepIcon"><GameIcon name="research" size={23} /></span><strong>Развивай город</strong><span>Исследуй технологии и торгуй излишками.</span></li>
        </ol>
        <form className="welcomeForm" onSubmit={(event) => void submit(event)} noValidate aria-busy={locked}>
          <label htmlFor={`${id}-name`}>Как назовём колонию?</label>
          <input ref={nameRef} id={`${id}-name`} name="colonyName" value={colonyName} maxLength={24} minLength={3} required autoComplete="off" autoCapitalize="sentences"
            placeholder="Например, Новый горизонт" disabled={locked} aria-invalid={visibleError ? true : undefined} aria-describedby={`${id}-name-hint${visibleError ? ` ${id}-error` : ''}`}
            onChange={(event) => { setLocalError(''); onNameChange(event.target.value); }} />
          <div className="welcomeFieldHint" id={`${id}-name-hint`}><span>3–24 символа. Название можно изменить позже.</span><span aria-label={`${colonyName.length} из 24 символов`}>{colonyName.length}/24</span></div>
          <details className="welcomeBio"><summary>Добавить описание <span>необязательно</span></summary><label htmlFor={`${id}-bio`}>О чём твоя колония?</label><textarea id={`${id}-bio`} name="bio" value={bio} maxLength={80} rows={2} disabled={locked} placeholder="Например, строим город чистой энергии" onChange={(event) => { setLocalError(''); onBioChange(event.target.value); }} /></details>
          {visibleError && <div className="notice error onboardingFeedback" id={`${id}-error`} role="alert">{visibleError}</div>}
          <button className="action welcomeSubmit" type="submit" disabled={locked}>{locked ? 'Основываем колонию…' : 'Основать колонию'}<GameIcon name="arrow" size={19} /></button>
          <p className="welcomeAfterword">Дальше проведём тебя через первую стройку, плавку и торговлю.</p>
        </form>
      </div>
    </div>
  </dialog>;
}
