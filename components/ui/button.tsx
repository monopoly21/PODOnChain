import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[1.5rem] border-[3px] border-border bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-wide text-primary-foreground transition-transform duration-200 ease-out disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive [box-shadow:var(--shadow-hard)] hover:-translate-y-0.5 active:translate-y-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30',
        outline:
          'bg-card text-foreground [box-shadow:var(--shadow-soft)] hover:bg-secondary hover:text-secondary-foreground',
        secondary:
          'bg-secondary text-secondary-foreground',
        ghost:
          'border-transparent bg-transparent text-foreground [box-shadow:none] hover:bg-secondary/60',
        link: 'border-none bg-transparent p-0 text-foreground underline-offset-4 shadow-none hover:underline',
      },
      size: {
        default: 'min-h-11 px-6 has-[>svg]:px-5',
        sm: 'min-h-9 rounded-[1.25rem] gap-1.5 px-4 text-xs',
        lg: 'min-h-12 rounded-[1.75rem] px-8 text-base has-[>svg]:px-6',
        icon: 'size-11 rounded-[1.25rem]',
        'icon-sm': 'size-9 rounded-[1rem]',
        'icon-lg': 'size-12 rounded-[1.75rem]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
