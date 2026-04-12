import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function HeikinAshiChart({ bars }) {
  const container = useRef(null);

  useEffect(() => {
    if (!container.current) return;

    const chart = createChart(container.current, {
      width: container.current.clientWidth,
      height: 420,
      layout: {
        background: { color: "#0f172a" },
        textColor: "#e2e8f0",
      },
      grid: {
        vertLines: { color: "#334155" },
        horzLines: { color: "#334155" },
      },
      crosshair: {
        mode: 1,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const data = bars.map((bar) => ({
      time: bar.time,
      open: bar.ha_open,
      high: bar.ha_high,
      low: bar.ha_low,
      close: bar.ha_close,
    }));

    candlestickSeries.setData(data);
    chart.timeScale().fitContent();

    const handleResize = () => {
      chart.applyOptions({ width: container.current.clientWidth });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [bars]);

  return <div className="chart-container" ref={container} />;
}
