'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from '@/lib/nav'
import { SignOutButton } from '@/components/layout/sign-out-button'
import { cn } from '@/lib/utils'

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground p-4',
        className,
      )}
    >
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center">
          <Image
            src="/logo2.jpg"
            alt="WEE"
            width={64}
            height={64}
            style={{
              objectFit: 'contain',
            }}
            priority
          />
        </div>
        <div>
          <div
            className="text-lg font-semibold leading-tight"
            style={{ fontFamily: 'var(--font-space-mono)', color: 'var(--brand-navy)' }}
          >
            WEE
          </div>
          <div
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ fontFamily: 'var(--font-space-mono)', color: 'var(--brand-navy)' }}
          >
            Cash Flow
          </div>
        </div>
      </div>

      {/* Navigation */}
      <ul className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                'block rounded-sm px-3 py-2 text-sm font-medium transition-colors',
                pathname === item.href
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
            >
              {item.label}
            </Link>
            {item.children && (
              <ul className="ml-3 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      className={cn(
                        'block rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                        pathname === child.href
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                      )}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {/* Sign out */}
      <div className="mt-6 border-t border-sidebar-border pt-4">
        <SignOutButton className="block w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent" />
      </div>
    </nav>
  )
}
