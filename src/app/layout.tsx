import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '30 Days of Product',
  description: 'Standalone day project from 30 Days of Product.',
};

type Props = { children: React.ReactNode };

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
