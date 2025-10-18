import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input h-11 w-full min-w-0 rounded-[1.25rem] border-[3px] bg-card px-4 py-2 text-base font-medium transition-shadow duration-150 outline-none file:inline-flex file:h-8 file:border-[3px] file:border-border file:bg-secondary file:px-3 file:text-xs file:font-semibold file:uppercase file:tracking-wide disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 [box-shadow:var(--shadow-soft)]',
        'focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
