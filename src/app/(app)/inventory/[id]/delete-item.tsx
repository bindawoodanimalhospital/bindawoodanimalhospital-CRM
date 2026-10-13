"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteItem } from "../actions";

/** Shown only for items never used anywhere (no bills, stock or history) — e.g. created by mistake. */
export function DeleteItemButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = () => start(async () => {
    const r = await deleteItem(id, reason);
    if (r.ok) { toast.success(r.message); setOpen(false); router.push("/inventory"); } else toast.error(r.message);
  });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-danger hover:text-danger"><Trash2 /> Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It has never been used — no bills, stock or history — so it can be removed completely. The deletion is recorded in the activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional) — e.g. created by mistake, duplicate" />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
