import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-24 w-full rounded-[1.5rem] border-[3px] bg-card px-4 py-3 text-base font-medium transition-shadow duration-150 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60 [box-shadow:var(--shadow-soft)]',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
