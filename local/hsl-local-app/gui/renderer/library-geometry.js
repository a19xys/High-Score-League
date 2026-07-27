export const LIBRARY_SIDEBAR_MIN = 340;
export const LIBRARY_SIDEBAR_DEFAULT = 440;
export const LIBRARY_SIDEBAR_MAX = 600;

export const LIBRARY_RESIZER_WIDTH = 8;
export const GAME_DETAIL_MIN_WIDTH = 540;
export const LIBRARY_ICON_TILE_MIN = 122;
export const LIBRARY_ICON_COLUMN_GAP = 8;

// 1 px panel border + 12 px panel padding on each side.
export const LIBRARY_PANEL_INLINE_INSET = 26;
// The pack viewport keeps 6 px on each side after the outer scroll padding was removed.
export const LIBRARY_PACK_VIEWPORT_INLINE_PADDING = 12;

export function clampLibrarySidebarWidth(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return LIBRARY_SIDEBAR_DEFAULT;
  }

  return Math.min(
    LIBRARY_SIDEBAR_MAX,
    Math.max(LIBRARY_SIDEBAR_MIN, Math.round(numeric)),
  );
}

export function libraryIconLayout(sidebarWidth, { scrollbarWidth = 17 } = {}) {
  const width = clampLibrarySidebarWidth(sidebarWidth);
  const safeScrollbarWidth = Math.max(0, Number(scrollbarWidth) || 0);
  const availableWidth = Math.max(
    0,
    width
      - LIBRARY_PANEL_INLINE_INSET
      - LIBRARY_PACK_VIEWPORT_INLINE_PADDING
      - safeScrollbarWidth,
  );
  const columns = Math.max(
    1,
    Math.floor(
      (availableWidth + LIBRARY_ICON_COLUMN_GAP)
        / (LIBRARY_ICON_TILE_MIN + LIBRARY_ICON_COLUMN_GAP),
    ),
  );
  const occupiedWidth = columns * LIBRARY_ICON_TILE_MIN
    + Math.max(0, columns - 1) * LIBRARY_ICON_COLUMN_GAP;

  return {
    availableWidth,
    columns,
    occupiedWidth,
    remainingWidth: availableWidth - occupiedWidth,
    sidebarWidth: width,
  };
}

export function minimumSidebarWidthForIconColumns(columns, { scrollbarWidth = 17 } = {}) {
  const safeColumns = Math.max(1, Math.floor(Number(columns) || 1));
  const safeScrollbarWidth = Math.max(0, Number(scrollbarWidth) || 0);

  return safeColumns * LIBRARY_ICON_TILE_MIN
    + Math.max(0, safeColumns - 1) * LIBRARY_ICON_COLUMN_GAP
    + LIBRARY_PANEL_INLINE_INSET
    + LIBRARY_PACK_VIEWPORT_INLINE_PADDING
    + safeScrollbarWidth;
}
