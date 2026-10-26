import { ApiStatus } from './features/health/ApiStatus.tsx';
import { TodayView } from './features/today/TodayView.tsx';

export function App() {
  return (
    <>
      <main>
        <TodayView />
      </main>
      <footer className="app-footer">
        <ApiStatus />
      </footer>
    </>
  );
}
