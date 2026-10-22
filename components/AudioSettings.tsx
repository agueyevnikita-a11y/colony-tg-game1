'use client';

import { useId, useSyncExternalStore } from 'react';
import { GameIcon } from '@/components/GameIcon';
import {
  subscribeColonyMedia, getColonyMediaSnapshot, getServerColonyMediaSnapshot,
  setColonySoundEnabled, setColonyAnimationsEnabled, setColonyVolume, primeColonyAudioFromGesture, playColonySound,
} from '@/lib/client/colony-audio';
import '@/app/audio-settings.css';

export function useColonyMedia() {
  return useSyncExternalStore(subscribeColonyMedia, getColonyMediaSnapshot, getServerColonyMediaSnapshot);
}

export function AudioSettings() {
  const id = useId();
  const settings = useColonyMedia();
  async function enableSounds() {
    const ready = await setColonySoundEnabled(!settings.soundEnabled);
    if (ready) playColonySound('tap');
  }
  async function preview() {
    if (await primeColonyAudioFromGesture()) playColonySound('build');
  }
  return <section className="card audioSettings" data-audio-settings aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><GameIcon name="settings" size={18} />Звук и движение</h3>
    <p>Короткие сигналы действий и работающие механизмы помогают чувствовать жизнь колонии. Настройки сохраняются на этом устройстве.</p>
    <div className="audioSettingRow"><div><strong>Звуки</strong><span>Строительство, награды и ошибки</span></div>
      <button type="button" className={settings.soundEnabled ? 'isOn' : ''} role="switch" aria-checked={settings.soundEnabled} aria-label="Звуки игры" disabled={!settings.audioSupported} data-audio-toggle onClick={() => void enableSounds()}>{settings.soundEnabled ? 'Включены' : 'Выключены'}</button></div>
    {!settings.audioSupported && <p className="audioSettingsNote" role="status">В этом браузере звук недоступен. Остальные функции игры работают как обычно.</p>}
    {settings.soundEnabled && settings.audioSupported && <div className="audioVolumeControl">
      <label htmlFor={`${id}-volume`}>Громкость <output>{Math.round(settings.volume * 100)}%</output></label>
      <input id={`${id}-volume`} type="range" min="0" max="100" step="5" value={Math.round(settings.volume * 100)} data-audio-volume onChange={event => setColonyVolume(Number(event.currentTarget.value) / 100)} />
      <button type="button" className="miniButton" data-audio-preview onClick={() => void preview()}>Проверить звук</button>
      {!settings.audioReady && <small>Нажми «Проверить звук», чтобы активировать его в этой вкладке.</small>}
    </div>}
    <div className="audioSettingRow"><div><strong>Анимации</strong><span>Механизмы, огни и сигналы на карте</span></div>
      <button type="button" className={settings.animationsEnabled ? 'isOn' : ''} role="switch" aria-checked={settings.animationsEnabled} aria-label="Анимации игры" data-motion-toggle onClick={() => setColonyAnimationsEnabled(!settings.animationsEnabled)}>{settings.animationsEnabled ? 'Включены' : 'Выключены'}</button></div>
    {settings.reducedMotion && <p className="audioSettingsNote">На устройстве включено сокращение движения. Анимации остаются неподвижными.</p>}
  </section>;
}
