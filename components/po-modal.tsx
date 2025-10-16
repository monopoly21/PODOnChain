"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export function CreatePoModal(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  skuId?: string
}) {
  const [qty, setQty] = React.useState(100)
  const [supplier, setSupplier] = React.useState("Supplier A")

  function submit() {
    props.onOpenChange(false)
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>SKU</Label>
            <Input disabled value={props.skuId ?? "Select from Catalog"} />
          </div>
          <div className="grid gap-2">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label>Supplier</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Create PO</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
