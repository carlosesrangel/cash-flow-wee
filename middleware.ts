import { type NextRequest, NextResponse } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/auth/callback']

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request)
  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (!user && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/visao-geral', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
