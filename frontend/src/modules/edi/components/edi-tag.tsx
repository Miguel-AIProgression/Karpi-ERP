interface EdiTagProps {
  testModus?: boolean
}

export function EdiTag({ testModus = false }: EdiTagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
        testModus
          ? 'bg-amber-100 text-amber-700'
          : 'bg-blue-100 text-blue-700'
      }`}
      title={testModus ? 'EDI in testmodus (Transus IsTestMessage=Y)' : 'EDI actief via Transus'}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      EDI{testModus ? ' · TEST' : ''}
    </span>
  )
}
