import Link from 'next/link';
import { ReclipWordmark } from '@/components/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: 'var(--surface-sunken)' }}>
      <header className="px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <Link href="/">
            <ReclipWordmark />
          </Link>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
