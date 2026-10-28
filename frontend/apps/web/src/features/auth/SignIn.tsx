import { safeReturnTo } from './auth.ts';

export function SignIn({
  error,
  returnTo,
}: {
  error?: string | undefined;
  returnTo?: string | undefined;
}) {
  const loginUrl = `/api/auth/login?returnUrl=${encodeURIComponent(safeReturnTo(returnTo))}`;
  return (
    <section aria-labelledby="signin-heading">
      <h1 id="signin-heading">Sign in</h1>
      {error === 'access_denied' && (
        <p role="alert">
          Access denied. This Google account is not allowed to access the calendar.
        </p>
      )}
      <a href={loginUrl}>Sign in with Google</a>
    </section>
  );
}
