declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, any>;
    children: Array<ReactTestInstance | string>;
    find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    update(element: ReactElement): void;
    unmount(): void;
  }

  export function create(
    element: ReactElement,
    options?: {
      unstable_isConcurrent?: boolean;
      createNodeMock?: (element: ReactElement<Record<string, any>>) => unknown;
    },
  ): ReactTestRenderer;
  export function act(callback: () => void): void;
  export function act<T>(callback: () => Promise<T>): Promise<T>;
}
