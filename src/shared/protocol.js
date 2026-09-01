export const WEBTRACE_PAGE_VISIBILITY = "WEBTRACE_PAGE_VISIBILITY";
export const WEBTRACE_ANALYSIS_READY = "WEBTRACE_ANALYSIS_READY";
export const WEBTRACE_ADD_SITE = "WEBTRACE_ADD_SITE";
export const WEBTRACE_SET_SITE_ENABLED = "WEBTRACE_SET_SITE_ENABLED";
export const WEBTRACE_DELETE_SITE_HISTORY = "WEBTRACE_DELETE_SITE_HISTORY";

export const SITE_ERROR_MESSAGES = Object.freeze({
  INVALID_NAME: "请输入网站名称",
  INVALID_URL: "请输入有效的网站地址",
  UNSUPPORTED_PROTOCOL: "仅支持 HTTP 或 HTTPS 网站",
  UNREGISTRABLE_DOMAIN: "请输入可注册的主域名",
  DUPLICATE_SITE: "该网站已经添加",
  SITE_NOT_FOUND: "找不到该网站配置",
  SITE_STATE_SYNC_FAILED: "网站配置已保存，但采集状态同步失败，请重试",
  DELETE_HISTORY_FAILED: "删除历史失败，请重试",
});

const INTERNAL_ERROR = Object.freeze({
  code: "INTERNAL_ERROR",
  message: "操作失败，请重试",
});

export class WebTraceCommandError extends Error {
  constructor(code, options = {}) {
    super(SITE_ERROR_MESSAGES[code] ?? INTERNAL_ERROR.message, options);
    this.name = "WebTraceCommandError";
    this.code = SITE_ERROR_MESSAGES[code] === undefined ? INTERNAL_ERROR.code : code;
  }
}

export function createSuccessResponse(data) {
  return { ok: true, data };
}

export function createErrorResponse(error) {
  const code = typeof error?.code === "string" && SITE_ERROR_MESSAGES[error.code] !== undefined
    ? error.code
    : INTERNAL_ERROR.code;
  return {
    ok: false,
    error: {
      code,
      message: SITE_ERROR_MESSAGES[code] ?? INTERNAL_ERROR.message,
    },
  };
}
