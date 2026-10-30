import type { Location } from 'react-router-dom';
import type { LayerStatus } from './PageTransitionLayer';

export type Layer = {
  key: string;
  location: Location;
  status: LayerStatus;
};

// Replaces the current layer's location in place, keeping its key and status. Returns the same
// array when the location is already current so React bails out of the state update.
export function withCurrentLocation(layers: Layer[], location: Location): Layer[] {
  const index = layers.findIndex((layer) => layer.status === 'current');
  const target = index >= 0 ? index : layers.length - 1;
  if (target < 0 || layers[target].location === location) return layers;
  return layers.map((layer, i) => (i === target ? { ...layer, location } : layer));
}
