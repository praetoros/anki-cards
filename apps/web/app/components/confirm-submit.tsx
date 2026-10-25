import { Button } from "@anki-cards/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@anki-cards/ui/components/dialog";
import { useState } from "react";
import { Form } from "react-router";

/**
 * A post button that asks first when `confirm` is set; otherwise it submits straight away.
 * `fields` become hidden inputs of the form.
 */
export function ConfirmSubmit({
  fields,
  confirm,
  children,
  size = "sm",
  variant = "default",
  disabled,
}: {
  fields: Record<string, string>;
  confirm?: { title: string; description: React.ReactNode; action: string } | null;
  children: React.ReactNode;
  size?: "xs" | "sm" | "default";
  variant?: "default" | "outline" | "ghost" | "secondary";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inputs = Object.entries(fields).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
  if (!confirm) {
    return (
      <Form method="post">
        {inputs}
        <Button type="submit" size={size} variant={variant} disabled={disabled}>
          {children}
        </Button>
      </Form>
    );
  }
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{confirm.title}</DialogTitle>
          <DialogDescription>{confirm.description}</DialogDescription>
          <Form method="post" onSubmit={() => setOpen(false)}>
            {inputs}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit">{confirm.action}</Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
