export type DocumentScrollElement = {
  scrollTop: number;
  style?: {
    scrollBehavior: string;
  };
};

export type DocumentScrollRuntime = {
  cancelFrame(frameId: number): void;
  getScrollingElement(): DocumentScrollElement | null;
  requestFrame(callback: () => void): number;
};

const browserDocumentScrollRuntime: DocumentScrollRuntime = {
  cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
  getScrollingElement: () => document.scrollingElement,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
};

export function captureDocumentScrollTop(
  runtime: DocumentScrollRuntime = browserDocumentScrollRuntime,
) {
  return runtime.getScrollingElement()?.scrollTop ?? null;
}

function restoreScrollElement(
  scrollingElement: DocumentScrollElement,
  scrollTop: number,
) {
  const previousInlineScrollBehavior = scrollingElement.style?.scrollBehavior;

  if (scrollingElement.style) {
    scrollingElement.style.scrollBehavior = "auto";
  }

  scrollingElement.scrollTop = scrollTop;

  if (scrollingElement.style) {
    scrollingElement.style.scrollBehavior = previousInlineScrollBehavior ?? "";
  }
}

export function restoreDocumentScrollTop(
  scrollTop: number,
  runtime: DocumentScrollRuntime = browserDocumentScrollRuntime,
) {
  const scrollingElement = runtime.getScrollingElement();

  if (scrollingElement) {
    restoreScrollElement(scrollingElement, scrollTop);
  }
}

export function verifyDocumentScrollTopOnNextFrame(
  scrollTop: number,
  onComplete: () => void,
  runtime: DocumentScrollRuntime = browserDocumentScrollRuntime,
) {
  return runtime.requestFrame(() => {
    const scrollingElement = runtime.getScrollingElement();

    if (scrollingElement && scrollingElement.scrollTop !== scrollTop) {
      restoreScrollElement(scrollingElement, scrollTop);
    }

    onComplete();
  });
}

export function cancelDocumentScrollFrame(
  frameId: number,
  runtime: DocumentScrollRuntime = browserDocumentScrollRuntime,
) {
  runtime.cancelFrame(frameId);
}
