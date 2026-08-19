'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'

export function MobileNavToggle() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Hamburger button - only visible on mobile */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-40 inline-flex items-center justify-center rounded-sm bg-primary p-2 text-primary-foreground md:hidden"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay - only visible on mobile when open */}
      {open && (
        <button
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          aria-label="Close navigation"
        />
      )}

      {/* Data attribute for CSS to show/hide sidebar */}
      <div
        data-mobile-nav-open={open}
        className="contents"
        suppressHydrationWarning
      />
    </>
  )
}
