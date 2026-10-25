import { TOPIC_LABELS, type QuestionRecord } from '@quiz/shared';
import type { Config } from '../config.js';

/**
 * KI-Joker: liefert einen fachlichen Hinweis, ohne die Loesung direkt zu
 * verraten. Ohne konfigurierten API-Key wird ein deterministischer Hinweis aus
 * den Fragenmetadaten erzeugt, damit die Show auch offline funktioniert.
 */
export function createHintProvider(config: Config) {
  if (!config.openaiApiKey) {
    return async (question: QuestionRecord): Promise<string> => offlineHint(question);
  }
  const apiKey = config.openaiApiKey;
  return async (question: QuestionRecord): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.openaiModel,
          temperature: 0.3,
          max_tokens: 180,
          messages: [
            {
              role: 'system',
              content:
                'Du bist Dozent fuer die Sachkundepruefung nach § 34a GewO. Gib einen kurzen fachlichen Hinweis ' +
                'von hoechstens drei Saetzen. Nenne NIEMALS die richtige Antwort und keine Buchstabenposition. ' +
                'Erklaere nur die relevante Rechtsnorm oder das Prinzip.',
            },
            {
              role: 'user',
              content:
                `Themengebiet: ${TOPIC_LABELS[question.topic]}\n` +
                `Schwierigkeit: ${question.difficulty}\n` +
                `Frage: ${question.text}\n` +
                `Antwortoptionen: ${question.options.map((o, i) => `${i + 1}) ${o}`).join(' | ')}`,
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`KI-Joker fehlgeschlagen (HTTP ${response.status}).`);
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const hint = data.choices?.[0]?.message?.content?.trim();
      if (!hint) throw new Error('KI-Joker lieferte keine Antwort.');
      return sanitizeHint(hint, question);
    } catch {
      return offlineHint(question);
    } finally {
      clearTimeout(timeout);
    }
  };
}

/** Verhindert, dass ein Modellversehen die Loesung preisgibt. */
export function sanitizeHint(hint: string, question: QuestionRecord): string {
  const correct = question.options[question.correctIndex] ?? '';
  const normalizedHint = hint.replace(/\s+/g, ' ').trim();
  if (correct.length > 3 && normalizedHint.toLowerCase().includes(correct.toLowerCase())) {
    return offlineHint(question);
  }
  return normalizedHint;
}

export function offlineHint(question: QuestionRecord): string {
  const parts = [
    `Themengebiet: ${TOPIC_LABELS[question.topic]}.`,
    `Schwierigkeitsgrad: ${question.difficulty}.`,
  ];
  if (question.legalBasis) {
    parts.push(`Pruefe die einschlaegige Norm: ${question.legalBasis}.`);
  } else {
    parts.push('Pruefe die einschlaegige Rechtsnorm im Sachkundekatalog.');
  }
  if (question.legalStatus !== 'verified') {
    parts.push('Hinweis: Der Rechtsstand dieser Frage ist nicht abschliessend geprueft.');
  }
  parts.push('Die richtige Antwort wird bewusst nicht genannt.');
  return parts.join(' ');
}
