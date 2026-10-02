/**
 * The weekly recap's time-saved estimate: what each thing the agent did
 * would have taken a person, in minutes. The rates are the user's to adjust.
 */
import type { NotchRates, NotchRecap } from "./types";

/** Until the user says otherwise: minutes per task, new file, edited file and command. */
export const DEFAULT_RATES: NotchRates = { task: 3, created: 10, edited: 5, command: 1 };

/** Time saved, in minutes. */
export function minutesSaved(recap: NotchRecap, rates: NotchRates = DEFAULT_RATES) {
  return Math.round(
    recap.tasks * rates.task + recap.created * rates.created + recap.edited * rates.edited + recap.commands * rates.command,
  );
}
