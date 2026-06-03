import { useEffect, useRef, memo } from "react";

function TradingViewTimelineWidget() {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => {
      const currentContainer = container.current;
      if (!currentContainer) {
        return;
      }

      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-timeline.js";
      script.type = "text/javascript";
      script.async = true;
      script.innerHTML = `
        {
          "displayMode": "adaptive",
          "feedMode": "symbol",
          "symbol": "ICMARKETS:XAUUSD",
          "colorTheme": "dark",
          "isTransparent": true,
          "locale": "th_TH",
          "width": "100%",
          "height": "100%"
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
    <div className="tradingview-widget-container" ref={container} style={{ overflow: "hidden", height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget"></div>
    </div>
  );
}

export default memo(TradingViewTimelineWidget);
