export interface MobileProfileUpdate {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  avatarUrl?: string;
}

export interface MobileProfile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
}

export async function updateMobileProfile(
  accessToken: string,
  update: MobileProfileUpdate,
): Promise<MobileProfile> {
  const baseUrl = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!baseUrl) {
    throw new Error('Server URL is not configured');
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/mobile/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(update),
  });
  const data = await response.json().catch(() => ({})) as {
    error?: unknown;
    profile?: MobileProfile;
  };

  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Failed to update profile',
    );
  }

  if (!data.profile) {
    throw new Error('Invalid profile response');
  }

  return data.profile;
}
