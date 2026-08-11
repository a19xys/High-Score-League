export type HoverCardRect = {
  bottom: number;
  height: number;
  left: number;
  top: number;
  width: number;
};

export type HoverCardPosition = {
  left: number;
  maxHeight: number;
  side: "top" | "bottom";
  top: number;
};

export function calculatePlayerHoverCardPosition({
  cardGap,
  panel,
  trigger,
  viewportHeight,
  viewportPadding,
  viewportWidth,
}: {
  cardGap: number;
  panel: Pick<HoverCardRect, "height" | "width">;
  trigger: HoverCardRect;
  viewportHeight: number;
  viewportPadding: number;
  viewportWidth: number;
}): HoverCardPosition {
  const availableBelow = Math.max(
    0,
    viewportHeight - viewportPadding - trigger.bottom - cardGap,
  );
  const availableAbove = Math.max(
    0,
    trigger.top - viewportPadding - cardGap,
  );
  const side =
    panel.height <= availableBelow || availableBelow >= availableAbove
      ? "bottom"
      : "top";
  const availableHeight = side === "bottom" ? availableBelow : availableAbove;
  const maxHeight = Math.min(panel.height, availableHeight);
  const triggerCenter = trigger.left + trigger.width / 2;
  const idealLeft = triggerCenter - panel.width / 2;
  const maxLeft = Math.max(
    viewportPadding,
    viewportWidth - panel.width - viewportPadding,
  );
  const left = Math.min(Math.max(viewportPadding, idealLeft), maxLeft);
  const top =
    side === "bottom"
      ? trigger.bottom
      : Math.max(viewportPadding, trigger.top - cardGap - maxHeight);

  return { left, maxHeight, side, top };
}
