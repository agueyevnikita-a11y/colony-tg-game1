import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import './local-dev.css';

export const metadata: Metadata = {
  title: 'COLONY',
  description: 'Telegram economic city builder',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0e13',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const localSandbox = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_LOCAL_DEV === 'true';
  return (
    <html lang="ru">
      <body>
        {!localSandbox && <Script id="telegram-sdk" src="https://telegram.org/js/telegram-web-app.js?63" strategy="afterInteractive" />}
        {localSandbox && <aside className="localDevBanner" aria-label="Локальный тестовый стенд"><strong>COLONY · локальный стенд</strong><span>Тестовый город. Прогресс сохраняется на этом компьютере. Stars и отправка сообщений боту отключены.</span></aside>}
        {children}
      </body>
    </html>
  );
}
