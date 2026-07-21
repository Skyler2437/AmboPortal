import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

describe('mobile mounted-test React runtime', () => {
  it('uses the production React 19.2 runtime and matching renderer', () => {
    const rendererPackage = require('react-test-renderer/package.json') as { version: string };
    const reactEntry = require.resolve('react');

    expect(React.version).toBe('19.2.0');
    expect(rendererPackage.version).toBe('19.2.0');
    expect(reactEntry).toContain('/apps/mobile/node_modules/react/');
  });

  it('declares the renderer only in the mobile workspace', () => {
    const rootPackage = JSON.parse(readFileSync(
      path.resolve(testDirectory, '../../../package.json'),
      'utf8',
    )) as { devDependencies?: Record<string, string> };
    const mobilePackage = JSON.parse(readFileSync(
      path.resolve(testDirectory, '../package.json'),
      'utf8',
    )) as { devDependencies?: Record<string, string> };

    expect(rootPackage.devDependencies).not.toHaveProperty('react-test-renderer');
    expect(mobilePackage.devDependencies?.['react-test-renderer']).toBe('19.2.0');
  });
});
