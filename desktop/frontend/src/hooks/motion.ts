import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate } from 'motion/mini';

/**
 * Premium motion tier: 0.45s entrance, decelerating curve, no overshoot.
 * Uses the same custom easing style as PageTransition.
 */
const REVEAL_DISTANCE = 24;
const REVEAL_DURATION = 0.45;
const COUNT_UP_DURATION = 900;
/** Group entrance stagger and total budget: no matter the stagger, the group never exceeds 360ms */
const GROUP_STAGGER = 0.07;
const GROUP_MAX_TOTAL = 0.36;

const easeOutQuart = (progress: number) => 1 - (1 - progress) ** 4;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fades an element in while sliding it up as it scrolls into the viewport.
 *
 * The initial state is written to inline styles by JS before paint, so content always stays
 * visible if the script doesn't run, and no CSS pre-class is required.
 */
export function useRevealOnScroll<T extends HTMLElement>(delaySeconds = 0) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const clearInlineState = () => {
      element.style.removeProperty('opacity');
      element.style.removeProperty('transform');
      element.style.removeProperty('will-change');
    };

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      clearInlineState();
      return;
    }

    element.style.opacity = '0';
    element.style.transform = `translate3d(0, ${REVEAL_DISTANCE}px, 0)`;
    element.style.willChange = 'opacity, transform';

    let animation: ReturnType<typeof animate> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          animation = animate(
            element,
            {
              opacity: [0, 1],
              transform: [`translate3d(0, ${REVEAL_DISTANCE}px, 0)`, 'translate3d(0, 0, 0)'],
            },
            { duration: REVEAL_DURATION, delay: delaySeconds, ease: easeOutQuart }
          );
          void animation.finished.then(clearInlineState).catch(() => undefined);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      animation?.stop();
      clearInlineState();
    };
  }, [delaySeconds]);

  return ref;
}

/**
 * When the container enters the viewport, its `[data-reveal]` children fade in and slide up in a
 * cascade in DOM order.
 *
 * 70ms stagger, with the whole group capped at 360ms (the stagger compresses automatically when
 * there are many children), matching the micro-cascade budget; children with
 * `data-reveal="scale"` additionally scale in from 0.97 (used for glass panel materialize).
 * The initial state is likewise written to inline styles before paint, so content always stays
 * visible without the script.
 */
export function useRevealGroup<T extends HTMLElement>(baseDelaySeconds = 0) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const children = Array.from(container.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (children.length === 0) return;

    const hiddenTransform = (element: HTMLElement) =>
      element.dataset.reveal === 'scale'
        ? `translate3d(0, ${REVEAL_DISTANCE}px, 0) scale(0.97)`
        : `translate3d(0, ${REVEAL_DISTANCE}px, 0)`;
    const settledTransform = (element: HTMLElement) =>
      element.dataset.reveal === 'scale' ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 0, 0)';

    const clearInlineState = (element: HTMLElement) => {
      element.style.removeProperty('opacity');
      element.style.removeProperty('transform');
      element.style.removeProperty('will-change');
    };
    const clearAll = () => children.forEach(clearInlineState);

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      clearAll();
      return;
    }

    children.forEach((element) => {
      element.style.opacity = '0';
      element.style.transform = hiddenTransform(element);
      element.style.willChange = 'opacity, transform';
    });

    const step =
      children.length > 1
        ? Math.min(GROUP_STAGGER, GROUP_MAX_TOTAL / (children.length - 1))
        : GROUP_STAGGER;

    const animations: Array<ReturnType<typeof animate>> = [];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          children.forEach((element, index) => {
            const animation = animate(
              element,
              {
                opacity: [0, 1],
                transform: [hiddenTransform(element), settledTransform(element)],
              },
              {
                duration: REVEAL_DURATION,
                delay: baseDelaySeconds + index * step,
                ease: easeOutQuart,
              }
            );
            animations.push(animation);
            void animation.finished.then(() => clearInlineState(element)).catch(() => undefined);
          });
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.stop());
      clearAll();
    };
  }, [baseDelaySeconds]);

  return ref;
}

/**
 * Counts a number up to its target value. With the reduced-motion preference, jumps straight to
 * the final value.
 */
export function useCountUp(target: number, enabled = true): number {
  const [displayValue, setDisplayValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;

    if (!enabled || prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setDisplayValue(target);
      return;
    }

    let frameId = 0;
    let startTimestamp: number | null = null;

    const step = (timestamp: number) => {
      if (startTimestamp === null) {
        startTimestamp = timestamp;
      }
      const progress = Math.min(1, (timestamp - startTimestamp) / COUNT_UP_DURATION);
      const eased = easeOutQuart(progress);
      setDisplayValue(Math.round(from + (target - from) * eased));

      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };

    frameId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frameId);
      fromRef.current = target;
    };
  }, [target, enabled]);

  return displayValue;
}
