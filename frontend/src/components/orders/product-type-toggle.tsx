interface ProductTypeToggleProps {
  value: 'standaard' | 'op_maat'
  onChange: (type: 'standaard' | 'op_maat') => void
}

export function ProductTypeToggle({ value, onChange }: ProductTypeToggleProps) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onChange('standaard')}
        className={`px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
          value === 'standaard'
            ? 'bg-terracotta-500 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        Standaard product
      </button>
      <button
        type="button"
        onClick={() => onChange('op_maat')}
        className={`px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
          value === 'op_maat'
            ? 'bg-purple-600 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        Op maat product
      </button>
    </div>
  )
}
