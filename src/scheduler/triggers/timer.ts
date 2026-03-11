import type { TimerCondition } from "./types.js";

export function evaluateTimer(condition: TimerCondition): boolean {
  return Date.now() >= condition.wakeAt;
}
