import { useState, useEffect } from "react";
import { PatternStage } from "@/lib/patterns/types";

export const usePatternTimeline = () => {
  const [stage, setStage] = useState<PatternStage>("trend");

  useEffect(() => {
    let timer: NodeJS.Timeout;

    const runTimeline = () => {
      // Trend phase: 800ms
      setStage("trend");
      timer = setTimeout(() => {
        // Formation phase: 800ms (we'll sub-divide this for individual candles later)
        setStage("formation");
        timer = setTimeout(() => {
          // Pause phase: 400ms
          setStage("pause");
          timer = setTimeout(() => {
            // Outcome phase: 1000ms
            setStage("outcome");
            timer = setTimeout(() => {
              // Restart after outcome
              runTimeline();
            }, 1000);
          }, 400);
        }, 800);
      }, 800);
    };

    runTimeline();

    return () => clearTimeout(timer);
  }, []);

  return { stage };
};
