import { describe, expect, it, vi } from 'vitest';
import { sendDraft } from '@/lib/composer-state';

describe('sendDraft', () => {
  it('trims and clears only after success', async () => {
    const sender = vi.fn(async () => {});

    await expect(sendDraft('  hello  ', sender)).resolves.toEqual({ sent: true, draft: '' });
    expect(sender).toHaveBeenCalledWith('hello');
  });

  it('preserves the original draft after failure', async () => {
    const error = new Error('offline');

    await expect(sendDraft('hello', async () => { throw error; })).resolves.toEqual({
      sent: false,
      draft: 'hello',
      error,
    });
  });

  it('does not send whitespace', async () => {
    const sender = vi.fn();

    await expect(sendDraft('   ', sender)).resolves.toEqual({ sent: false, draft: '   ' });
    expect(sender).not.toHaveBeenCalled();
  });
});
