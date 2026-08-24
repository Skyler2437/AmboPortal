import { StackRouter, TabRouter } from '@react-navigation/routers';
import { describe, expect, it } from 'vitest';

const rehydrationOptions = {
  routeNames: ['index'],
  routeParamList: { index: undefined },
  routeGetIdList: { index: undefined },
};

describe('React Navigation rehydration', () => {
  it.each([
    ['stack', StackRouter({})],
    ['tab', TabRouter({})],
  ] as const)(
    'returns a valid initial %s state when a concurrent render loses the partial state',
    (type, router) => {
      const state = router.getRehydratedState(
        undefined as never,
        rehydrationOptions,
      );

      expect(state).toMatchObject({
        stale: false,
        type,
        index: 0,
        routeNames: ['index'],
        routes: [{ name: 'index' }],
      });
    },
  );
});
