export type SendDraftResult =
  | { sent: true; draft: '' }
  | { sent: false; draft: string; error?: unknown };

export async function sendDraft(
  draft: string,
  sender: (message: string) => Promise<unknown>,
): Promise<SendDraftResult> {
  const message = draft.trim();
  if (!message) return { sent: false, draft };

  try {
    await sender(message);
    return { sent: true, draft: '' };
  } catch (error) {
    return { sent: false, draft, error };
  }
}
