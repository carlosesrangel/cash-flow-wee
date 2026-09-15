import { GET } from '@/app/auth/callback/route'

/**
 * Supports the server-side Supabase email template:
 * /auth/confirm?token_hash={{ .TokenHash }}&type=invite
 */
export { GET }
