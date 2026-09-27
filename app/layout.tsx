import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

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
  return (
    <html lang="ru">
      <body>
        <Script id="telegram-sdk" src="https://telegram.org/js/telegram-web-app.js?63" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}
