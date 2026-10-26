import { useHealth } from './useHealth.ts';

export function ApiStatus() {
  const { data, isPending, isError } = useHealth();

  if (isPending) {
    return <p role="status">Checking API…</p>;
  }
  if (isError) {
    return <p role="alert">API unavailable</p>;
  }
  return <p role="status">API status: {data.status}</p>;
}
