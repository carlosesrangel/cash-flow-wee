export function EmptyState({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-lg font-medium text-neutral-700">{title}</h2>
      <p className="text-sm text-neutral-500">Em construção — chega na {phase}.</p>
    </div>
  )
}
