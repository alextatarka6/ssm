import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function StockChart({ bars }) {
  const container = useRef(null);

  useEffect(() => {
    if (!container.current) return;

    const pageStyles = getComputedStyle(document.documentElement);
    const chartBackground = pageStyles.getPropertyValue("--color-panel-strong").trim() || "#fff9ef";
    const chartTextColor = pageStyles.getPropertyValue("--color-text-muted").trim() || "#9e8a7a";
    const upColor = pageStyles.getPropertyValue("--color-success").trim() || "#1a9e6e";
    const downColor = pageStyles.getPropertyValue("--color-danger").trim() || "#a95d62";

    const chart = createChart(container.current, {
      width: container.current.clientWidth,
      height: 420,
      layout: {
        background: { color: chartBackground },
        textColor: chartTextColor,
        fontSize: 12,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(0,0,0,0.06)" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "rgba(0,0,0,0.2)", width: 1, style: 0, labelVisible: true },
        horzLine: { color: "rgba(0,0,0,0.2)", width: 1, style: 0, labelVisible: true },
      },
      rightPriceScale: {
        autoScale: true,
        scaleMargins: { top: 0.15, bottom: 0.1 },
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        tickMarkFormatter: (time) => {
          const d = new Date(time * 1000);
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        },
      },
      handleScroll: true,
      handleScale: true,
    });

    const firstClose = bars.length ? bars[0].close : 0;
    const lastClose = bars.length ? bars[bars.length - 1].close : 0;
    const lineColor = lastClose >= firstClose ? upColor : downColor;

    // Build hex top color with 30% opacity for the gradient fill
    const topColor = lineColor + "4d";

    const areaSeries = chart.addAreaSeries({
      lineColor,
      topColor,
      bottomColor: lineColor + "00",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: chartBackground,
      crosshairMarkerBackgroundColor: lineColor,
    });

    const data = bars.map((bar) => ({
      time: bar.time,
      value: bar.close,
    }));

    areaSeries.setData(data);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (container.current) {
        chart.applyOptions({ width: container.current.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [bars]);

  return <div className="chart-container" ref={container} />;
}
