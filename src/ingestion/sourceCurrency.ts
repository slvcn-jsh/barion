export type SourceCurrency = {
  label: string;
  year: number;
  potentiallyStale: boolean;
};

export function detectSourceCurrency(text: string, now: Date = new Date()): SourceCurrency | null {
  const compact = text.replace(/\s+/g, ' ');
  const numeric = compact.match(/\b(?:rev(?:ised)?|updated)\.?\s*(\d{1,2})[/-](\d{2,4})\b/i);
  if (numeric) {
    const month = Number(numeric[1]);
    const year = normalizeYear(Number(numeric[2]));
    if (month >= 1 && month <= 12 && year >= 1900 && year <= now.getFullYear()) {
      return currencyResult(new Date(year, month - 1, 1), now);
    }
  }
  const yearOnly = compact.match(/\b(?:rev(?:ised)?|updated|published)\.?\s*(?:in\s+)?((?:19|20)\d{2})\b/i);
  if (!yearOnly) return null;
  return currencyResult(new Date(Number(yearOnly[1]), 0, 1), now);
}

function normalizeYear(year: number) {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function currencyResult(date: Date, now: Date): SourceCurrency {
  const year = date.getFullYear();
  const ageYears = now.getFullYear() - year;
  return {
    label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    year,
    potentiallyStale: ageYears >= 3,
  };
}
