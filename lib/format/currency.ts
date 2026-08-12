const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatBRL(value: number): string {
  // Replace non-breaking space (U+00A0) with regular space
  return brlFormatter.format(value).replace(/ /g, ' ')
}
