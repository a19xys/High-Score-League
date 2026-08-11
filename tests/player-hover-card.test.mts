import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { calculatePlayerHoverCardPosition } from "../lib/player-hover-card-position.ts";

const position = (trigger: {
  bottom: number;
  height: number;
  left: number;
  top: number;
  width: number;
}) =>
  calculatePlayerHoverCardPosition({
    cardGap: 6,
    panel: { height: 300, width: 320 },
    trigger,
    viewportHeight: 800,
    viewportPadding: 12,
    viewportWidth: 1_000,
  });

test("hover card positioning stays close at center, edges, header and viewport bottom", () => {
  const center = position({ bottom: 140, height: 40, left: 450, top: 100, width: 100 });
  assert.deepEqual(center, {
    left: 340,
    maxHeight: 300,
    side: "bottom",
    top: 140,
  });

  const left = position({ bottom: 140, height: 40, left: 0, top: 100, width: 40 });
  assert.equal(left.left, 12);
  assert.equal(left.side, "bottom");

  const right = position({ bottom: 140, height: 40, left: 960, top: 100, width: 40 });
  assert.equal(right.left, 668);
  assert.equal(right.side, "bottom");

  const header = position({ bottom: 50, height: 40, left: 400, top: 10, width: 60 });
  assert.equal(header.side, "bottom");
  assert.equal(header.top + 6, 56);

  const bottom = position({ bottom: 780, height: 40, left: 450, top: 740, width: 100 });
  assert.equal(bottom.side, "top");
  assert.equal(bottom.top + bottom.maxHeight + 6, 740);
});

test("hover card keeps a positive close grace, popup cancellation and tombstones", async () => {
  const [hoverCard, playerPill, topThree, podium, chat] = await Promise.all([
    readFile(join(process.cwd(), "components", "player-hover-card.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "player-pill.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "top-three-summary.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "podium-placeholder.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "league-chat.tsx"), "utf8"),
  ]);

  assert.match(hoverCard, /PLAYER_HOVER_OPEN_DELAY_MS = 600/);
  assert.match(hoverCard, /PLAYER_HOVER_CLOSE_DELAY_MS = 220/);
  assert.match(hoverCard, /onPointerEnter=\{clearCloseTimer\}/);
  assert.match(hoverCard, /onPointerLeave=\{scheduleClose\}/);
  assert.match(hoverCard, /if \(player\.isAnonymized\)[\s\S]*Usuario eliminado/);
  assert.doesNotMatch(playerPill, /hover:bg/);
  assert.doesNotMatch(topThree, /PlayerHoverCard[\s\S]{0,240}hover:bg/);
  assert.doesNotMatch(chat, /PlayerHoverCard[\s\S]{0,220}hover:text-circuit/);
  assert.match(podium, /PlayerHoverCard/);
});
