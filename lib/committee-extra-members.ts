import type { CommitteeRequest, MemberOpinion, Vote } from "./types";
import type { Language } from "./i18n";

/**
 * Adds the Quantitative Analyst and Macro Strategist seats to the committee.
 *
 * Kept in a separate module so the strict four-element tuples in
 * decision-engine.ts stay untouched — nothing existing has to be retyped.
 */

type ExtraCopy = {
  quantTitle: string;
  quantThesis: string;
  quantRisks: string[];
  macroTitle: string;
  macroThesis: string;
  macroRisks: string[];
};

const extraCopy: Record<Language, ExtraCopy> = {
  en: {
    quantTitle: "Quantitative Analyst",
    quantThesis: "The model supports the position only within the sizing band; beyond it the risk-adjusted return stops improving.",
    quantRisks: ["Model assumptions depend on verified inputs", "Factor crowding"],
    macroTitle: "Macro Strategist",
    macroThesis: "Rate and liquidity conditions dominate single-stock outcomes at this horizon, so a staged entry hedges regime risk.",
    macroRisks: ["Rates staying higher for longer", "Multiple compression across the sector"]
  },
  ru: {
    quantTitle: "Квантитативный аналитик",
    quantThesis: "Модель поддерживает позицию только в пределах расчётного диапазона размера; за его границами доходность с поправкой на риск перестаёт улучшаться.",
    quantRisks: ["Допущения модели зависят от проверенных данных", "Скученность в факторах"],
    macroTitle: "Макростратег",
    macroThesis: "На этом горизонте условия по ставкам и ликвидности значат больше, чем отдельная бумага, поэтому поэтапный вход снижает риск смены режима.",
    macroRisks: ["Длительный период высоких ставок", "Сжатие мультипликаторов по сектору"]
  },
  es: {
    quantTitle: "Analista cuantitativo",
    quantThesis: "El modelo respalda la posición solo dentro de la banda de tamaño; por encima, la rentabilidad ajustada al riesgo deja de mejorar.",
    quantRisks: ["Los supuestos del modelo dependen de datos verificados", "Saturación de factores"],
    macroTitle: "Estratega macro",
    macroThesis: "En este horizonte, los tipos y la liquidez pesan más que un valor concreto, por lo que una entrada escalonada cubre el riesgo de régimen.",
    macroRisks: ["Tipos altos durante más tiempo", "Compresión de múltiplos en el sector"]
  },
  fr: {
    quantTitle: "Analyste quantitatif",
    quantThesis: "Le modèle soutient la position uniquement dans la fourchette de taille ; au-delà, le rendement ajusté du risque cesse de s'améliorer.",
    quantRisks: ["Les hypothèses du modèle dépendent de données vérifiées", "Encombrement factoriel"],
    macroTitle: "Stratège macro",
    macroThesis: "À cet horizon, les taux et la liquidité pèsent plus qu'un titre isolé ; une entrée progressive couvre le risque de régime.",
    macroRisks: ["Des taux élevés plus longtemps", "Compression des multiples du secteur"]
  },
  de: {
    quantTitle: "Quantitativer Analyst",
    quantThesis: "Das Modell stützt die Position nur innerhalb der Größenbandbreite; darüber hinaus verbessert sich die risikoadjustierte Rendite nicht mehr.",
    quantRisks: ["Modellannahmen hängen von verifizierten Daten ab", "Faktorüberfüllung"],
    macroTitle: "Makrostratege",
    macroThesis: "Auf diesem Horizont wiegen Zinsen und Liquidität schwerer als eine Einzelaktie; ein schrittweiser Einstieg sichert gegen Regimewechsel ab.",
    macroRisks: ["Länger anhaltend hohe Zinsen", "Multiple-Kompression im Sektor"]
  },
  it: {
    quantTitle: "Analista quantitativo",
    quantThesis: "Il modello sostiene la posizione solo entro la fascia di dimensionamento; oltre, il rendimento corretto per il rischio smette di migliorare.",
    quantRisks: ["Le ipotesi del modello dipendono da dati verificati", "Affollamento dei fattori"],
    macroTitle: "Stratega macro",
    macroThesis: "Su questo orizzonte tassi e liquidità pesano più del singolo titolo, quindi un ingresso graduale copre il rischio di regime.",
    macroRisks: ["Tassi elevati più a lungo", "Compressione dei multipli settoriali"]
  },
  pt: {
    quantTitle: "Analista quantitativo",
    quantThesis: "O modelo apoia a posição apenas dentro da faixa de dimensionamento; acima dela, o retorno ajustado ao risco deixa de melhorar.",
    quantRisks: ["As premissas do modelo dependem de dados verificados", "Concentração de fatores"],
    macroTitle: "Estrategista macro",
    macroThesis: "Neste horizonte, juros e liquidez pesam mais do que uma ação isolada, então a entrada gradual protege contra mudança de regime.",
    macroRisks: ["Juros altos por mais tempo", "Compressão de múltiplos no setor"]
  },
  ar: {
    quantTitle: "محلل كمي",
    quantThesis: "يدعم النموذج المركز ضمن نطاق الحجم المحدد فقط؛ وبعده يتوقف العائد المعدّل بالمخاطر عن التحسن.",
    quantRisks: ["تعتمد افتراضات النموذج على بيانات موثقة", "ازدحام العوامل"],
    macroTitle: "استراتيجي اقتصاد كلي",
    macroThesis: "في هذا الأفق تؤثر أسعار الفائدة والسيولة أكثر من السهم المنفرد، لذا فإن الدخول المرحلي يحد من مخاطر تغير النظام.",
    macroRisks: ["استمرار أسعار الفائدة المرتفعة", "انضغاط المضاعفات في القطاع"]
  },
  tr: {
    quantTitle: "Kantitatif analist",
    quantThesis: "Model pozisyonu yalnızca belirlenen büyüklük aralığında destekliyor; bunun ötesinde riske göre düzeltilmiş getiri iyileşmiyor.",
    quantRisks: ["Model varsayımları doğrulanmış verilere bağlıdır", "Faktör yoğunlaşması"],
    macroTitle: "Makro stratejist",
    macroThesis: "Bu vadede faiz ve likidite koşulları tek bir hisseden daha belirleyicidir; kademeli giriş rejim riskini azaltır.",
    macroRisks: ["Faizlerin uzun süre yüksek kalması", "Sektör genelinde çarpan daralması"]
  },
  az: {
    quantTitle: "Kəmiyyət analitiki",
    quantThesis: "Model mövqeyi yalnız müəyyən edilmiş həcm diapazonunda dəstəkləyir; bundan sonra riskə düzəliş edilmiş gəlirlilik artmır.",
    quantRisks: ["Model fərziyyələri təsdiqlənmiş məlumatlardan asılıdır", "Faktor sıxlığı"],
    macroTitle: "Makro strateq",
    macroThesis: "Bu üfüqdə faiz və likvidlik şəraiti ayrıca səhmdən daha çox əhəmiyyət daşıyır, ona görə mərhələli giriş rejim riskini azaldır.",
    macroRisks: ["Faizlərin uzun müddət yüksək qalması", "Sektor üzrə multiplikatorların daralması"]
  }
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function extraOpinions(
  input: CommitteeRequest & { language?: Language },
  ctx: { suggestedAllocation: number; baseConfidence: number }
): MemberOpinion[] {
  const c = extraCopy[input.language ?? "en"] ?? extraCopy.en;
  const requestedAllocation = (input.amount / input.portfolioValue) * 100;

  // Quant leans on how far the request sits above the modelled size
  const overshoot = requestedAllocation / Math.max(ctx.suggestedAllocation, 0.1);
  const quantVote: Vote = overshoot > 2 ? "hold" : overshoot > 1.2 ? "buy_partial" : "buy";

  // Macro leans on the horizon: short horizons are exposed to regime shifts
  const macroVote: Vote = input.horizonYears <= 2 ? "hold" : input.horizonYears >= 5 ? "buy_partial" : "hold";

  return [
    {
      memberId: "quant",
      title: c.quantTitle,
      vote: quantVote,
      confidence: Math.round(clamp(ctx.baseConfidence + 0.04, 0.35, 0.9) * 100) / 100,
      suggestedAllocationPercent: ctx.suggestedAllocation,
      thesis: c.quantThesis,
      risks: c.quantRisks
    },
    {
      memberId: "macro",
      title: c.macroTitle,
      vote: macroVote,
      confidence: Math.round(clamp(ctx.baseConfidence - 0.06, 0.3, 0.85) * 100) / 100,
      suggestedAllocationPercent: Math.min(ctx.suggestedAllocation, 2),
      thesis: c.macroThesis,
      risks: c.macroRisks
    }
  ];
}
