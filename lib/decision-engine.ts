import type { CommitteeRequest, MemberOpinion, Recommendation, Vote } from "./types";
import type { Language } from "./i18n";
import { extraOpinions } from "./committee-extra-members";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type LocalizedInput = CommitteeRequest & { language?: Language };

const copy: Record<Language, {
  titles: [string, string, string, string];
  theses: [string, string, string, string];
  risks: [string[], string[], string[], string[]];
  summaryHold: string;
  summaryLimited: string;
  reasons: (allocation: string, years: number) => string[];
  overallRisks: string[];
  triggers: string[];
}> = {
  en: {
    titles: ["Fundamental Analyst", "Market Analyst", "Risk Officer", "Portfolio Strategist"],
    theses: [
      "can be considered for a long-term portfolio, subject to verified financial and valuation data.",
      "A staged entry reduces timing risk while real-time market signals are not yet connected.",
      "The proposed position must remain inside the client-specific concentration limit.",
      "The purchase is evaluated as part of the whole portfolio, not as an isolated stock idea."
    ],
    risks: [["Valuation may already reflect strong future growth", "Company-specific execution risk"], ["Short-term volatility", "Market regime changes"], ["Sector concentration", "Single-stock drawdown"], ["Reduced diversification", "Insufficient liquidity for other goals"]],
    summaryHold: "The committee recommends waiting because current sector concentration is already high.",
    summaryLimited: "The committee supports a limited, staged position rather than committing the entire requested amount at once.",
    reasons: (allocation, years) => [`The proposed purchase is ${allocation}% of the current portfolio.`, `The client has a ${years}-year investment horizon.`, "A smaller initial position preserves flexibility and limits timing risk."],
    overallRisks: ["Sector concentration", "Valuation uncertainty", "Single-stock volatility"],
    triggers: ["Verified quarterly earnings data", "Material guidance revision", "Sector exposure exceeds the configured limit"]
  },
  ru: {
    titles: ["Фундаментальный аналитик", "Рыночный аналитик", "Риск-офицер", "Портфельный стратег"],
    theses: [
      "можно рассматривать для долгосрочного портфеля после проверки финансовых показателей и оценки компании.",
      "Пошаговый вход снижает риск неудачного момента покупки, пока данные рынка в реальном времени не подключены.",
      "Размер позиции должен оставаться в пределах индивидуального лимита концентрации клиента.",
      "Покупка оценивается как часть всего портфеля, а не как отдельная идея по одной акции."
    ],
    risks: [["Оценка может уже учитывать высокий будущий рост", "Риск исполнения стратегии компанией"], ["Краткосрочная волатильность", "Изменение рыночного режима"], ["Концентрация в секторе", "Снижение стоимости отдельной акции"], ["Снижение диверсификации", "Недостаток ликвидности для других целей"]],
    summaryHold: "Комитет рекомендует подождать, поскольку текущая концентрация в секторе уже высокая.",
    summaryLimited: "Комитет поддерживает ограниченную поэтапную покупку вместо вложения всей запрошенной суммы сразу.",
    reasons: (allocation, years) => [`Предлагаемая покупка составляет ${allocation}% текущего портфеля.`, `Инвестиционный горизонт клиента — ${years} лет.`, "Меньшая начальная позиция сохраняет гибкость и снижает риск неудачного момента входа."],
    overallRisks: ["Концентрация в секторе", "Неопределенность оценки", "Волатильность отдельной акции"],
    triggers: ["Подтвержденные квартальные результаты", "Существенное изменение прогноза руководства", "Доля сектора превышает установленный лимит"]
  },
  es: {
    titles: ["Analista fundamental", "Analista de mercado", "Responsable de riesgo", "Estratega de cartera"],
    theses: [
      "puede considerarse para una cartera a largo plazo, sujeto a datos financieros y de valoración verificados.",
      "Una entrada escalonada reduce el riesgo de sincronización mientras no estén conectadas las señales de mercado en tiempo real.",
      "La posición propuesta debe permanecer dentro del límite de concentración específico del cliente.",
      "La compra se evalúa como parte de toda la cartera, no como una idea aislada."
    ],
    risks: [["La valoración puede reflejar ya un fuerte crecimiento futuro", "Riesgo de ejecución de la empresa"], ["Volatilidad a corto plazo", "Cambios en el régimen de mercado"], ["Concentración sectorial", "Caída de una sola acción"], ["Menor diversificación", "Liquidez insuficiente para otros objetivos"]],
    summaryHold: "El comité recomienda esperar porque la concentración sectorial actual ya es elevada.",
    summaryLimited: "El comité apoya una posición limitada y escalonada en lugar de invertir todo el importe solicitado de una vez.",
    reasons: (allocation, years) => [`La compra propuesta representa el ${allocation}% de la cartera actual.`, `El cliente tiene un horizonte de inversión de ${years} años.`, "Una posición inicial menor preserva flexibilidad y limita el riesgo de entrada."],
    overallRisks: ["Concentración sectorial", "Incertidumbre de valoración", "Volatilidad de una sola acción"],
    triggers: ["Resultados trimestrales verificados", "Revisión importante de previsiones", "La exposición sectorial supera el límite configurado"]
  },
  fr: {
    titles: ["Analyste fondamental", "Analyste de marché", "Responsable des risques", "Stratège de portefeuille"],
    theses: [
      "peut être envisagée pour un portefeuille à long terme, sous réserve de données financières et de valorisation vérifiées.",
      "Une entrée progressive réduit le risque de mauvais timing tant que les signaux de marché en temps réel ne sont pas connectés.",
      "La position proposée doit rester dans la limite de concentration propre au client.",
      "L'achat est évalué dans le contexte de l'ensemble du portefeuille, et non comme une idée isolée."
    ],
    risks: [["La valorisation peut déjà intégrer une forte croissance future", "Risque d'exécution propre à l'entreprise"], ["Volatilité à court terme", "Changement de régime de marché"], ["Concentration sectorielle", "Baisse d'une seule action"], ["Diversification réduite", "Liquidité insuffisante pour d'autres objectifs"]],
    summaryHold: "Le comité recommande d'attendre, car la concentration sectorielle actuelle est déjà élevée.",
    summaryLimited: "Le comité soutient une position limitée et progressive plutôt que d'engager immédiatement la totalité du montant demandé.",
    reasons: (allocation, years) => [`L'achat proposé représente ${allocation}% du portefeuille actuel.`, `Le client a un horizon d'investissement de ${years} ans.`, "Une position initiale plus petite préserve la flexibilité et limite le risque de timing."],
    overallRisks: ["Concentration sectorielle", "Incertitude de valorisation", "Volatilité d'une seule action"],
    triggers: ["Résultats trimestriels vérifiés", "Révision importante des prévisions", "L'exposition sectorielle dépasse la limite configurée"]
  },
  de: {
    titles: ["Fundamentalanalyst", "Marktanalyst", "Risikobeauftragter", "Portfoliostratege"],
    theses: [
      "kann für ein langfristiges Portfolio erwogen werden, sofern Finanz- und Bewertungsdaten verifiziert sind.",
      "Ein schrittweiser Einstieg reduziert das Timing-Risiko, solange Echtzeit-Marktsignale noch nicht angebunden sind.",
      "Die vorgeschlagene Position muss innerhalb des kundenspezifischen Konzentrationslimits bleiben.",
      "Der Kauf wird als Teil des gesamten Portfolios und nicht als isolierte Aktienidee bewertet."
    ],
    risks: [["Die Bewertung kann starkes zukünftiges Wachstum bereits einpreisen", "Unternehmensspezifisches Ausführungsrisiko"], ["Kurzfristige Volatilität", "Änderungen des Marktregimes"], ["Sektorkonzentration", "Kursrückgang einer Einzelaktie"], ["Geringere Diversifikation", "Unzureichende Liquidität für andere Ziele"]],
    summaryHold: "Das Komitee empfiehlt zu warten, da die aktuelle Sektorkonzentration bereits hoch ist.",
    summaryLimited: "Das Komitee unterstützt eine begrenzte, schrittweise Position statt den gesamten gewünschten Betrag sofort zu investieren.",
    reasons: (allocation, years) => [`Der vorgeschlagene Kauf entspricht ${allocation}% des aktuellen Portfolios.`, `Der Kunde hat einen Anlagehorizont von ${years} Jahren.`, "Eine kleinere Anfangsposition erhält Flexibilität und begrenzt das Timing-Risiko."],
    overallRisks: ["Sektorkonzentration", "Bewertungsunsicherheit", "Volatilität einer Einzelaktie"],
    triggers: ["Verifizierte Quartalsergebnisse", "Wesentliche Änderung des Ausblicks", "Sektorgewicht überschreitet das konfigurierte Limit"]
  },
  it: {
    titles: ["Analista fondamentale", "Analista di mercato", "Responsabile del rischio", "Stratega di portafoglio"],
    theses: [
      "può essere considerata per un portafoglio di lungo periodo, previa verifica dei dati finanziari e di valutazione.",
      "Un ingresso graduale riduce il rischio di timing finché i segnali di mercato in tempo reale non sono collegati.",
      "La posizione proposta deve rimanere entro il limite di concentrazione specifico del cliente.",
      "L'acquisto viene valutato come parte dell'intero portafoglio, non come idea isolata."
    ],
    risks: [["La valutazione può già riflettere una forte crescita futura", "Rischio di esecuzione aziendale"], ["Volatilità di breve periodo", "Cambiamenti del regime di mercato"], ["Concentrazione settoriale", "Perdita su un singolo titolo"], ["Minore diversificazione", "Liquidità insufficiente per altri obiettivi"]],
    summaryHold: "Il comitato raccomanda di attendere perché la concentrazione settoriale attuale è già elevata.",
    summaryLimited: "Il comitato sostiene una posizione limitata e graduale invece di investire subito l'intero importo richiesto.",
    reasons: (allocation, years) => [`L'acquisto proposto rappresenta il ${allocation}% del portafoglio attuale.`, `Il cliente ha un orizzonte di investimento di ${years} anni.`, "Una posizione iniziale più piccola mantiene flessibilità e limita il rischio di timing."],
    overallRisks: ["Concentrazione settoriale", "Incertezza di valutazione", "Volatilità del singolo titolo"],
    triggers: ["Risultati trimestrali verificati", "Revisione significativa delle guidance", "L'esposizione settoriale supera il limite configurato"]
  },
  pt: {
    titles: ["Analista fundamentalista", "Analista de mercado", "Diretor de risco", "Estrategista de portfólio"],
    theses: [
      "pode ser considerada para um portfólio de longo prazo, sujeita a dados financeiros e de avaliação verificados.",
      "Uma entrada gradual reduz o risco de timing enquanto os sinais de mercado em tempo real ainda não estão conectados.",
      "A posição proposta deve permanecer dentro do limite de concentração específico do cliente.",
      "A compra é avaliada como parte de todo o portfólio, e não como uma ideia isolada."
    ],
    risks: [["A avaliação pode já refletir forte crescimento futuro", "Risco de execução da empresa"], ["Volatilidade de curto prazo", "Mudanças no regime de mercado"], ["Concentração setorial", "Queda de uma única ação"], ["Menor diversificação", "Liquidez insuficiente para outros objetivos"]],
    summaryHold: "O comitê recomenda esperar porque a concentração setorial atual já é alta.",
    summaryLimited: "O comitê apoia uma posição limitada e gradual em vez de investir todo o valor solicitado de uma vez.",
    reasons: (allocation, years) => [`A compra proposta representa ${allocation}% do portfólio atual.`, `O cliente tem horizonte de investimento de ${years} anos.`, "Uma posição inicial menor preserva flexibilidade e limita o risco de timing."],
    overallRisks: ["Concentração setorial", "Incerteza de avaliação", "Volatilidade de uma única ação"],
    triggers: ["Resultados trimestrais verificados", "Revisão relevante das projeções", "A exposição setorial excede o limite configurado"]
  },
  ar: {
    titles: ["المحلل الأساسي", "محلل السوق", "مسؤول المخاطر", "استراتيجي المحفظة"],
    theses: [
      "يمكن النظر فيها لمحفظة طويلة الأجل بعد التحقق من البيانات المالية وبيانات التقييم.",
      "الدخول التدريجي يقلل مخاطر توقيت الشراء إلى أن يتم ربط إشارات السوق اللحظية.",
      "يجب أن يبقى حجم المركز ضمن حد التركّز الخاص بالعميل.",
      "يتم تقييم الشراء كجزء من المحفظة كاملة، وليس كفكرة منفصلة لسهم واحد."
    ],
    risks: [["قد يعكس التقييم بالفعل نمواً مستقبلياً قوياً", "مخاطر تنفيذ خاصة بالشركة"], ["تقلبات قصيرة الأجل", "تغير نظام السوق"], ["تركّز القطاع", "هبوط سهم واحد"], ["انخفاض التنويع", "سيولة غير كافية لأهداف أخرى"]],
    summaryHold: "توصي اللجنة بالانتظار لأن تركّز القطاع الحالي مرتفع بالفعل.",
    summaryLimited: "تؤيد اللجنة مركزاً محدوداً وتدريجياً بدلاً من استثمار المبلغ المطلوب كاملاً دفعة واحدة.",
    reasons: (allocation, years) => [`تمثل عملية الشراء المقترحة ${allocation}% من المحفظة الحالية.`, `أفق استثمار العميل هو ${years} سنوات.`, "يحافظ المركز الأولي الأصغر على المرونة ويحد من مخاطر التوقيت."],
    overallRisks: ["تركّز القطاع", "عدم يقين التقييم", "تقلب سهم واحد"],
    triggers: ["نتائج ربع سنوية موثقة", "تعديل جوهري للتوقعات", "تجاوز انكشاف القطاع للحد المحدد"]
  },
  tr: {
    titles: ["Temel Analist", "Piyasa Analisti", "Risk Yöneticisi", "Portföy Stratejisti"],
    theses: [
      "doğrulanmış finansal ve değerleme verilerine bağlı olarak uzun vadeli bir portföy için değerlendirilebilir.",
      "Gerçek zamanlı piyasa sinyalleri bağlı değilken kademeli giriş zamanlama riskini azaltır.",
      "Önerilen pozisyon müşteriye özel yoğunlaşma sınırı içinde kalmalıdır.",
      "Alım, tek başına bir hisse fikri olarak değil tüm portföyün parçası olarak değerlendirilir."
    ],
    risks: [["Değerleme güçlü gelecek büyümesini zaten yansıtıyor olabilir", "Şirkete özgü uygulama riski"], ["Kısa vadeli oynaklık", "Piyasa rejimi değişiklikleri"], ["Sektör yoğunlaşması", "Tek hisse düşüşü"], ["Azalan çeşitlendirme", "Diğer hedefler için yetersiz likidite"]],
    summaryHold: "Komite, mevcut sektör yoğunlaşması zaten yüksek olduğu için beklemeyi öneriyor.",
    summaryLimited: "Komite, talep edilen tutarın tamamını bir kerede yatırmak yerine sınırlı ve kademeli bir pozisyonu destekliyor.",
    reasons: (allocation, years) => [`Önerilen alım mevcut portföyün %${allocation} oranındadır.`, `Müşterinin yatırım ufku ${years} yıldır.`, "Daha küçük bir başlangıç pozisyonu esnekliği korur ve zamanlama riskini sınırlar."],
    overallRisks: ["Sektör yoğunlaşması", "Değerleme belirsizliği", "Tek hisse oynaklığı"],
    triggers: ["Doğrulanmış çeyrek sonuçları", "Önemli beklenti revizyonu", "Sektör ağırlığının ayarlanan limiti aşması"]
  },
  az: {
    titles: ["Fundamental analitik", "Bazar analitiki", "Risk üzrə mütəxəssis", "Portfel strateqi"],
    theses: [
      "təsdiqlənmiş maliyyə və qiymətləndirmə məlumatları əsasında uzunmüddətli portfel üçün nəzərdən keçirilə bilər.",
      "Real vaxt bazar siqnalları qoşulmadığı müddətdə mərhələli giriş vaxtlama riskini azaldır.",
      "Təklif olunan mövqe müştəriyə uyğun konsentrasiya limiti daxilində qalmalıdır.",
      "Alış ayrıca səhm ideyası kimi deyil, bütün portfelin bir hissəsi kimi qiymətləndirilir."
    ],
    risks: [["Qiymətləndirmə güclü gələcək artımı artıq əks etdirə bilər", "Şirkətə xas icra riski"], ["Qısamüddətli dəyişkənlik", "Bazar rejiminin dəyişməsi"], ["Sektor konsentrasiyası", "Tək səhm üzrə eniş"], ["Diversifikasiyanın azalması", "Digər məqsədlər üçün kifayət qədər likvidliyin olmaması"]],
    summaryHold: "Komitə gözləməyi tövsiyə edir, çünki mövcud sektor konsentrasiyası artıq yüksəkdir.",
    summaryLimited: "Komitə tələb olunan məbləğin hamısını birdəfəlik yatırmaq əvəzinə məhdud və mərhələli mövqeni dəstəkləyir.",
    reasons: (allocation, years) => [`Təklif olunan alış cari portfelin ${allocation}%-ni təşkil edir.`, `Müştərinin investisiya üfüqü ${years} ildir.`, "Daha kiçik ilkin mövqe çevikliyi qoruyur və vaxtlama riskini məhdudlaşdırır."],
    overallRisks: ["Sektor konsentrasiyası", "Qiymətləndirmə qeyri-müəyyənliyi", "Tək səhm dəyişkənliyi"],
    triggers: ["Təsdiqlənmiş rüblük nəticələr", "Proqnozda əhəmiyyətli dəyişiklik", "Sektor payının müəyyən edilmiş limiti aşması"]
  }
};

