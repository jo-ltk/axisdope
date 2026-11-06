import type { Metadata, Viewport } from 'next';
// Self-hosted fonts: no request to Google at build or run time, and the canvas can use the
// family names "Archivo", "Instrument Serif" and "JetBrains Mono" directly.
import '@fontsource/archivo/200.css';
import '@fontsource/archivo/500.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/500.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alex in Present Tense',
  description: 'Alex, currently in Ottawa. An experimental page where every pixel lags behind time.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
