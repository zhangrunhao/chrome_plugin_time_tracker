const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function element(document, tagName, className, text = null) {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function svgElement(document, tagName, attributes) {
  const node = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}

function position(index, count, value, maximum) {
  return {
    x: count <= 1 ? 50 : index / (count - 1) * 100,
    y: maximum === 0 ? 84 : 84 - value / maximum * 62,
  };
}

export function createTrendChart({ document, region, formatDuration, onSelectDate, onNavigate }) {
  const metrics = [
    { key: "openCount", title: "打开次数", axis: "left", format: value => `${value} 次` },
    { key: "activeMs", title: "有效使用时长", axis: "right", format: formatDuration },
  ];
  let renderKey = null;
  let controls = new Map();
  let activeMetric = "";
  let hoveredDateKey = null;
  let scrollRegion = null;

  function highlight(metric) {
    activeMetric = metric;
    region.dataset.activeMetric = metric;
  }

  function focusedMetric() {
    const active = document.activeElement;
    return controls.get(active?.dataset?.chartControl) === active
      ? active.dataset.metric ?? ""
      : "";
  }

  return {
    render(model) {
      const days = model.report?.days ?? [];
      const range = model.report?.range ?? model.range;
      const nextKey = JSON.stringify({
        days, range, selectedDateKey: model.selectedDateKey,
        todayDateKey: model.todayDateKey, pending: model.pending,
      });
      if (nextKey === renderKey) return controls;
      renderKey = nextKey;
      controls = new Map();
      const scrollLeft = scrollRegion?.scrollLeft ?? 0;

      function control(key, className, text) {
        const button = element(document, "button", className, text);
        button.type = "button";
        button.dataset.chartControl = key;
        button.disabled = model.pending;
        controls.set(key, button);
        return button;
      }

      const header = element(document, "div", "trend-heading");
      const identity = element(document, "div", "trend-identity");
      identity.append(element(document, "h2", "", "使用趋势"));
      const rangeLabel = element(document, "p", "trend-range", range
        ? `${range.startDateKey} — ${range.endDateKey}` : "暂无记录");
      rangeLabel.setAttribute("aria-live", "polite");
      identity.append(rangeLabel);
      const navigation = element(document, "div", "trend-navigation");
      navigation.setAttribute("role", "group");
      navigation.setAttribute("aria-label", "按周浏览时间轴");
      const latest = !range || range.endDateKey >= model.todayDateKey;
      for (const [key, label] of [
        ["previous-week", "← 前一周"], ["next-week", "后一周 →"], ["latest", "回到最新"],
      ]) {
        const button = control(key, "trend-nav-button", label);
        button.disabled = model.pending || days.length === 0 || (key !== "previous-week" && latest);
        button.addEventListener("click", () => onNavigate(key));
        navigation.append(button);
      }
      header.append(identity, navigation);

      const legend = element(document, "div", "chart-legend");
      legend.setAttribute("role", "group");
      legend.setAttribute("aria-label", "突出显示指标");
      const scroll = element(document, "div", "chart-scroll");
      const canvas = element(document, "div", "chart-canvas");
      const plot = element(document, "div", "chart-plot");
      const svg = svgElement(document, "svg", {
        class: "trend-line", viewBox: "0 0 100 100", preserveAspectRatio: "none",
        "aria-hidden": "true", focusable: "false",
      });
      for (const y of [22, 53, 84]) {
        svg.append(svgElement(document, "line", {
          class: "trend-baseline", x1: "0", x2: "100", y1: y, y2: y,
        }));
      }
      plot.append(svg);

      const cursor = element(document, "div", "chart-cursor");
      const tooltip = element(document, "span", "chart-tooltip");
      tooltip.setAttribute("role", "tooltip");
      cursor.append(tooltip);
      function showDate(dateKey) {
        const index = days.findIndex(day => day.dateKey === dateKey);
        cursor.hidden = index === -1;
        if (index === -1) return;
        const { x } = position(index, days.length, 0, 0);
        cursor.style.setProperty("--point-x", String(x));
        tooltip.dataset.edge = index === 0 ? "start" : index === days.length - 1 ? "end" : "middle";
        tooltip.textContent = dateKey;
      }
      function activate(metric, dateKey = null) {
        highlight(metric);
        if (dateKey !== null) {
          hoveredDateKey = dateKey;
          showDate(dateKey);
        }
      }

      for (const metric of metrics) {
        const maximum = Math.max(0, ...days.map(day => day[metric.key]));
        const positions = days.map((day, index) => position(index, days.length, day[metric.key], maximum));
        const legendButton = control(`metric-${metric.key}`, "chart-legend-item", metric.title);
        legendButton.dataset.metric = metric.key;
        legendButton.setAttribute("aria-label", `${metric.title}（${metric.axis === "left" ? "左" : "右"}轴），突出显示整条折线`);
        legendButton.addEventListener("pointerenter", () => activate(metric.key));
        legendButton.addEventListener("pointerleave", () => highlight(focusedMetric()));
        legendButton.addEventListener("focus", () => activate(metric.key));
        legendButton.addEventListener("blur", () => highlight(""));
        legendButton.addEventListener("click", () => activate(metric.key));
        legend.append(legendButton);

        const axis = element(document, "div", `chart-axis chart-axis-${metric.axis}`);
        axis.dataset.metric = metric.key;
        axis.setAttribute("aria-label", `${metric.title}刻度`);
        // Integer counts avoid fractional visit ticks when the daily maximum is small.
        const ticks = metric.key === "openCount" && maximum % 2 !== 0
          ? [maximum, 0] : [maximum, maximum / 2, 0];
        for (const value of new Set(ticks)) {
          const tick = element(document, "span", "chart-axis-tick", metric.format(value));
          tick.style.setProperty("--point-y", String(position(0, 1, value, maximum).y));
          axis.append(tick);
        }
        plot.append(axis);

        const polyline = svgElement(document, "polyline", {
          class: "trend-polyline", points: positions.map(({ x, y }) => `${x},${y}`).join(" "),
        });
        polyline.dataset.metric = metric.key;
        const hit = svgElement(document, "path", {
          class: "trend-hit-area",
          d: positions.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" "),
        });
        hit.dataset.metric = metric.key;
        hit.addEventListener("pointerenter", () => activate(metric.key));
        hit.addEventListener("pointerleave", () => highlight(focusedMetric()));
        svg.append(polyline, hit);

        const points = element(document, "div", "chart-points");
        points.dataset.metric = metric.key;
        for (const [index, day] of days.entries()) {
          const formattedValue = metric.format(day[metric.key]);
          const { x, y } = positions[index];
          const button = control(`point-${metric.key}-${day.dateKey}`, "chart-point", null);
          button.dataset.dateKey = day.dateKey;
          button.dataset.metric = metric.key;
          button.style.setProperty("--point-x", String(x));
          button.style.setProperty("--point-y", String(y));
          button.setAttribute("aria-pressed", String(day.dateKey === model.selectedDateKey));
          button.setAttribute("aria-label", `${day.dateKey}，${metric.title} ${formattedValue}`);
          button.addEventListener("click", () => onSelectDate(day.dateKey));
          button.addEventListener("pointerenter", () => activate(metric.key, day.dateKey));
          button.addEventListener("pointerleave", () => highlight(focusedMetric()));
          button.addEventListener("focus", () => activate(metric.key, day.dateKey));
          button.addEventListener("blur", () => highlight(""));
          button.append(
            element(document, "span", "chart-point-marker"),
            element(document, "span", "chart-point-value", formattedValue),
          );
          points.append(button);
        }
        plot.append(points);
      }

      const labels = element(document, "div", "chart-labels");
      for (const [index, day] of days.entries()) {
        const [, month, date] = day.dateKey.split("-");
        const label = element(document, "span", "chart-label", `${Number(month)}/${Number(date)}`);
        label.style.setProperty("--point-x", String(position(index, days.length, 0, 0).x));
        label.dataset.selected = String(day.dateKey === model.selectedDateKey);
        labels.append(label);
      }
      plot.addEventListener("pointermove", event => {
        if (days.length === 0) return;
        const bounds = plot.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        hoveredDateKey = days[Math.round(ratio * (days.length - 1))].dateKey;
        showDate(hoveredDateKey);
      });
      plot.addEventListener("pointerleave", () => {
        hoveredDateKey = null;
        showDate(model.selectedDateKey);
        highlight(focusedMetric());
      });
      plot.append(cursor, labels);
      canvas.append(plot);
      scroll.append(canvas);
      const hint = element(document, "p", "chart-hint", "每次移动一周 · 悬停折线或图例查看每日数值，点击数据点查看明细");
      region.replaceChildren(header, legend, scroll, hint);
      scroll.scrollLeft = scrollLeft;
      scrollRegion = scroll;
      highlight(activeMetric);
      showDate(days.some(day => day.dateKey === hoveredDateKey) ? hoveredDateKey : model.selectedDateKey);
      return controls;
    },
  };
}
