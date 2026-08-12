'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from '@/lib/nav'
import { SignOutButton } from '@/components/layout/sign-out-button'

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navegação principal"
      className="flex w-64 shrink-0 flex-col border-r bg-white p-4"
    >
      <div className="mb-6 text-lg font-semibold">WEE</div>
      <ul className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`block rounded px-3 py-2 text-sm ${
                pathname === item.href
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {item.label}
            </Link>
            {item.children && (
              <ul className="ml-3 mt-1 space-y-1 border-l pl-3">
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      className={`block rounded px-3 py-1 text-sm ${
                        pathname === child.href
                          ? 'bg-neutral-900 text-white'
                          : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
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
      <div className="mt-6 border-t pt-4">
        <SignOutButton className="block w-full rounded px-3 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-100" />
      </div>
    </nav>
  )
}
