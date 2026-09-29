import { attachLongPressSiteReorder } from "./site-reorder.js";
import { createTrendChart } from "./trend-chart.js";

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

function appendSummaryCard(document, container, label, value) {
  const card = element(document, "div", { className: "summary-card" });
  card.append(
    element(document, "span", { className: "summary-label", text: label }),
    element(document, "strong", { className: "summary-value", text: value }),
  );
  container.append(card);
}

function siteListKey(model) {
  return JSON.stringify({
    sites: model.sites.map(site => ({
      id: site.id,
      name: site.name,
      domain: site.domain,
    })),
    selectedSiteId: model.selectedSiteId,
    pending: model.pending,
  });
}

export function createAnalysisView({
  document = globalThis.document,
  scheduler = globalThis,
} = {}) {
  if (document === null || typeof document?.createElement !== "function") {
    throw new TypeError("A document is required");
  }

  const regions = {
    siteList: requiredRegion(document, "site-list"),
    manageSites: requiredRegion(document, "manage-sites"),
    summary: requiredRegion(document, "summary"),
    trendChart: requiredRegion(document, "trend-chart"),
    visitDetails: requiredRegion(document, "visit-details"),
    siteManager: requiredRegion(document, "site-manager"),
    errorBanner: requiredRegion(document, "error-banner"),
  };
  let controller = null;
  const trendChart = createTrendChart({
    document,
    region: regions.trendChart,
    formatDuration,
    onSelectDate: dateKey => controller?.selectDate(dateKey),
    onNavigate: action => {
      if (action === "previous-week") return controller?.previousWeek();
      if (action === "next-week") return controller?.nextWeek();
      return controller?.goToLatest();
    },
  });
  let siteRenderKey = null;
  let siteButtons = new Map();
  let siteReordering = null;
  let managerRenderKey = null;
  let dialogError = null;
  let addSiteForm = null;
  let addSiteDraft = {
    name: "",
    input: "",
    privacyConsent: false,
  };

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
    if (belongsTo(active, regions.trendChart) && typeof active?.dataset?.chartControl === "string") {
      return { kind: "trend", key: active.dataset.chartControl };
    }
    return null;
  }

  function restoreFocus(token, controls) {
    if (token === null) {
      return;
    }
    let target = controls[token.kind]?.get(token.key);
    if (token.kind === "trend" && target?.disabled) {
      target = controls.trend.get("previous-week");
    }
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
    let reordering = null;
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
      button.setAttribute("aria-description", "鼠标长按网站，或触摸右侧把手，可调整顺序");
      button.setAttribute("aria-pressed", String(site.id === model.selectedSiteId));
      button.addEventListener("click", () => {
        if (!reordering?.consumeClick(site.id)) {
          controller?.selectSite(site.id);
        }
      });
      buttons.set(site.id, button);
      const dragHandle = element(document, "span", { className: "site-drag-handle" });
      dragHandle.dataset.dragHandle = "true";
      dragHandle.setAttribute("aria-hidden", "true");
      button.append(
        element(document, "strong", { className: "site-name", text: site.name }),
        element(document, "span", { className: "site-domain", text: site.domain }),
        dragHandle,
      );
      items.append(button);
    }
    reordering = attachLongPressSiteReorder({
      container: items,
      scheduler,
      onReorder: siteIds => controller?.reorderSites(siteIds),
    });
    regions.siteList.replaceChildren(heading, items);
    return { buttons, reordering };
  }

  function renderSummary(model) {
    const heading = element(document, "h2", { text: "今日概览" });
    const cards = element(document, "div", { className: "summary-grid" });
    const today = model.report?.todaySummary ?? { openCount: 0, activeMs: 0 };
    appendSummaryCard(document, cards, "今日打开次数", String(today.openCount));
    appendSummaryCard(document, cards, "今日有效使用时长", formatDuration(today.activeMs));
    regions.summary.replaceChildren(heading, cards);
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
      text: "现有访问记录会永久删除且无法撤销。网站配置会保留；删除后网站仍会持续统计，新访问会再次产生记录。",
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
    nameInput.value = addSiteDraft.name;
    nameInput.setAttribute("autocomplete", "off");
    nameLabel.append(nameInput);
    const inputLabel = element(document, "label", { text: "网址或域名" });
    const siteInput = element(document, "input");
    siteInput.type = "text";
    siteInput.name = "input";
    siteInput.required = true;
    siteInput.value = addSiteDraft.input;
    siteInput.setAttribute("placeholder", "例如 zhihu.com");
    siteInput.setAttribute("autocomplete", "url");
    inputLabel.append(siteInput);

    const disclosure = element(document, "section", {
      className: "privacy-disclosure",
    });
    const disclosureHeading = element(document, "h3", {
      text: "添加前请确认本地数据处理",
    });
    disclosureHeading.setAttribute("id", "privacy-disclosure-title");
    disclosure.setAttribute("aria-labelledby", "privacy-disclosure-title");
    const disclosureSummary = element(document, "p", {
      text: "WebTrace 会记录你填写的网站名称和主域名、打开时间、结束时间及有效观看时长，用于展示打开次数、最近 14 天趋势和访问明细。",
    });
    const disclosureDetails = element(document, "ul");
    for (const text of [
      "全部仅保存在当前 Chrome 配置文件的本机存储中；记录默认长期保留，可按网站永久删除历史，卸载扩展会移除扩展本地数据。",
      "不保存完整 URL、路径、查询参数、页面标题、网页内容、输入内容或 Cookie。",
      "不上传、不出售、不用于广告，也不与第三方共享。",
    ]) {
      disclosureDetails.append(element(document, "li", { text }));
    }
    const privacyCopy = element(document, "p", { className: "privacy-link" });
    const privacyLink = element(document, "a", { text: "查看完整隐私政策" });
    privacyLink.setAttribute("href", "https://zhangrh.shop/webtrace/privacy");
    privacyLink.setAttribute("target", "_blank");
    privacyLink.setAttribute("rel", "noopener noreferrer");
    privacyCopy.append(privacyLink);
    disclosure.append(
      disclosureHeading,
      disclosureSummary,
      disclosureDetails,
      privacyCopy,
    );

    const consentLabel = element(document, "label", {
      className: "privacy-consent",
    });
    const consentInput = element(document, "input");
    consentInput.type = "checkbox";
    consentInput.name = "privacyConsent";
    consentInput.required = true;
    consentInput.checked = addSiteDraft.privacyConsent;
    consentInput.addEventListener("change", () => {
      addSiteDraft.privacyConsent = consentInput.checked;
      consentInput.setCustomValidity("");
    });
    consentLabel.append(
      consentInput,
      element(document, "span", {
        text: "我已了解并同意 WebTrace 为提供统计功能，仅在本机记录上述数据。",
      }),
    );

    const submit = element(document, "button", { text: "添加网站" });
    submit.type = "submit";
    submit.disabled = model.pending;
    submit.dataset.action = "add-site";
    form.append(
      nameLabel,
      inputLabel,
      disclosure,
      consentLabel,
      submit,
    );
    addSiteForm = form;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      addSiteDraft = {
        name: nameInput.value,
        input: siteInput.value,
        privacyConsent: consentInput.checked,
      };
      if (!consentInput.checked) {
        consentInput.setCustomValidity("请先确认数据处理说明");
        consentInput.reportValidity();
        return;
      }
      consentInput.setCustomValidity("");
      const result = await controller?.addSite({
        name: nameInput.value,
        input: siteInput.value,
      });
      if (result !== null) {
        addSiteDraft = {
          name: "",
          input: "",
          privacyConsent: false,
        };
        addSiteForm?.reset();
      }
    });

    const managerHint = element(document, "p", {
      className: "manager-hint",
      text: "网站添加后将持续统计",
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
      managerHint,
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
      const nextSiteRenderKey = siteListKey(model);
      if (nextSiteRenderKey !== siteRenderKey) {
        siteReordering?.cancel?.();
        const renderedSites = renderSites(model);
        siteButtons = renderedSites.buttons;
        siteReordering = renderedSites.reordering;
        siteRenderKey = nextSiteRenderKey;
      }
      renderSummary(model);
      const trendControls = trendChart.render(model);
      renderDetails(model);
      const nextManagerKey = managerKey(model);
      if (nextManagerKey !== managerRenderKey) {
        renderManager(model);
        managerRenderKey = nextManagerKey;
      }
      renderError(model.error);
      restoreFocus(focusToken, {
        site: siteButtons,
        trend: trendControls,
      });
    },
  };
}
