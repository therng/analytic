import { useEffect, useRef, memo } from "react";

function TradingViewWidget() {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => {
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
          "displayMode": "multiple",
          "isTransparent": true,
          "locale": "en",
          "interval": "1h",
          "disableInterval": false,
          "width": "100%",
          "height": "100%",
          "symbol": "OANDA:XAUUSD",
          "showIntervalTabs": true
        }`;
      currentContainer.appendChild(script);

      return () => {
        script.remove();
        currentContainer.replaceChildren();
      };
    },
    []
  );

  return (
    <div className="tradingview-widget-container" ref={container} style={{ overflow: "hidden" }}>
      <div className="tradingview-widget-container__widget"></div>
    </div>
  );
}

export default memo(TradingViewWidget);
