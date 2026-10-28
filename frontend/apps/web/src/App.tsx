import { Link, Outlet, RouterProvider, useLocation } from '@tanstack/react-router';

import { ApiStatus } from './features/health/ApiStatus.tsx';
import type { AppRouter } from './router.tsx';

export function App({ router }: { router: AppRouter }) {
  return <RouterProvider router={router} />;
}

/** The shell around every route: navigation, the current page and the footer. */
export function AppLayout() {
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
