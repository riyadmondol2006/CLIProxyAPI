import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Width of an element, tracked with ResizeObserver; `fallback` until it is measured. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/**
 * One active mark per chart, driven by pointer or keyboard. The chart is a single tab
 * stop; arrow keys, Home and End move between marks. `keyboard` is true when focus drove
 * the change, so only keyboard moves are announced to screen readers.
 */
export function useChartFocus(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const index = active !== null && active < count ? active : null;

  const point = (next: number | null) => {
    setKeyboard(false);
    setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (count === 0) return;
    const current = index ?? count - 1;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(count - 1, current + 1),
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setKeyboard(true);
    setActive(index === null ? current : moves[event.key]);
  };

  const containerProps = {
    tabIndex: 0,
    onKeyDown,
    onFocus: () => {
      if (index === null && count > 0) {
        setKeyboard(true);
        setActive(count - 1);
      }
    },
    onBlur: () => point(null),
    onPointerLeave: () => {
      if (!keyboard) setActive(null);
    },
  };

  return { active: index, keyboard, point, containerProps };
}

/** SVG path for a bar with rounded top corners and a square base. */
export function topRoundedBar(x: number, y: number, width: number, height: number, r = 4): string {
  if (height <= 0 || width <= 0) return '';
  const radius = Math.max(0, Math.min(r, width / 2, height));
  return [
    `M${x} ${y + height}`,
    `V${y + radius}`,
    `Q${x} ${y} ${x + radius} ${y}`,
    `H${x + width - radius}`,
    `Q${x + width} ${y} ${x + width} ${y + radius}`,
    `V${y + height}`,
    'Z',
  ].join(' ');
}

/** Puts the tooltip beside the active mark (never over it), flipping left near the end. */
export function tooltipShift(index: number, count: number): string {
  const ratio = count > 1 ? index / (count - 1) : 0;
  return ratio > 0.55 ? 'translateX(calc(-100% - 16px))' : 'translateX(16px)';
}
