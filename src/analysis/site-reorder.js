const HOLD_DELAY_MS = 350;

function orderedButtons(container) {
  return Array.from(container.children).filter(child => (
    typeof child?.dataset?.siteId === "string"
  ));
}

function orderedSiteIds(container) {
  return orderedButtons(container).map(button => button.dataset.siteId);
}

function sameOrder(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDragHandle(target, button) {
  let current = target;
  while (current !== null && current !== undefined && current !== button) {
    if (current.dataset?.dragHandle === "true") {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function restoreOrder(container, siteIds) {
  const buttonsById = new Map(orderedButtons(container).map(button => [
    button.dataset.siteId,
    button,
  ]));
  for (const siteId of siteIds) {
    const button = buttonsById.get(siteId);
    if (button !== undefined) {
      container.append(button);
    }
  }
}

function moveAtPointer(container, dragged, event) {
  const buttons = orderedButtons(container);
  const firstRect = buttons[0]?.getBoundingClientRect();
  const lastRect = buttons.at(-1)?.getBoundingClientRect();
  const horizontal = firstRect !== undefined
    && lastRect !== undefined
    && Math.abs(lastRect.left - firstRect.left) > Math.abs(lastRect.top - firstRect.top);
  const coordinate = horizontal ? event.clientX : event.clientY;
  const next = buttons
    .filter(button => button !== dragged)
    .find(button => {
      const rect = button.getBoundingClientRect();
      const midpoint = horizontal
        ? rect.left + rect.width / 2
        : rect.top + rect.height / 2;
      return coordinate < midpoint;
    });

  if (next === undefined) {
    container.append(dragged);
    return;
  }
  container.insertBefore(dragged, next);
}

export function attachLongPressSiteReorder({
  container,
  scheduler,
  onReorder,
  holdDelayMs = HOLD_DELAY_MS,
}) {
  let session = null;
  let suppressedSiteId = null;
  let suppressionTimer = null;

  function release(button, pointerId) {
    if (typeof button.releasePointerCapture === "function") {
      button.releasePointerCapture(pointerId);
    }
  }

  function end(event, commit) {
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    const current = session;
    scheduler.clearTimeout(current.holdTimer);
    release(current.button, current.pointerId);
    delete current.button.dataset.dragging;
    delete container.dataset.reordering;
    current.button.removeAttribute("aria-grabbed");
    session = null;

    if (!current.active) {
      return;
    }

    if (!commit) {
      restoreOrder(container, current.initialOrder);
      return;
    }

    suppressedSiteId = current.button.dataset.siteId;
    suppressionTimer = scheduler.setTimeout(() => {
      suppressedSiteId = null;
      suppressionTimer = null;
    }, 0);
    const nextOrder = orderedSiteIds(container);
    if (!sameOrder(nextOrder, current.initialOrder)) {
      onReorder(nextOrder);
    }
  }

  for (const button of orderedButtons(container)) {
    button.addEventListener("pointerdown", event => {
      const touchLikePointer = typeof event.pointerType === "string"
        && event.pointerType !== ""
        && event.pointerType !== "mouse";
      if (
        session !== null
        || button.disabled
        || event.isPrimary === false
        || event.button !== 0
        || (touchLikePointer && !isDragHandle(event.target, button))
      ) {
        return;
      }
      if (typeof button.setPointerCapture === "function") {
        button.setPointerCapture(event.pointerId);
      }
      const nextSession = {
        active: false,
        button,
        pointerId: event.pointerId,
        initialOrder: orderedSiteIds(container),
        holdTimer: null,
      };
      nextSession.holdTimer = scheduler.setTimeout(() => {
        if (session !== nextSession) {
          return;
        }
        nextSession.active = true;
        button.dataset.dragging = "true";
        container.dataset.reordering = "true";
        button.setAttribute("aria-grabbed", "true");
      }, holdDelayMs);
      session = nextSession;
    });
    button.addEventListener("pointermove", event => {
      if (
        session === null
        || !session.active
        || event.pointerId !== session.pointerId
      ) {
        return;
      }
      event.preventDefault();
      moveAtPointer(container, session.button, event);
    });
    button.addEventListener("pointerup", event => end(event, true));
    button.addEventListener("pointercancel", event => end(event, false));
  }

  return {
    consumeClick(siteId) {
      if (siteId !== suppressedSiteId) {
        return false;
      }
      suppressedSiteId = null;
      if (suppressionTimer !== null) {
        scheduler.clearTimeout(suppressionTimer);
        suppressionTimer = null;
      }
      return true;
    },
    cancel() {
      if (session !== null) {
        end({ pointerId: session.pointerId }, false);
      }
    },
  };
}
