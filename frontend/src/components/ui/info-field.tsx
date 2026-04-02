interface InfoFieldProps {
  label: string
  value: string | number | null | undefined
}

export function InfoField({ label, value }: InfoFieldProps) {
  return (
    <div>
      <span className="text-slate-500">{label}</span>
      <p className="font-medium">{value || '—'}</p>
    </div>
  )
}
