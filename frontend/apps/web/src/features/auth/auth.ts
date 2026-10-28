export interface User {
  name: string;
  email: string;
  pictureUrl?: string | null;
}

/** Only local, absolute paths can be passed through the login redirect. */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    // ASCII control characters are unsafe in redirect URLs.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return '/';
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname === '/signin') return '/';
  return url.pathname + url.search;
}

export async function getUser(): Promise<User | null> {
  const response = await fetch(new URL('/api/auth/me', window.location.origin));
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Unable to check your session');
  return (await response.json()) as User;
}
