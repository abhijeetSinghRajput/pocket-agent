import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/**
 * Motion, in one place. Two curves, as on the web app: things arriving decelerate softly, things
 * travelling start and stop gently. In-app responses are quick; nothing pops. Groups arrive in
 * reading order, a short step apart; a word or number that changes rolls instead of swapping.
 */
export const ease = {
  /** Arriving from nowhere. */
  out: Easing.bezier(0.25, 0.8, 0.25, 1),
  /** Travelling from one place to another. */
  move: Easing.bezier(0.45, 0, 0.1, 1),
  /** A touch response (sheets, pushes): quick off the mark, long settle. */
  touch: Easing.bezier(0.3, 0.75, 0.1, 1),
};

export const dur = { quick: 160, enter: 340, sheet: 460, slow: 600 } as const;
export const STAGGER = 55;

/** A press: a small, firm squeeze that springs back. */
export const pressSpring = { damping: 22, stiffness: 420, mass: 0.6 } as const;
export const settleSpring = { damping: 26, stiffness: 260, mass: 0.9 } as const;

export const timing = {
  quick: <T extends number>(to: T) => withTiming(to, { duration: dur.quick, easing: ease.out }),
  enter: <T extends number>(to: T) => withTiming(to, { duration: dur.enter, easing: ease.out }),
  move: <T extends number>(to: T) => withTiming(to, { duration: dur.enter, easing: ease.move }),
  sheet: <T extends number>(to: T) => withTiming(to, { duration: dur.sheet, easing: ease.touch }),
};
export const spring = <T extends number>(to: T) => withSpring(to, settleSpring);

/** Enter/exit presets (Reanimated layout animations). */
export const enter = {
  fade: FadeIn.duration(dur.enter).easing(ease.out),
  /** An item arriving: fades and rises into place; `index` staggers a group in reading order. */
  rise: (index = 0) => {
    const delay = Math.min(index, 8) * STAGGER;
    return FadeInDown.duration(dur.enter + 40)
      .easing(ease.out)
      .delay(delay)
      .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
  },
  /** A small thing settling in (a badge, a tick): scales up from just under its size. */
  pop: () => {
    'worklet';
    const config = { duration: dur.enter, easing: ease.out };
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
      animations: { opacity: withTiming(1, config), transform: [{ scale: withTiming(1, config) }] },
    };
  },
  /** A changed word rolling in from just below its line. */
  roll: FadeInDown.duration(dur.enter)
    .easing(ease.out)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 9 }] }),
};
export const exit = { fade: FadeOut.duration(dur.quick).easing(ease.out) };
/** Neighbours making room when a list changes. */
export const layout = LinearTransition.duration(dur.enter).easing(ease.move);
