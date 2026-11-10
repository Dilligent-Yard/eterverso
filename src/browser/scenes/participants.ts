export function participantRowHtml(name: string, escapeAttribute: (value: string) => string): string {
  return '<div class="infobox-participant-row" style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px;align-items:center;">' +
    '<input type="text" class="ib-participant-name" value="' + escapeAttribute(name || '') + '" placeholder="Nome do participante">' +
    '<button type="button" class="btn btn-small btn-danger" onclick="removeParticipanteRow(this)">Remover</button>' +
    '</div>';
}

export function participantRowsFromRoot(root: Element | null): string[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll('.infobox-participant-row'))
    .map((row) => {
      const input = row.querySelector<HTMLInputElement>('.ib-participant-name');
      return input ? String(input.value || '').trim() : '';
    })
    .filter((name) => name !== '');
}
