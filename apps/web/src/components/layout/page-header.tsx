import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  /** Action buttons (refresh, edit, …), shown left of the menu. */
  children?: ReactNode;
  /** The page's ⋯ menu: always the rightmost control, top right. */
  menu?: ReactNode;
};

/** Portal targets for client components that own a header control. */
export const PAGE_ACTIONS_SLOT_ID = "ot-page-actions";
export const PAGE_MENU_SLOT_ID = "ot-page-menu";

/**
 * Page title with its controls top right, in a fixed order: action buttons,
 * then the ⋯ menu last. Client components deeper in the page put their
 * controls here with <PageActions> (portaled into the slots).
 */
export function PageHeader({
  title,
  subtitle,
  children,
  menu,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-[hsl(var(--foreground))] max-sm:text-2xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {children}
        <div
          id={PAGE_ACTIONS_SLOT_ID}
          className="flex items-center gap-2 empty:hidden"
        />
        <div id={PAGE_MENU_SLOT_ID} className="flex empty:hidden">
          {menu}
        </div>
      </div>
    </div>
  );
}
