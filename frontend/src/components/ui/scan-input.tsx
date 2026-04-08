import { useState, useRef, useEffect } from 'react'
import { ScanBarcode } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type ScanFeedback = 'idle' | 'success' | 'error'

interface ScanInputProps {
  onScan: (code: string) => void
  placeholder?: string
  disabled?: boolean
  feedback?: ScanFeedback
  className?: string
}

/**
 * Shared scan input component for hardware barcode/QR scanners.
 * Auto-focuses on mount, handles rapid keystroke input ending with Enter.
 * Provides visual feedback: green flash on success, red shake on error.
 * Large touch target (min h-14) for tablet use.
 */
export function ScanInput({
  onScan,
  placeholder = 'Scan QR-code of barcode...',
  disabled = false,
  feedback = 'idle',
  className,
}: ScanInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Re-focus after feedback clears (so scanner can continue)
  useEffect(() => {
    if (feedback === 'idle') {
      inputRef.current?.focus()
    }
  }, [feedback])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      const code = value.trim()
      setValue('')
      onScan(code)
    }
  }

  // Re-focus input when clicking anywhere in the container
  const handleContainerClick = () => {
    inputRef.current?.focus()
  }

  return (
    <div
      className={cn('relative', className)}
      onClick={handleContainerClick}
    >
      <ScanBarcode
        size={24}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          'w-full min-h-14 pl-14 pr-4 py-3 text-lg rounded-[var(--radius)] border-2 transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400',
          'placeholder:text-slate-400',
          feedback === 'success' && 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200',
          feedback === 'error' && 'border-red-500 bg-red-50 ring-2 ring-red-200 animate-shake',
          feedback === 'idle' && 'border-slate-200 bg-white',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      />
    </div>
  )
}
