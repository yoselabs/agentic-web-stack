import * as SheetPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  title,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { title?: string }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 h-full w-3/4 max-w-sm border-l bg-background p-6 shadow-lg transition duration-300 ease-in-out data-[state=closed]:animate-out data-[state=open]:animate-in",
          className,
        )}
        {...props}
      >
        {title ? (
          <SheetPrimitive.Title className="font-semibold text-lg">
            {title}
          </SheetPrimitive.Title>
        ) : (
          <VisuallyHidden.Root>
            <SheetPrimitive.Title>Menu</SheetPrimitive.Title>
          </VisuallyHidden.Root>
        )}
        <VisuallyHidden.Root>
          <SheetPrimitive.Description>Side panel</SheetPrimitive.Description>
        </VisuallyHidden.Root>
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTrigger };
