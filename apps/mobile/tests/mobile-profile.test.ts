import { beforeEach, describe, expect, it, vi } from 'vitest';

type MobileProfileClient = {
  updateMobileProfile: (
    accessToken: string,
    update: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      avatarUrl?: string;
    },
  ) => Promise<unknown>;
};

async function loadClient(): Promise<MobileProfileClient | null> {
  return import('@/lib/mobileProfile').catch(() => null) as Promise<MobileProfileClient | null>;
}

describe('updateMobileProfile', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.EXPO_PUBLIC_WEB_URL = 'https://ambo.example.edu/';
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  });

  it('sends the authenticated profile update to the server endpoint', async () => {
    const client = await loadClient();

    expect(client).not.toBeNull();
    if (!client) return;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: {
          id: 'student-1',
          first_name: 'Chaz',
          last_name: 'Di Nieri',
          phone: '5555555555',
          avatar_url: null,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const profile = await client.updateMobileProfile('access-token', {
      firstName: 'Chaz',
      lastName: 'Di Nieri',
      phone: '5555555555',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://ambo.example.edu/api/mobile/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-token',
      },
      body: JSON.stringify({
        firstName: 'Chaz',
        lastName: 'Di Nieri',
        phone: '5555555555',
      }),
    });
    expect(profile).toEqual({
      id: 'student-1',
      first_name: 'Chaz',
      last_name: 'Di Nieri',
      phone: '5555555555',
      avatar_url: null,
    });
  });

  it('surfaces the API error instead of reporting a failed update as saved', async () => {
    const client = await loadClient();

    expect(client).not.toBeNull();
    if (!client) return;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid avatar URL' }),
    }));

    await expect(client.updateMobileProfile('access-token', {
      avatarUrl: 'https://example.com/not-chaz.jpg',
    })).rejects.toThrow('Invalid avatar URL');
  });

  it('does not attempt a request when the server URL is missing', async () => {
    const client = await loadClient();

    expect(client).not.toBeNull();
    if (!client) return;

    delete process.env.EXPO_PUBLIC_WEB_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.updateMobileProfile('access-token', {
      firstName: 'Chaz',
    })).rejects.toThrow('Server URL is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
