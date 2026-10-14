import type {Metadata} from 'next';
import {Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono} from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'CadenceRx — Precision Medication & Regimen Tracker',
  description:
    'Personal medication tracking workspace across daily dose logs, weekly regimen matrices, monthly adherence heatmaps, streak analytics, and refill inventory management.',
  openGraph: {
    title: 'CadenceRx — Precision Medication & Regimen Tracker',
    description:
      'Personal medication tracking workspace across daily dose logs, weekly regimen matrices, monthly adherence heatmaps, streak analytics, and refill inventory management.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CadenceRx — Precision Medication & Regimen Tracker',
    description:
      'Personal medication tracking workspace across daily dose logs, weekly regimen matrices, monthly adherence heatmaps, streak analytics, and refill inventory management.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="bg-slate-50 text-slate-900 antialiased selection:bg-teal-600 selection:text-white"
        style={{fontFamily: 'var(--font-sans), sans-serif'}}
      >
        {children}
      </body>
    </html>
  );
}
