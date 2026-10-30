import { describe, expect, test } from 'bun:test';
import type { Location } from 'react-router-dom';
import { withCurrentLocation, type Layer } from '@/components/common/pageTransitionLayers';

const makeLocation = (key: string, search = ''): Location => ({
  key,
  pathname: '/claude-usage',
  search,
  hash: '',
  state: null,
});

describe('withCurrentLocation', () => {
  test('replaces the current layer location and keeps its key and status', () => {
    const before = makeLocation('a');
    const next = makeLocation('b', '?range=90d');
    const layers: Layer[] = [{ key: 'a', location: before, status: 'current' }];

    const result = withCurrentLocation(layers, next);

    expect(result).not.toBe(layers);
    expect(result).toEqual([{ key: 'a', location: next, status: 'current' }]);
    expect(result[0].location).toBe(next);
  });

  test('leaves stacked and exiting layers untouched', () => {
    const stacked: Layer = { key: 's', location: makeLocation('s'), status: 'stacked' };
    const exiting: Layer = { key: 'x', location: makeLocation('x'), status: 'exiting' };
    const current: Layer = { key: 'c', location: makeLocation('c'), status: 'current' };
    const next = makeLocation('n', '?range=7d');

    const result = withCurrentLocation([stacked, exiting, current], next);

    expect(result[0]).toBe(stacked);
    expect(result[1]).toBe(exiting);
    expect(result[2]).toEqual({ key: 'c', location: next, status: 'current' });
  });

  test('returns the same array when the location is already current', () => {
    const location = makeLocation('a', '?range=90d');
    const layers: Layer[] = [
      { key: 's', location: makeLocation('s'), status: 'stacked' },
      { key: 'a', location, status: 'current' },
    ];

    expect(withCurrentLocation(layers, location)).toBe(layers);
  });

  test('uses the last layer when no layer is marked current', () => {
    const first: Layer = { key: 'f', location: makeLocation('f'), status: 'stacked' };
    const last: Layer = { key: 'l', location: makeLocation('l'), status: 'exiting' };
    const next = makeLocation('n', '?range=30d');

    const result = withCurrentLocation([first, last], next);

    expect(result[0]).toBe(first);
    expect(result[1]).toEqual({ key: 'l', location: next, status: 'exiting' });
  });

  test('returns an empty array as-is', () => {
    const layers: Layer[] = [];

    expect(withCurrentLocation(layers, makeLocation('a'))).toBe(layers);
  });
});
