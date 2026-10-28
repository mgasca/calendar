import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';

import { AppLayout, InvalidDatePage, NotFoundPage } from './App.tsx';
import { browserTimeZone, isIsoDate, localDate } from './features/agenda/dayTime.ts';
import { SignIn } from './features/auth/SignIn.tsx';
import { DayPage } from './features/day/DayPage.tsx';
import { useToday } from './features/agenda/useNow.ts';
import { AddTask } from './features/tasks/AddTask.tsx';
import { TaskList } from './features/tasks/TaskList.tsx';
import { isoWeekStart } from './features/week/weekDates.ts';
import { WeekView } from './features/week/WeekView.tsx';

/** Values every route can read; tests pass fixed ones. */
export interface AppRouterContext {
  /** IANA zone that defines days and "today". */
  timeZone: string;
  /** BCP 47 locale for formatting; undefined means the browser's. */
  locale: string | undefined;
}

// Routes are defined in code (ADR-0026): no router plugin and no generated route tree.
const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: AppLayout,
  notFoundComponent: NotFoundPage,
});

const signinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined,
  }),
  component: function SignInRoute() {
    return <SignIn {...signinRoute.useSearch()} />;
  },
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function TodayRoute() {
    const { timeZone, locale } = todayRoute.useRouteContext();
    // Follows the clock, so the page moves on to the next day at local midnight.
    const today = useToday(timeZone);
    return <DayPage date={today} timeZone={timeZone} locale={locale} />;
  },
});

const dayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/day/$date',
  params: {
    // Anything that isn't a real YYYY-MM-DD date never reaches the view.
    parse: ({ date }) => {
      if (!isIsoDate(date)) {
        throw notFound();
      }
      return { date };
    },
    stringify: ({ date }) => ({ date }),
  },
  notFoundComponent: InvalidDatePage,
  component: function DayRoute() {
    const { date } = dayRoute.useParams();
    const { timeZone, locale } = dayRoute.useRouteContext();
    return <DayPage date={date} timeZone={timeZone} locale={locale} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: function TasksRoute() {
    return (
      <>
        <AddTask />
        <TaskList />
      </>
    );
  },
});

// `/week` is the current week: its Monday is computed from the local date now in the app's zone.
const currentWeekRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/week',
  beforeLoad: ({ context }) => {
    throw redirect({
      to: '/week/$weekStart',
      params: { weekStart: isoWeekStart(localDate(Date.now(), context.timeZone)) },
      replace: true,
    });
  },
});

const weekRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/week/$weekStart',
  params: {
    parse: ({ weekStart }) => {
      if (!isIsoDate(weekStart)) {
        throw notFound();
      }
      return { weekStart };
    },
    stringify: ({ weekStart }) => ({ weekStart }),
  },
  // Any date selects its week: `/week/2026-10-28` becomes `/week/2026-10-26`.
  beforeLoad: ({ params }) => {
    const monday = isoWeekStart(params.weekStart);
    if (monday !== params.weekStart) {
      throw redirect({ to: '/week/$weekStart', params: { weekStart: monday }, replace: true });
    }
  },
  notFoundComponent: InvalidDatePage,
  component: function WeekRoute() {
    const { weekStart } = weekRoute.useParams();
    const { timeZone, locale } = weekRoute.useRouteContext();
    return <WeekView weekStart={weekStart} timeZone={timeZone} locale={locale} />;
  },
});

const routeTree = rootRoute.addChildren([
  signinRoute,
  todayRoute,
  dayRoute,
  currentWeekRoute,
  weekRoute,
  tasksRoute,
]);

export interface AppRouterOptions {
  /** Defaults to the browser's history; tests pass a memory history. */
  history?: RouterHistory | undefined;
  timeZone?: string | undefined;
  locale?: string | undefined;
}

export function createAppRouter({ history, timeZone, locale }: AppRouterOptions = {}) {
  return createRouter({
    routeTree,
    ...(history && { history }),
    context: { timeZone: timeZone ?? browserTimeZone(), locale },
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
