import { learnerAnswer } from '@/cards/answerView';
import type { DeckSummary, StudyCard } from '@/domain/types';

export type DeckPrintLayout = 'compact' | 'cutouts' | 'cram' | 'source-linked';

export function buildDeckPrintHtml(deck: DeckSummary, cards: StudyCard[], layout: DeckPrintLayout) {
  const safeCards = cards.filter((card) => card.status !== 'needs_review');
  const content = safeCards.map((card, index) => renderCard(card, index, layout)).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { margin: 16mm; }
* { box-sizing: border-box; }
body { color: #0f2d60; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; margin: 0; }
header { border-bottom: 3px solid #3b82f6; margin-bottom: 18px; padding-bottom: 12px; }
h1 { font-size: 24px; margin: 0 0 5px; } .meta { color: #64748b; font-size: 11px; }
.card { break-inside: avoid; border: 1px solid #d8e4f2; border-radius: 10px; margin: 0 0 10px; padding: 12px; }
.number { color: #1d5fd1; font-size: 9px; font-weight: 700; letter-spacing: .08em; }
.question { font-size: 14px; font-weight: 700; line-height: 1.4; margin: 5px 0 8px; }
.answer { color: #35547d; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.source { background: #e8fbf8; border-radius: 7px; color: #0f766e; font-size: 9px; line-height: 1.4; margin-top: 9px; padding: 7px; }
.compact .card { align-items: start; display: grid; gap: 10px; grid-template-columns: 1fr 1.35fr; }
.cutouts { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
.cutouts .card { min-height: 190px; border-style: dashed; }
.cram .answer { font-size: 11px; } .cram .card { padding: 9px; }
footer { color: #94a3b8; font-size: 9px; margin-top: 18px; text-align: center; }
</style></head><body class="${layout}">
<header><h1>${escapeHtml(deck.title)}</h1><div class="meta">BARION · ${safeCards.length} safe cards · ${escapeHtml(layoutLabel(layout))}</div></header>
<main>${content || '<p>No safe cards are available to print.</p>'}</main>
<footer>Source-linked medical study material. Check the original source before relying on a clinical claim.</footer>
</body></html>`;
}

function renderCard(card: StudyCard, index: number, layout: DeckPrintLayout) {
  const source = layout === 'source-linked' && card.evidence
    ? `<div class="source"><strong>${escapeHtml(card.evidence.sourceTitle)}</strong> · ${escapeHtml(card.evidence.locator)}<br>${escapeHtml(card.evidence.text)}</div>`
    : '';
  return `<section class="card"><div><div class="number">CARD ${index + 1} · ${escapeHtml(card.cardType)}</div><div class="question">${escapeHtml(card.prompt)}</div></div><div class="answer">${escapeHtml(learnerAnswer(card.answer))}</div>${source}</section>`;
}

function layoutLabel(layout: DeckPrintLayout) {
  if (layout === 'source-linked') return 'Source-linked review sheet';
  if (layout === 'cutouts') return 'Flashcard cutouts';
  if (layout === 'cram') return 'Cram sheet';
  return 'Compact table';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
