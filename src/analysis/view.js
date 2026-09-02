function element(document, tagName, { className = "", text = null } = {}) {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== null) {
    node.textContent = text;
  }
  return node;
}

function requiredRegion(document, id) {
  const region = document.getElementById(id);
  if (region === null) {
    throw new Error(`Missing analysis region: ${id}`);
  }
  return region;
}

export function formatDuration(durationMs) {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function formatLocalTime(at) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

function formatDateLabel(dateKey) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function appendSummaryCard(document, container, label, value) {
  const card = element(document, "div", { className: "summary-card" });
  card.append(
    element(document, "span", { className: "summary-label", text: label }),
    element(document, "strong", { className: "summary-value", text: value }),
  );
  container.append(card);
}

export function createAnalysisView({ document = globalThis.document } = {}) {
  if (document === null || typeof document?.createElement !== "function") {
    throw new TypeError("A document is required");
  }

  const regions = {
    siteList: requiredRegion(document, "site-list"),
    manageSites: requiredRegion(document, "manage-sites"),
    summary: requiredRegion(document, "summary"),
    openChart: requiredRegion(document, "open-chart"),
    durationChart: requiredRegion(document, "duration-chart"),
    visitDetails: requiredRegion(document, "visit-details"),
    siteManager: requiredRegion(document, "site-manager"),
    errorBanner: requiredRegion(document, "error-banner"),
  };
  let controller = null;
  let managerRenderKey = null;
  let dialogError = null;

  regions.manageSites.addEventListener("click", () => {
    if (!regions.siteManager.open) {
      regions.siteManager.showModal();
    }
  });

  function belongsTo(node, region) {
    let current = node;
    while (current !== null && current !== undefined) {
      if (current === region) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  function captureFocusToken() {
    const active = document.activeElement;
    if (belongsTo(active, regions.siteList) && typeof active?.dataset?.siteId === "string") {
      return { kind: "site", key: active.dataset.siteId };
    }
    if (belongsTo(active, regions.openChart) && typeof active?.dataset?.dateKey === "string") {
      return { kind: "open-chart", key: active.dataset.dateKey };
    }
    if (belongsTo(active, regions.durationChart) && typeof active?.dataset?.dateKey === "string") {
      return { kind: "duration-chart", key: active.dataset.dateKey };
    }
    return null;
  }

  function restoreFocus(token, controls) {
    if (token === null) {
      return;
    }
    const target = controls[token.kind]?.get(token.key);
    if (typeof target?.focus === "function") {
      target.focus({ preventScroll: true });
    }
  }

  function renderError(error) {
    regions.errorBanner.hidden = error === null;
    regions.errorBanner.textContent = error?.message ?? "";
    if (dialogError !== null) {
      dialogError.hidden = error === null;
      dialogError.textContent = error?.message ?? "";
    }
  }

  function createDialogError() {
    dialogError = element(document, "div", { className: "dialog-error" });
    dialogError.setAttribute("role", "alert");
    dialogError.hidden = true;
    return dialogError;
  }

  function renderSites(model) {
    const heading = element(document, "h2", { text: "统计网站" });
    const items = element(document, "div", { className: "site-options" });
    const buttons = new Map();
    if (model.sites.length === 0) {
      items.append(element(document, "p", {
        className: "empty-copy",
        text: "还没有统计网站",
      }));
    }

    for (const site of model.sites) {
      const button = element(document, "button", { className: "site-option" });
      button.type = "button";
      button.dataset.siteId = site.id;
      button.disabled = model.pending;
      button.setAttribute("aria-pressed", String(site.id === model.selectedSiteId));
      button.addEventListener("click", () => controller?.selectSite(site.id));
      buttons.set(site.id, button);
      button.append(
        element(document, "strong", { className: "site-name", text: site.name }),
        element(document, "span", { className: "site-domain", text: site.domain }),
        element(document, "span", {
          className: `site-status ${site.enabled ? "is-enabled" : "is-disabled"}`,
          text: site.enabled ? "统计中" : "已停用",
        }),
      );
      items.append(button);
    }
    regions.siteList.replaceChildren(heading, items);
    return buttons;
  }

  function renderSummary(model) {
    const heading = element(document, "h2", { text: "最近 7 天合计" });
    const cards = element(document, "div", { className: "summary-grid" });
    const totals = model.report?.totals ?? { openCount: 0, activeMs: 0 };
    appendSummaryCard(document, cards, "打开次数", String(totals.openCount));
    appendSummaryCard(document, cards, "有效使用时长", formatDuration(totals.activeMs));
    regions.summary.replaceChildren(heading, cards);
  }

  function renderChart(region, model, { title, valueFor, formatValue, unit }) {
    const heading = element(document, "h2", { text: title });
    const chart = element(document, "div", { className: "trend-chart" });
    const days = model.report?.days ?? [];
    const maximum = Math.max(0, ...days.map(valueFor));
    const buttons = new Map();

    for (const day of days) {
      const value = valueFor(day);
      const formattedValue = formatValue(value);
      const button = element(document, "button", { className: "chart-day" });
      button.type = "button";
      button.dataset.dateKey = day.dateKey;
      button.disabled = model.pending;
      button.setAttribute("aria-pressed", String(day.dateKey === model.selectedDateKey));
      button.setAttribute("aria-label", `${day.dateKey}，${formattedValue}${unit}`);
      button.addEventListener("click", () => controller?.selectDate(day.dateKey));
      buttons.set(day.dateKey, button);

      const barTrack = element(document, "span", { className: "chart-track" });
      const bar = element(document, "span", { className: "chart-bar" });
      const height = value === 0 || maximum === 0
        ? 0
        : Math.round((value / maximum) * 100);
      bar.style.setProperty("--bar-height", `${height}%`);
      barTrack.append(bar);
      button.append(
        element(document, "span", { className: "chart-value", text: formattedValue }),
        barTrack,
        element(document, "span", { className: "chart-date", text: formatDateLabel(day.dateKey) }),
      );
      chart.append(button);
    }
    region.replaceChildren(heading, chart);
    return buttons;
  }

  function renderDetails(model) {
    const details = [...(model.report?.details ?? [])]
      .sort((left, right) => right.openedAt - left.openedAt);
    if (details.length === 0) {
      regions.visitDetails.textContent = "当天没有访问记录";
      return;
    }

    const list = element(document, "div", { className: "detail-list" });
    for (const detail of details) {
      const row = element(document, "article", { className: "detail-row" });
      const opened = element(document, "div", { className: "detail-cell" });
      opened.append(
        element(document, "span", { className: "detail-label", text: "打开" }),
        element(document, "strong", { text: formatLocalTime(detail.openedAt) }),
      );
      const ended = element(document, "div", { className: "detail-cell" });
      ended.append(
        element(document, "span", { className: "detail-label", text: "结束" }),
        element(document, "strong", {
          text: detail.ongoing ? "进行中" : formatLocalTime(detail.endedAt),
        }),
      );
      const duration = element(document, "div", { className: "detail-cell" });
      duration.append(
        element(document, "span", { className: "detail-label", text: "有效时长" }),
        element(document, "strong", { text: formatDuration(detail.durationMs) }),
      );
      row.append(opened, ended, duration);
      list.append(row);
    }
    regions.visitDetails.replaceChildren(list);
  }

  function operationButton(text, action, pending, actionName) {
    const button = element(document, "button", { text });
    button.type = "button";
    button.disabled = pending;
    button.dataset.action = actionName;
    button.addEventListener("click", action);
    return button;
  }

  function renderDeleteConfirmation(model, site) {
    const heading = element(document, "h2", { text: "确认删除历史" });
    const siteName = element(document, "p", { className: "confirmation-site" });
    siteName.append(
      element(document, "span", { text: "网站：" }),
      element(document, "strong", { text: site.name }),
    );
    const warning = element(document, "p", {
      className: "danger-copy",
      text: "这会永久删除该网站的全部访问记录，但保留网站配置；此操作无法撤销。",
    });
    const actions = element(document, "div", { className: "dialog-actions" });
    actions.append(
      operationButton(
        "取消",
        () => controller?.cancelDeleteHistory(),
        model.pending,
        "cancel-delete",
      ),
      operationButton(
        "永久删除历史",
        () => controller?.confirmDeleteHistory(),
        model.pending,
        "confirm-delete",
      ),
    );
    regions.siteManager.replaceChildren(
      heading,
      createDialogError(),
      siteName,
      warning,
      actions,
    );
  }

  function renderManager(model) {
    const confirmationSite = model.sites.find(
      site => site.id === model.deleteConfirmationSiteId,
    );
    if (confirmationSite !== undefined) {
      renderDeleteConfirmation(model, confirmationSite);
      return;
    }

    const heading = element(document, "h2", { text: "管理网站" });
    const close = operationButton(
      "关闭",
      () => regions.siteManager.close(),
      model.pending,
      "close-manager",
    );
    close.className = "dialog-close";

    const form = element(document, "form", { className: "site-form" });
    const nameLabel = element(document, "label", { text: "网站名称" });
    const nameInput = element(document, "input");
    nameInput.type = "text";
    nameInput.name = "name";
    nameInput.required = true;
    nameInput.setAttribute("autocomplete", "off");
    nameLabel.append(nameInput);
    const inputLabel = element(document, "label", { text: "网址或域名" });
    const siteInput = element(document, "input");
    siteInput.type = "text";
    siteInput.name = "input";
    siteInput.required = true;
    siteInput.setAttribute("placeholder", "例如 zhihu.com");
    siteInput.setAttribute("autocomplete", "url");
    inputLabel.append(siteInput);
    const submit = element(document, "button", { text: "添加网站" });
    submit.type = "submit";
    submit.disabled = model.pending;
    submit.dataset.action = "add-site";
    form.append(nameLabel, inputLabel, submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const result = await controller?.addSite({
        name: nameInput.value,
        input: siteInput.value,
      });
      if (result !== null) {
        form.reset();
      }
    });

    const listHeading = element(document, "h3", { text: "已添加网站" });
    const siteRows = element(document, "div", { className: "manager-sites" });
    if (model.sites.length === 0) {
      siteRows.append(element(document, "p", {
        className: "empty-copy",
        text: "添加第一个网站后，下一次有效打开将开始记录。",
      }));
    }
    for (const site of model.sites) {
      const row = element(document, "article", { className: "manager-site" });
      const identity = element(document, "div", { className: "manager-site-identity" });
      identity.append(
        element(document, "strong", { text: site.name }),
        element(document, "span", { text: site.domain }),
        element(document, "span", {
          className: "manager-site-status",
          text: site.enabled ? "统计中" : "已停用",
        }),
      );
      const actions = element(document, "div", { className: "manager-site-actions" });
      actions.append(
        operationButton(
          "删除历史",
          () => controller?.requestDeleteHistory(site.id),
          model.pending,
          "request-delete",
        ),
      );
      row.append(identity, actions);
      siteRows.append(row);
    }

    regions.siteManager.replaceChildren(
      heading,
      close,
      createDialogError(),
      form,
      listHeading,
      siteRows,
    );
  }

  function managerKey(model) {
    return JSON.stringify({
      sites: model.sites.map(site => ({
        id: site.id,
        name: site.name,
        domain: site.domain,
        enabled: site.enabled,
        createdAt: site.createdAt,
      })),
      pending: model.pending,
      deleteConfirmationSiteId: model.deleteConfirmationSiteId,
    });
  }

  return {
    bind(nextController) {
      controller = nextController;
    },

    render(model) {
      const focusToken = captureFocusToken();
      regions.manageSites.disabled = model.pending;
      const siteButtons = renderSites(model);
      renderSummary(model);
      const openChartButtons = renderChart(regions.openChart, model, {
        title: "每日打开次数",
        valueFor: day => day.openCount,
        formatValue: value => String(value),
        unit: " 次",
      });
      const durationChartButtons = renderChart(regions.durationChart, model, {
        title: "每日有效使用时长",
        valueFor: day => day.activeMs,
        formatValue: formatDuration,
        unit: "",
      });
      renderDetails(model);
      const nextManagerKey = managerKey(model);
      if (nextManagerKey !== managerRenderKey) {
        renderManager(model);
        managerRenderKey = nextManagerKey;
      }
      renderError(model.error);
      restoreFocus(focusToken, {
        site: siteButtons,
        "open-chart": openChartButtons,
        "duration-chart": durationChartButtons,
      });
    },
  };
}
