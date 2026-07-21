import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const detailSource = readFileSync(
  fileURLToPath(new URL('../src/screens/EventDetailScreen.tsx', import.meta.url).href),
  'utf8',
);
const listSource = readFileSync(
  fileURLToPath(new URL('../src/screens/EventsListScreen.tsx', import.meta.url).href),
  'utf8',
);

describe('EventDetailScreen engagement wiring', () => {
  it('records a view only after the event detail has loaded', () => {
    expect(detailSource).toMatch(/import \{[^}]*useEventViews[^}]*\} from '@\/hooks\/useEventViews';/);
    expect(detailSource).toMatch(/if \(!event \|\| event\.id !== id \|\| !userId\) return;\s+void recordView\(\);/);
    expect(listSource).not.toContain('useEventViews');
  });

  it('does not record or load attendance while stale detail data belongs to another route', () => {
    expect((detailSource.match(/event\.id !== id/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('opens recoverable viewer and Present-name dialogs from engagement controls', () => {
    expect(detailSource).toContain('const { viewCount, recordView, loadViewers }');
    expect(detailSource).toContain('setViewers(null)');
    expect(detailSource).toContain('await loadViewers()');
    expect(detailSource).toContain('{viewCount} seen');
    expect(detailSource).toContain("text: 'Try Again'");
    expect(detailSource).toContain('loadPresentUsers(id)');
    expect(detailSource).toContain('Present ({presentUsers.length})');
    expect(detailSource).toContain('<UserListDialog');
  });

  it('uses the live role for creator actions and preserves role-group attendance navigation', () => {
    expect(detailSource).toContain('const { session, userRole } = useAuth()');
    expect(detailSource).toContain('canManageEvent(userId, userRole ?? role, event.created_by)');
    expect(detailSource).toContain('{canManage && (');
    expect(detailSource).toContain('Take Attendance');
    expect(detailSource).toContain('`/(${role})/events/attendance/${id}`');
    expect(detailSource).toContain('{isAdmin && (');
  });
});
