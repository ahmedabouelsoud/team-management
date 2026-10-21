import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'فريق | إدارة المشروع',
  description: 'مساحة عمل الفريق ومهام مشروع السنتر',
  icons: { icon: '/icon.svg', shortcut: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
