import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { friendlyError } from './actions';

describe('friendlyError', () => {
  it('shows our store-scope reasons in plain words (#78)', () => {
    expect(friendlyError({ message: 'permission denied: this record belongs to a store you don\'t have access to', code: '42501' }))
      .toBe('This record belongs to a store you don\'t have access to.');
    expect(friendlyError({ message: 'permission denied: choose a store you have access to', code: '42501' }))
      .toBe('Choose a store you have access to.');
  });

  it('still hides internal errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(friendlyError({ message: 'invalid input syntax for type uuid: "x"' })).toBe('Something went wrong. Please try again.');
    expect(friendlyError({ message: 'permission denied for table bills' })).toBe('You don’t have permission to do that.');
    spy.mockRestore();
  });
});
