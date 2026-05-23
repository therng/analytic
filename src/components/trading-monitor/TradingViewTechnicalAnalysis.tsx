"use client";

import React, { useEffect, useRef, memo } from 'react';

interface TradingViewTechnicalAnalysisProps {
  symbol: string;
  interval: string;
  displayMode?: "single" | "gauge";
}

const TradingViewTechnicalAnalysisImpl = ({ symbol, interval, displayMode = "single" }: TradingViewTechnicalAnalysisProps) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentContainer = container.current;
    if (!currentContainer) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "colorTheme": "dark",
        "displayMode": "${displayMode}",
        "isTransparent": true,
        "locale": "en",
        "interval": "1D",
        "disableInterval": true,
        "width": "100%",
        "height": "100%",
        "symbol": "${symbol}",
        "showIntervalTabs": false
      }`;

    currentContainer.appendChild(script);

    // Clean up script on component unmount
    return () => {
      if (currentContainer && script.parentNode === currentContainer) {
        currentContainer.removeChild(script);
      }
    };
  }, [symbol, interval, displayMode]);

  return (
    <div className="tradingview-widget-container" ref={container}>
      <div className="tradingview-widget-container__widget"></div>
      <div className="tradingview-widget-copyright" style={{ opacity: 0, pointerEvents: "none" }}>
        <a href={`https://www.tradingview.com/symbols/${symbol.split(':')[1]}/?exchange=${symbol.split(':')[0]}`} rel="noopener nofollow" target="_blank">
          <span className="blue-text">${symbol.split(':')[1]} analysis</span>
        </a>
        <span className="trademark"> by TradingView</span>
      </div>
    </div>
  );
};

export const TradingViewTechnicalAnalysis = memo(TradingViewTechnicalAnalysisImpl);
