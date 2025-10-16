"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

export function CsvCard({ kind, title, description }: { kind: "buyer" | "supplier"; title: string; description: string }) {
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
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <header className="space-y-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      <input
        type="file"
        accept=".csv"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button
        className="rounded-md border border-primary px-3 py-1 text-sm font-medium text-primary disabled:opacity-70"
        disabled={busy || !file}
        onClick={handleUpload}
      >
        {busy ? "Uploading…" : "Upload & Ingest"}
      </button>
      {output && <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{output}</pre>}
    </div>
  )
}
