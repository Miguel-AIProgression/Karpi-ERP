import { useState } from 'react'
import { Mail, Pencil, Phone, X } from 'lucide-react'
import { useUpdateVerteg } from '@/hooks/use-vertegenwoordigers'

type Field = 'email' | 'telefoon'

interface Props {
  code: string
  field: Field
  value: string | null
}

const ICON: Record<Field, typeof Mail> = {
  email: Mail,
  telefoon: Phone,
}

const PLACEHOLDER: Record<Field, string> = {
  email: 'naam@voorbeeld.com',
  telefoon: '06 12 34 56 78',
}

export function VertegContactEdit({ code, field, value }: Props) {
  const [editing, setEditing] = useState(false)
  const mutation = useUpdateVerteg()
  const Icon = ICON[field]

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const raw = (form.elements.namedItem(field) as HTMLInputElement).value.trim()
    const next = raw === '' ? null : raw
    if (next === value) {
      setEditing(false)
      return
    }
    try {
      await mutation.mutateAsync({ code, patch: { [field]: next } })
      setEditing(false)
    } catch {
      // mutation.error wordt zichtbaar via UI
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className="inline-flex items-center gap-1">
        <Icon size={14} className="text-slate-400" />
        <input
          name={field}
          type={field === 'email' ? 'email' : 'tel'}
          defaultValue={value ?? ''}
          placeholder={PLACEHOLDER[field]}
          autoFocus
          className="px-2 py-0.5 rounded-[var(--radius-sm)] border border-terracotta-300 text-sm w-52 focus:outline-none focus:ring-1 focus:ring-terracotta-300"
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="text-xs text-terracotta-500 font-medium disabled:opacity-50"
        >
          OK
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="p-0.5 text-slate-400 hover:text-slate-600"
        >
          <X size={12} />
        </button>
      </form>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-sm text-slate-500 group">
      <Icon size={14} />
      {value ? (
        field === 'email' ? (
          <a href={`mailto:${value}`} className="text-slate-700 hover:underline">
            {value}
          </a>
        ) : (
          <a href={`tel:${value}`} className="text-slate-700 hover:underline">
            {value}
          </a>
        )
      ) : (
        <span className="italic text-slate-400">{field === 'email' ? 'Geen email' : 'Geen telefoon'}</span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Pencil size={11} />
        Wijzig
      </button>
    </span>
  )
}
