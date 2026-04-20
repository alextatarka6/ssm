import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function StockChart({ bars }) {
  const container = useRef(null);

  useEffect(() => {
    if (!container.current) return;

    const pageStyles = getComputedStyle(document.documentElement);
    const chartBackground = pageStyles.getPropertyValue("--color-panel-strong").trim() || "#fff9ef";
    const chartTextColor = pageStyles.getPropertyValue("--color-text").trim() || "#3f312d";
    const gridColor = pageStyles.getPropertyValue("--color-border").trim() || "rgba(115, 88, 72, 0.22)";
    const upColor = pageStyles.getPropertyValue("--color-success").trim() || "#6d9066";
    const downColor = pageStyles.getPropertyValue("--color-danger").trim() || "#a95d62";

    const chart = createChart(container.current, {
      width: container.current.clientWidth,
      height: 420,
      layout: {
        background: { color: chartBackground },
        textColor: chartTextColor,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: 1,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });

    const data = bars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
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
