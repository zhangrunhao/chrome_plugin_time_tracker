function copyVisit(visit) {
  return {
    ...visit,
    activeIntervals: visit.activeIntervals.map(interval => ({ ...interval })),
  };
}

function clampedAt(visit, at) {
  return Math.max(visit.lastActivityAt, at);
}

function lastInterval(visit) {
  return visit.activeIntervals.at(-1) ?? null;
}

function hasOpenInterval(visit) {
  return lastInterval(visit)?.endedAt === null;
}

export function createVisit({ id, siteId, openedAt }) {
  return {
    id,
    siteId,
    openedAt,
    endedAt: null,
    activeIntervals: [],
    lastConfirmedAt: openedAt,
    lastActivityAt: openedAt,
  };
}

export function startInterval(visit, at) {
  const next = copyVisit(visit);
  if (visit.endedAt !== null || hasOpenInterval(visit)) {
    return next;
  }

  const activityAt = clampedAt(visit, at);
  return {
    ...next,
    activeIntervals: [...next.activeIntervals, { startedAt: activityAt, endedAt: null }],
    lastConfirmedAt: Math.max(visit.lastConfirmedAt, activityAt),
    lastActivityAt: activityAt,
  };
}

export function confirmInterval(visit, at) {
  const next = copyVisit(visit);
  if (!hasOpenInterval(visit)) {
    return next;
  }

  const activityAt = clampedAt(visit, at);
  return {
    ...next,
    lastConfirmedAt: Math.max(visit.lastConfirmedAt, activityAt),
    lastActivityAt: activityAt,
  };
}

function closeOpenInterval(visit, at, { endVisit: shouldEndVisit }) {
  const next = copyVisit(visit);
  if (shouldEndVisit && visit.endedAt !== null) {
    return next;
  }

  const activityAt = clampedAt(visit, at);
  const interval = lastInterval(visit);
  const closedAt = interval?.endedAt === null ? Math.max(interval.startedAt, activityAt) : activityAt;
  const activeIntervals = interval?.endedAt === null
    ? [...next.activeIntervals.slice(0, -1), { ...interval, endedAt: closedAt }]
    : next.activeIntervals;

  return {
    ...next,
    ...(shouldEndVisit ? { endedAt: activityAt } : {}),
    activeIntervals,
    lastConfirmedAt: Math.max(visit.lastConfirmedAt, closedAt),
    lastActivityAt: activityAt,
  };
}

export function pauseInterval(visit, at) {
  if (!hasOpenInterval(visit)) {
    return copyVisit(visit);
  }
  return closeOpenInterval(visit, at, { endVisit: false });
}

export function endVisit(visit, at) {
  return closeOpenInterval(visit, at, { endVisit: true });
}

export function recoverVisitAfterBrowserExit(visit) {
  const next = copyVisit(visit);
  if (visit.endedAt !== null) {
    return next;
  }

  const interval = lastInterval(visit);
  const activeIntervals = interval?.endedAt === null
    ? [...next.activeIntervals.slice(0, -1), { ...interval, endedAt: visit.lastConfirmedAt }]
    : next.activeIntervals;

  return {
    ...next,
    endedAt: visit.lastConfirmedAt,
    activeIntervals,
  };
}

export function getVisitDurationMs(visit, { asOf = Date.now() } = {}) {
  return visit.activeIntervals.reduce((total, interval) => {
    const endedAt = interval.endedAt === null
      ? Math.min(asOf, visit.lastConfirmedAt)
      : interval.endedAt;
    return total + Math.max(0, endedAt - interval.startedAt);
  }, 0);
}
