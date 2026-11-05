import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';

import { eventually } from './render.tsx';

/** Updates its state from a real timer, outside any `act`, as a query notification would. */
function Later() {
  const [text, setText] = useState('waiting');
  useEffect(() => {
    const id = setTimeout(() => {
      setText('done');
    }, 10);
    return () => {
      clearTimeout(id);
    };
  }, []);
  return <p>{text}</p>;
}

const actWarning = (calls: unknown[][]) =>
  calls.filter((call) => String(call[0]).includes('not wrapped in act'));

describe('eventually', () => {
  it('awaits an update that lands while polling without an act warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Later />);
    await eventually(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(actWarning(error.mock.calls)).toEqual([]);
  });

  it('is needed: the same wait with vi.waitFor warns', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Later />);
    await vi.waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(actWarning(error.mock.calls)).toHaveLength(1);
  });
});
