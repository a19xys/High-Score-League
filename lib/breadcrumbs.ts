export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function createBreadcrumbTrail(items: readonly BreadcrumbItem[]) {
  const trail: BreadcrumbItem[] = [{ label: "Liga", href: "/" }, ...items];

  return trail.map((item, index) =>
    index === trail.length - 1 ? { label: item.label } : item,
  );
}
