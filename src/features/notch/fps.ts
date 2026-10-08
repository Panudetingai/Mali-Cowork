/**
 * How often the notch's bots draw. The pill sits on screen all day, and each
 * bot redraws itself every frame: at 30 a second a bot moves the same (its
 * motion runs on time) for half the work. The small bot on the folded pill
 * and the ones in the ask box's trail always run at 30; on a machine with
 * few cores (an older dual-core with hyper-threading) every bot does.
 */
const SLOW_MACHINE =
  typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 8) <= 4;

export const BOT_FPS_FULL = SLOW_MACHINE ? 30 : 60;
export const BOT_FPS_SMALL = 30;
