import React from 'react';

type MotionProxyComponent = React.ForwardRefExoticComponent<any>;

const MOTION_PROP_KEYS = new Set([
  'animate',
  'exit',
  'initial',
  'layout',
  'layoutId',
  'layoutScroll',
  'layoutRoot',
  'transition',
  'variants',
  'whileDrag',
  'whileFocus',
  'whileHover',
  'whileInView',
  'whileTap',
  'viewport',
  'drag',
  'dragConstraints',
  'dragDirectionLock',
  'dragElastic',
  'dragListener',
  'dragMomentum',
  'dragPropagation',
  'dragSnapToOrigin',
  'onAnimationComplete',
  'onAnimationStart',
  'onDrag',
  'onDragEnd',
  'onDragStart',
  'onHoverEnd',
  'onHoverStart',
  'onLayoutAnimationComplete',
  'onPan',
  'onPanEnd',
  'onPanStart',
  'onTap',
  'onTapCancel',
  'onTapStart',
]);

function stripMotionProps(props: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'ref') continue;
    if (MOTION_PROP_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}

function createMotionComponent(tag: string): MotionProxyComponent {
  return React.forwardRef<HTMLElement, any>(function MotionShim(props, ref) {
    const { children } = props;
    return React.createElement(tag, { ...stripMotionProps(props), ref }, children);
  });
}

const motionCache = new Map<string, MotionProxyComponent>();

export const motion = new Proxy(
  {},
  {
    get(_target, prop) {
      const tag = String(prop);
      if (!motionCache.has(tag)) {
        motionCache.set(tag, createMotionComponent(tag));
      }
      return motionCache.get(tag);
    },
  },
) as Record<string, MotionProxyComponent>;

interface AnimatePresenceProps {
  children?: React.ReactNode;
  initial?: boolean;
  mode?: string;
  propagate?: boolean;
  [key: string]: unknown;
}

export function AnimatePresence({ children }: AnimatePresenceProps) {
  return <>{children}</>;
}
