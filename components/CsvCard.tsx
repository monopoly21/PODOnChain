"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

export function CsvCard({
  kind,
  title,
  description,
}: {
  kind: "buyer" | "supplier"
  title: string
  description: string
}) {
  const [file, setFile] = useState<File | null>(null)
  const [output, setOutput] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function handleUpload() {
    if (!file) return
    setBusy(true)
    setOutput("")
    try {
      const form = new FormData()
      form.append("file", file)
      const uploadResponse = await fetch(`/api/me/imports/${kind}/upload`, { method: "POST", body: form })
      if (!uploadResponse.ok) {
        const details = await uploadResponse.text()
        throw new Error(details || "Upload failed")
      }

      const ingestResponse = await fetch(`/api/me/imports/${kind}/ingest`, { method: "POST" })
      const ingestJson = await ingestResponse.json()
      if (!ingestResponse.ok) {
        throw new Error(typeof ingestJson === "string" ? ingestJson : JSON.stringify(ingestJson))
      }

      setOutput(JSON.stringify(ingestJson, null, 2))
      router.refresh()
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="neo-surface space-y-4 p-6">
      <header className="space-y-2 border-b-[2px] border-border/40 pb-3">
        <h3 className="text-lg font-semibold uppercase tracking-wide">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide">
        Upload CSV
        <input
          type="file"
          accept=".csv"
          className="w-full rounded-[1.25rem] border-[3px] border-dashed border-border bg-card/80 px-4 py-3 text-sm font-medium"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <Button
        variant="outline"
        disabled={busy || !file}
        onClick={handleUpload}
        className="w-full justify-center"
      >
        {busy ? "Uploading…" : "Upload & Ingest"}
      </Button>
      {output && (
        <pre className="max-h-48 overflow-auto rounded-[1.25rem] border-[3px] border-border bg-muted/60 p-3 text-xs leading-relaxed">
          {output}
        </pre>
      )}
    </div>
  )
}
