"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { logContact } from "../../messages/actions";

export function LogContactDialog({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("call_out");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const map: Record<string, { channel: "call" | "whatsapp" | "in_person"; direction: "out" | "in" }> = {
    call_out: { channel: "call", direction: "out" }, call_in: { channel: "call", direction: "in" },
    wa_in: { channel: "whatsapp", direction: "in" }, wa_out: { channel: "whatsapp", direction: "out" }, visit: { channel: "in_person", direction: "in" },
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> Log a call / reply</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Log contact</DialogTitle><DialogDescription>So everyone knows what was said — especially about payments and follow-ups.</DialogDescription></DialogHeader>
        <Select value={kind} onValueChange={setKind}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="call_out">We called the owner</SelectItem><SelectItem value="call_in">Owner called us</SelectItem>
            <SelectItem value="wa_in">Owner replied on WhatsApp</SelectItem><SelectItem value="wa_out">We messaged on WhatsApp</SelectItem>
            <SelectItem value="visit">Spoke in person</SelectItem>
          </SelectContent></Select>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Will pay the balance on Friday; wants vaccine appointment next week" />
        <DialogFooter><Button disabled={pending || body.trim().length < 2} onClick={() => start(async () => {
          const r = await logContact({ customer_id: customerId, ...map[kind], body }); if (r.ok) { toast.success(r.message); setOpen(false); setBody(""); } else toast.error(r.message);
        })}>{pending && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
