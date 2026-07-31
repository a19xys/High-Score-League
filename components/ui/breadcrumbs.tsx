import Link from "next/link";
import {
  createBreadcrumbTrail,
  type BreadcrumbItem,
} from "@/lib/breadcrumbs";

export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  const trail = createBreadcrumbTrail(items);

  return (
    <nav aria-label="Migas de pan" className="text-sm theme-text-muted">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((item, index) => {
          const isCurrent = index === trail.length - 1;

          return (
            <li
              className="flex min-w-0 items-center gap-2 break-words"
              key={`${index}-${item.label}`}
            >
              {index > 0 ? (
                <span aria-hidden="true" className="shrink-0 opacity-45">
                  /
                </span>
              ) : null}
              {isCurrent || !item.href ? (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={isCurrent ? "font-semibold theme-text" : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  className="rounded font-semibold transition hover:text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
                  href={item.href}
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
