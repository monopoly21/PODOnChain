"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { useActiveAccount } from "thirdweb/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type FieldConfig = {
  name: string
  label: string
  placeholder?: string
  optional?: boolean
  lowercase?: boolean
  helpText?: string
  type?: "text" | "textarea"
}

export type AgentChatConfig = {
  key: string
  title: string
  description: string
  example?: string
  fields?: FieldConfig[]
  messageLabel?: string
  messagePlaceholder?: string
  messageHelper?: string
  defaultMessage?: string
  requiresWallet?: boolean
  sendLabel?: string
  buildMessage?: (input: { message: string; fields: Record<string, string> }) => string | null
}

type ChatMessage = {
  role: "user" | "agent"
  text: string
  timestamp: number
}

type AgentChatProps = {
  config: AgentChatConfig
}

export function AgentChat({ config }: AgentChatProps) {
  const account = useActiveAccount()
  const ownerWallet = useMemo(() => account?.address?.toLowerCase() ?? null, [account?.address])

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)

  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of config.fields ?? []) {
      initial[field.name] = ""
    }
    return initial
  })

  const [message, setMessage] = useState(config.defaultMessage ?? "")

  useEffect(() => {
    setMessage(config.defaultMessage ?? "")
  }, [config])

  function appendAgentReply(text: string) {
    setMessages((prev) => [
      ...prev,
      {
        role: "agent",
        text,
        timestamp: Date.now(),
      },
    ])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (config.requiresWallet !== false && !ownerWallet) {
      appendAgentReply("Connect your wallet before chatting with this agent.")
      return
    }

    const missingField = (config.fields ?? []).find((field) => {
      if (field.optional) return false
      const value = formValues[field.name]?.trim()
      return !value
    })
    if (missingField) {
      appendAgentReply(`Provide a value for ${missingField.label.toLowerCase()} before sending.`)
      return
    }

    const built = config.buildMessage?.({ message, fields: formValues }) ?? message.trim()
    const finalMessage = built.trim()

    if (!finalMessage) {
      appendAgentReply("Enter a message before sending.")
      return
    }

    const outgoing: ChatMessage = { role: "user", text: finalMessage, timestamp: Date.now() }
    setMessages((prev) => [...prev, outgoing])
    setSending(true)

    const payload: Record<string, unknown> = {
      agent: config.key,
      message: finalMessage,
      ownerWallet,
    }
    for (const [name, value] of Object.entries(formValues)) {
      if (value?.trim()) {
        payload[name] = value.trim()
      }
    }

    try {
      const response = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const errorText = await response.text()
        appendAgentReply(errorText || `Bridge responded with ${response.status}`)
      } else {
        const data = await response.json()
        appendAgentReply(data?.reply ?? "No reply from agent.")
      }
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Unknown error"
      appendAgentReply(`Failed to reach agent bridge: ${errText}`)
    } finally {
      setSending(false)
    }
  }

  if (config.requiresWallet !== false && !ownerWallet) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold">{config.title}</h3>
        <p className="text-xs text-muted-foreground">
          Connect your wallet to chat with the {config.title.toLowerCase()}.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">{config.title}</h3>
        <p className="text-xs text-muted-foreground">{config.description}</p>
        {config.example && (
          <p className="text-xs text-muted-foreground">
            Try <code className="font-mono">{config.example}</code>.
          </p>
        )}
      </header>

      <div className="max-h-64 overflow-y-auto space-y-2 rounded-md border border-dashed border-border bg-background/60 p-3 text-sm">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Conversations with the {config.title.toLowerCase()} will appear here.
          </p>
        ) : (
          messages.map((entry) => (
            <div
              key={entry.timestamp}
              className={cn("flex", entry.role === "user" ? "justify-end" : "justify-start")}
            >
              <span
                className={cn(
                  "inline-block max-w-[80%] rounded-md px-3 py-2 text-xs",
                  entry.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {entry.text}
              </span>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 text-sm">
        {(config.fields ?? []).map((field) => {
          const value = formValues[field.name] ?? ""
          const isTextarea = field.type === "textarea"
          return (
            <div className="grid gap-2" key={`${config.key}-${field.name}`}>
              <Label htmlFor={`${config.key}-${field.name}`}>
                {field.label}
                {field.optional ? " (optional)" : ""}
              </Label>
              {isTextarea ? (
                <Textarea
                  id={`${config.key}-${field.name}`}
                  rows={3}
                  placeholder={field.placeholder}
                  value={value}
                  onChange={(event) => {
                    const nextValue = field.lowercase ? event.target.value.toLowerCase() : event.target.value
                    setFormValues((prev) => ({ ...prev, [field.name]: nextValue }))
                  }}
                />
              ) : (
                <Input
                  id={`${config.key}-${field.name}`}
                  placeholder={field.placeholder}
                  value={value}
                  onChange={(event) => {
                    const nextValue = field.lowercase ? event.target.value.toLowerCase() : event.target.value
                    setFormValues((prev) => ({ ...prev, [field.name]: nextValue }))
                  }}
                />
              )}
              {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
            </div>
          )
        })}

        <div className="grid gap-2">
          <Label htmlFor={`${config.key}-message`}>{config.messageLabel ?? "Message"}</Label>
          <Textarea
            id={`${config.key}-message`}
            rows={2}
            placeholder={config.messagePlaceholder ?? `Ask the ${config.title.toLowerCase()}…`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          {config.messageHelper && <p className="text-xs text-muted-foreground">{config.messageHelper}</p>}
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={sending}>
            {sending ? "Sending…" : config.sendLabel ?? "Send to agent"}
          </Button>
        </div>
      </form>
    </div>
  )
}
