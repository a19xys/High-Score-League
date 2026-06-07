"use client";

import { useEffect, useState } from "react";
import { formatWeekCountdown } from "@/lib/week-display";

type WeekCountdownProps = {
  initialText: string;
  prefix?: string;
  target?: string;
  expiredText?: string;
  className?: string;
};

const minuteMs = 60 * 1000;

function getTargetTime(target?: string) {
  if (!target) {
    return null;
  }

  const time = new Date(target).getTime();
  return Number.isFinite(time) ? time : null;
}

export function WeekCountdown({
  initialText,
  prefix,
  target,
  expiredText,
  className,
}: WeekCountdownProps) {
  const [text, setText] = useState(initialText);

  useEffect(() => {
    const targetTime = getTargetTime(target);

    if (!prefix || targetTime === null) {
      setText(initialText);
      return;
    }

    let timeoutId: number | undefined;

    function getNextMinuteDelay() {
      const now = Date.now();
      return minuteMs - (now % minuteMs) + 25;
    }

    function update() {
      const now = new Date();
      const nextText =
        formatWeekCountdown(prefix!, target, now) ?? expiredText ?? initialText;
      setText(nextText);

      const diff = targetTime! - now.getTime();
      if (diff <= 0) {
        return;
      }

      timeoutId = window.setTimeout(update, getNextMinuteDelay());
    }

    update();

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [expiredText, initialText, prefix, target]);

  return <span className={className}>{text}</span>;
}
