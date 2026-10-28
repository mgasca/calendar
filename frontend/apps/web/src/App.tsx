import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, RouterProvider, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { getUser, safeReturnTo } from './features/auth/auth.ts';

import { ApiStatus } from './features/health/ApiStatus.tsx';
import type { AppRouter } from './router.tsx';

export function App({ router }: { router: AppRouter }) {
  return <RouterProvider router={router} />;
}

/** The shell around every route: navigation, the current page and the footer. */
export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isSignIn = location.pathname === '/signin';
  const user = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getUser,
    retry: false,
    enabled: !isSignIn,
  });

  useEffect(() => {
    function onUnauthorized() {
      if (!isSignIn) {
        void navigate({
          to: '/signin',
          search: { returnTo: safeReturnTo(location.href), error: undefined },
        });
      }
    }
    window.addEventListener('calendar:unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('calendar:unauthorized', onUnauthorized);
    };
  }, [isSignIn, location.href, navigate]);

  useEffect(() => {
    if (!isSignIn && user.isSuccess && !user.data) {
      void navigate({
        to: '/signin',
        search: { returnTo: safeReturnTo(location.href), error: undefined },
        replace: true,
      });
    }
  }, [isSignIn, user.isSuccess, user.data, location.href, navigate]);

  async function signOut() {
    const response = await fetch(new URL('/api/auth/logout', window.location.origin), {
      method: 'POST',
    });
    if (!response.ok) return;
    queryClient.clear();
    await navigate({ to: '/signin', search: { returnTo: undefined, error: undefined } });
  }

  if (isSignIn)
    return (
      <main>
        <Outlet />
      </main>
    );
  if (user.isPending || (user.isSuccess && !user.data)) return <main>Checking session…</main>;
  if (user.isError) return <main role="alert">Unable to check your session.</main>;

  return (
    <>
      <nav className="app-nav" aria-label="Main">
        <Link to="/" activeProps={{ 'aria-current': 'page' }} activeOptions={{ exact: true }}>
          Today
        </Link>
        <Link to="/week" activeProps={{ 'aria-current': 'page' }}>
          Week
        </Link>
        <Link to="/tasks" activeProps={{ 'aria-current': 'page' }}>
          My tasks
        </Link>
        <span>
          {user.data?.pictureUrl && (
            <img src={user.data.pictureUrl} alt="" width="32" height="32" />
          )}{' '}
          {user.data?.name}
        </span>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </button>
      </nav>
      <main>
        <Outlet />
      </main>
      <footer className="app-footer">
        <ApiStatus />
      </footer>
    </>
  );
}

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-heading">
      <h1 id="not-found-heading">Page not found</h1>
      <p>There’s nothing at this address.</p>
      <p>
        <Link to="/">Go to today</Link>
      </p>
    </section>
  );
}

/** Shown for `/day/<value>` and `/week/<value>` when the value isn't a real `YYYY-MM-DD` date. */
export function InvalidDatePage() {
  const { pathname } = useLocation();
  const value = decodeURIComponent(pathname.split('/').pop() ?? '');
  return (
    <section aria-labelledby="invalid-date-heading">
      <h1 id="invalid-date-heading">Invalid date</h1>
      <p>
        “{value}” isn’t a date the calendar can show. Dates look like 2026-10-26 (year, month, day),
        between the years 1900 and 2200.
      </p>
      <p>
        <Link to="/">Go to today</Link>
      </p>
    </section>
  );
}
