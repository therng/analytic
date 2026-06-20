import { useEffect, useState } from "react";
import { PatternStage } from "@/lib/patterns/types";

const STAGE_DURATIONS = {
  trend: 800,
  formation: 800,
  pause: 400,
  outcome: 1000,
  fade: 400,
} as const;

const LOOP_DURATION = Object.values(STAGE_DURATIONS).reduce(
  (total, duration) => total + duration,
  0,
);

export const getPatternStageAtElapsedTime = (elapsedMs: number): PatternStage => {
  const loopElapsed = ((elapsedMs % LOOP_DURATION) + LOOP_DURATION) % LOOP_DURATION;

  if (loopElapsed < STAGE_DURATIONS.trend) {
    return "trend";
  }

  if (loopElapsed < STAGE_DURATIONS.trend + STAGE_DURATIONS.formation) {
    return "formation";
  }

  if (
    loopElapsed <
    STAGE_DURATIONS.trend + STAGE_DURATIONS.formation + STAGE_DURATIONS.pause
  ) {
    return "pause";
  }

  if (loopElapsed < LOOP_DURATION - STAGE_DURATIONS.fade) {
    return "outcome";
  }

  return "fade";
};

export const usePatternTimeline = () => {
  const [stage, setStage] = useState<PatternStage>("trend");

  useEffect(() => {
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      setStage(getPatternStageAtElapsedTime(performance.now() - startedAt));
    }, 80);

    return () => window.clearInterval(interval);
  }, []);

  return { stage };
};
