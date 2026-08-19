import { type NextRequest, NextResponse } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/auth/callback', '/api/integracoes/olist/callback', '/api/']

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request)
  const pathname = request.nextUrl.pathname
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )

  if (!user && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    const redirectResponse = NextResponse.redirect(loginUrl)
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  if (user && pathname === '/login') {
    const redirectResponse = NextResponse.redirect(new URL('/visao-geral', request.url))
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
