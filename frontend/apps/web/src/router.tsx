import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  type RouterHistory,
} from '@tanstack/react-router';

import { AppLayout, InvalidDatePage, NotFoundPage } from './App.tsx';
import { browserTimeZone, isIsoDate } from './features/agenda/dayTime.ts';
import { DayPage } from './features/day/DayPage.tsx';
import { useToday } from './features/day/useToday.ts';
import { AddTask } from './features/tasks/AddTask.tsx';
import { TaskList } from './features/tasks/TaskList.tsx';

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

const routeTree = rootRoute.addChildren([todayRoute, dayRoute, tasksRoute]);

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