export function runDemoCommittee(input: LocalizedInput): Recommendation {
  const requestedAllocation = (input.amount / input.portfolioValue) * 100;
  const riskLimit = input.riskTolerance === "low" ? 2 : input.riskTolerance === "moderate" ? 4 : 7;
  const concentrationPenalty = input.currentSectorExposure >= 35 ? 0.22 : input.currentSectorExposure >= 25 ? 0.12 : 0.04;
  const sizePenalty = requestedAllocation > riskLimit ? 0.18 : 0;
  const horizonSupport = input.horizonYears >= 5 ? 0.1 : input.horizonYears >= 3 ? 0.04 : -0.08;
  const baseConfidence = clamp(0.72 + horizonSupport - concentrationPenalty - sizePenalty, 0.35, 0.86);
  const suggestedAllocation = clamp(Math.min(requestedAllocation, riskLimit, 2.5), 0.5, 7);
  const suggestedAmount = Math.round((input.portfolioValue * suggestedAllocation) / 100 / 100) * 100;
  const decision: Vote = input.currentSectorExposure >= 40 ? "hold" : requestedAllocation > suggestedAllocation ? "buy_partial" : "buy";
  const c = copy[input.language ?? "en"];
  const ticker = input.ticker.toUpperCase();

  const opinions: MemberOpinion[] = [
    { memberId: "fundamental", title: c.titles[0], vote: "buy", confidence: 0.76, suggestedAllocationPercent: suggestedAllocation, thesis: `${ticker} ${c.theses[0]}`, risks: c.risks[0] },
    { memberId: "market", title: c.titles[1], vote: "buy_partial", confidence: 0.67, suggestedAllocationPercent: suggestedAllocation, thesis: c.theses[1], risks: c.risks[1] },
    { memberId: "risk", title: c.titles[2], vote: input.currentSectorExposure >= 35 ? "hold" : "buy_partial", confidence: 0.82, suggestedAllocationPercent: Math.min(suggestedAllocation, 2), thesis: c.theses[2], risks: c.risks[2] },
    { memberId: "portfolio", title: c.titles[3], vote: decision, confidence: baseConfidence, suggestedAllocationPercent: suggestedAllocation, thesis: c.theses[3], risks: c.risks[3] },
    ...extraOpinions(input, { suggestedAllocation, baseConfidence })
  ];

  return {
    decision,
    confidence: Math.round(baseConfidence * 100) / 100,
    proposedInvestmentAmount: suggestedAmount,
    proposedPortfolioAllocationPercent: Math.round(suggestedAllocation * 10) / 10,
    summary: decision === "hold" ? c.summaryHold : c.summaryLimited,
    reasons: c.reasons(requestedAllocation.toFixed(1), input.horizonYears),
    risks: c.overallRisks,
    reviewTriggers: c.triggers,
    opinions,
    generatedAt: new Date().toISOString(),
    dataMode: "demo"
  };
}
