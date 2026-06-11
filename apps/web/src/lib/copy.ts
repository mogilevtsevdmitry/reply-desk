/**
 * Копидек интерфейса. Источник истины: docs/content/COPY.md.
 * Ключи перенесены как есть (kebab-case → camelCase секциями).
 * Тексты не редактировать здесь — только синхронизировать с COPY.md.
 */

export const copy = {
  // ---------- 1. Auth ----------
  authBrandHeadline: 'Пульт управления репутацией',
  authBrandSub:
    'Вставьте отзыв клиента — через восемь секунд у вас готовый ответ для площадки, задача для команды и план возврата клиента.',
  authBrandPlatforms: 'Яндекс.Карты · 2ГИС · Ozon · Wildberries',
  authTabsAria: 'Вход или регистрация',
  authTabLogin: 'Вход',
  authTabSignup: 'Регистрация',
  loginTitle: 'С возвращением',
  loginSub: 'Войдите, чтобы продолжить работу с отзывами',
  fieldEmailLabel: 'Электронная почта',
  fieldEmailPlaceholder: 'name@company.ru',
  fieldPasswordLabel: 'Пароль',
  loginPasswordPlaceholder: '••••••••',
  loginSubmit: 'Войти в пульт',
  loginSwitchText: 'Нет аккаунта?',
  loginSwitchLink: 'Создайте за минуту',
  signupTitle: 'Создайте аккаунт',
  signupSub: 'Бесплатный тариф — 10 генераций в месяц, без карты',
  signupPasswordPlaceholder: 'Минимум 8 символов',
  signupPasswordHint: 'Используйте буквы и цифры — так надёжнее',
  signupSubmit: 'Создать аккаунт',
  signupSwitchText: 'Уже зарегистрированы?',
  signupSwitchLink: 'Войдите',

  errorFieldRequired: 'Заполните это поле',
  errorEmailInvalid: 'Проверьте адрес — похоже, он неполный',
  errorEmailTaken: 'Эта почта уже зарегистрирована — попробуйте войти',
  errorPasswordShort: 'Слишком короткий пароль — нужно минимум 8 символов',
  errorCredentials:
    'Не нашли такое сочетание почты и пароля. Проверьте данные и попробуйте ещё раз',

  // ---------- 2. Онбординг ----------
  onbStepperAria: 'Шаг настройки',
  onbStep1Name: 'Компания',
  onbStep2Name: 'Тон бренда',
  onbStep3Name: 'Примеры',
  onbBack: 'Назад',
  onbNext: 'Продолжить',
  onbFinish: 'Открыть пульт',
  onb1Title: 'Расскажите о компании',
  onb1Sub: 'Эти данные попадут в каждый ответ — название и ниша задают контекст для AI',
  onbCompanyLabel: 'Название компании',
  onbCompanyPlaceholder: 'Как вас знают клиенты, например «Салон Марины»',
  onbNicheLabel: 'Ниша',
  onbNicheHint:
    'Ниша подключает отраслевые правила: что обещать клиенту, чего избегать в ответах',
  onb2Title: 'Каким голосом отвечает бренд',
  onb2Sub: 'Тон применяется ко всем публичным ответам — его можно сменить в настройках',
  onbToneLabel: 'Тон по умолчанию',
  toneSoftName: 'Мягкий',
  toneSoftDesc:
    'Сопереживаем, извиняемся первыми, предлагаем компенсацию: «нам очень жаль, что визит прошёл не так»',
  toneNeutralName: 'Нейтральный',
  toneNeutralDesc:
    'Спокойно признаём факты и называем шаги: «разобрались в ситуации, вот что сделаем»',
  toneConfidentName: 'Уверенный',
  toneConfidentDesc:
    'Корректно отстаиваем позицию, когда претензия спорная: «проверили записи — расскажем, как было»',
  onbAvoidLabel: 'Чего избегать в ответах (необязательно)',
  onbAvoidPlaceholder: 'Например: не обещать возврат денег без проверки',
  onb3Title: 'Покажите, как вы пишете',
  onb3Sub:
    'Вставьте один–три ваших ответа клиентам, которыми гордитесь. AI переймёт лексику и манеру',
  onbSample1Label: 'Пример 1',
  onbSample2Label: 'Пример 2',
  onbSample3Label: 'Пример 3',
  onbSamplePlaceholder:
    'Например: «Анна, спасибо, что рассказали. Мастер Ольга уже знает о ситуации — приходите в четверг, поправим укладку за наш счёт»',
  errorSampleTooLong: 'Пример длиннее 1000 символов — сократите текст',
  onb3Hint: 'Можно пропустить — тогда AI будет опираться только на выбранный тон',

  // ---------- 3. Главный экран ----------
  navAria: 'Основные разделы',
  navGenerate: 'Генерация',
  navHistory: 'История',
  navSettings: 'Настройки',
  genTitle: 'Новый отзыв',
  genSub:
    'Вставьте отзыв клиента — соберём ответ для площадки, задачу для команды и план возврата клиента',
  genReviewLabel: 'Текст отзыва',
  genReviewPlaceholder: 'Вставьте отзыв клиента — целиком, как он опубликован на площадке',
  errorReviewTooLong: 'Отзыв длиннее 4000 символов — сократите текст',
  errorReviewEmpty: 'Вставьте текст отзыва, чтобы запустить генерацию',
  genSourceLabel: 'Площадка',
  genRatingLabel: 'Оценка клиента',
  genRatingHint: 'Если на площадке нет оценки — пропустите',
  genAuthorLabel: 'Имя клиента',
  genAuthorPlaceholder: 'Как клиент подписан на площадке, например Анна',
  genAuthorHint: 'Необязательно — если указать, AI обратится к клиенту по имени',
  genSubmit: 'Сгенерировать пакет реакции',
  genLimitNoteZero: 'Лимит месяца исчерпан',

  pipeTitle: 'Собираем пакет реакции',
  pipeSub: 'Обычно это занимает около восьми секунд — не закрывайте страницу',
  pipeNodes: ['Отзыв', 'Анализ', 'Тональность', 'Пакет'] as const,
  pipeStatuses: [
    'Читаю отзыв и выделяю факты…',
    'Определяю категорию, серьёзность и повторяемость…',
    'Подбираю тон под ваш бренд и правила площадки…',
    'Собираю четыре блока пакета…',
  ] as const,

  // ---------- 4. Карточки результата ----------
  resultTitle: 'Пакет реакции готов',
  resultReviewTitle: 'Исходный отзыв',
  cardReplyTitle: 'Публичный ответ',
  cardReplyTabsAria: 'Тон ответа',
  cardReplyTabSoft: 'Мягкий',
  cardReplyTabNeutral: 'Нейтральный',
  cardReplyTabConfident: 'Уверенный',
  cardReplyCopy: 'Скопировать ответ',
  cardTaskTitle: 'Внутренняя задача',
  cardTaskWhat: 'Что',
  cardTaskCause: 'Причина',
  cardTaskCheck: 'Проверить',
  cardTaskAssignee: 'Кому',
  cardTaskCopy: 'Скопировать задачу',
  cardClsTitle: 'Классификация',
  repeatLinksLabel: 'Похожие:',
  repeatNone: 'Похожих отзывов за последний месяц не нашли',
  fakeTitleSuspected: 'Похоже на заказной отзыв',
  fakeTitleClear: 'Признаков заказного отзыва не видим',
  fakeFoot: 'Это предположение алгоритма, а не вывод. Решение всегда за вами.',
  cardWinbackTitle: 'Возврат клиента',
  cardWinbackCompLabel: 'Рекомендация по компенсации',
  cardWinbackCopy: 'Скопировать сообщение',

  // ---------- 5. Ошибки, лимиты, 402 ----------
  failedTitle: 'Не получилось собрать пакет',
  failedText:
    'Сервис генерации не ответил вовремя. Лимит не потрачен — попробуйте ещё раз, отзыв сохранён.',
  failedRetry: 'Повторить генерацию',
  limitPlansIntro: 'Платные тарифы снимут ограничение:',
  planStartName: 'START',
  planStartDesc:
    '100 генераций в месяц — хватит на ежедневную работу с отзывами одной точки',
  planBusinessName: 'BUSINESS',
  planBusinessDesc:
    '1000 генераций в месяц — для нескольких точек или большого потока отзывов',
  limitCta: 'Сообщить мне, когда тарифы откроются',
  limitBack: 'Вернуться к истории',
  limitCtaLink: 'Открыть тарифы',

  errorNetwork: 'Нет соединения с сервером. Проверьте интернет и повторите попытку',
  error429: 'Слишком много запросов подряд — подождите минуту и повторите',
  errorServer: 'Что-то пошло не так на нашей стороне. Попробуйте ещё раз через минуту',
  errorSseLost:
    'Связь прервалась, но генерация продолжается. Обновите страницу, чтобы увидеть результат',
  errorSessionExpired: 'Сессия истекла — войдите снова',

  // ---------- 6. История ----------
  historyTitle: 'История отзывов',
  filterSourceLabel: 'Площадка',
  filterSourceAll: 'Все площадки',
  filterCategoryLabel: 'Категория',
  filterCategoryAll: 'Все категории',
  filterSeverityLabel: 'Серьёзность',
  filterSeverityAll: 'Любая',
  filterDateFrom: 'Период с',
  filterDateTo: 'по',
  filterReset: 'Сбросить',
  historyRowFailed: 'генерация не удалась — можно повторить',
  historyMore: 'Показать ещё',
  historyEmptyTitle: 'Пока нет обработанных отзывов',
  historyEmptyText: 'Вставьте первый отзыв — пакет реакции и его история появятся здесь',
  historyEmptyCta: 'Перейти к генерации',
  historyNoresTitle: 'По этим фильтрам ничего не нашли',
  historyNoresText: 'Попробуйте расширить период или убрать часть условий',
  historyNoresCta: 'Сбросить фильтры',

  // ---------- 7. Настройки ----------
  settingsTitle: 'Настройки',
  settingsSub: 'Компания, голос бренда и тариф — изменения применяются к новым генерациям',
  settingsCompanyTitle: 'Компания',
  settingsCompanyNameLabel: 'Название',
  settingsNicheLabel: 'Ниша',
  settingsNicheHint: 'Смена ниши подключает другие отраслевые правила для ответов',
  settingsToneTitle: 'Тон бренда',
  settingsToneLabel: 'Тон по умолчанию',
  settingsToneSoftShort: 'Сопереживаем, извиняемся первыми',
  settingsToneNeutralShort: 'Признаём факты, называем шаги',
  settingsToneConfidentShort: 'Корректно отстаиваем позицию',
  settingsAvoidLabel: 'Чего избегать в ответах',
  settingsSamplesLabel: 'Примеры ваших текстов',
  settingsSamplesHint: 'AI опирается на эти примеры, чтобы звучать как вы, а не как робот',
  settingsPlanTitle: 'Тариф',
  settingsSave: 'Сохранить настройки',
  settingsSaveNote: 'Прошлые генерации не изменятся',
  toastSettingsSaved: 'Настройки сохранены — применятся к новым генерациям',

  // ---------- 8. Системное ----------
  toastCopied: 'Скопировано в буфер обмена',
  copiedInline: 'Скопировано',
  toastSaveError: 'Не удалось сохранить — повторите попытку',
  logoutTrigger: 'Выйти',
  logoutTitle: 'Выйти из аккаунта?',
  logoutText: 'Невставленный текст отзыва не сохранится. Войти снова можно в любой момент.',
  logoutConfirm: 'Выйти',
  logoutCancel: 'Отмена',
} as const;

// ---------- Параметризованные строки ----------

const pluralRu = new Intl.PluralRules('ru');

/** Русский плюрал по формам one/few/many. */
export function plural(n: number, forms: { one: string; few: string; many: string }): string {
  const rule = pluralRu.select(n);
  if (rule === 'one') return forms.one;
  if (rule === 'few') return forms.few;
  return forms.many;
}

/** gen-review-counter / onb-sample-counter: «{n} / {max}». */
export const charCounter = (n: number, max: number): string => `${n} / ${max}`;

/** gen-limit-note: «Осталось {n} генераций в этом месяце». */
export function genLimitNote(n: number): string {
  return plural(n, {
    one: `Осталась ${n} генерация в этом месяце`,
    few: `Осталось ${n} генерации в этом месяце`,
    many: `Осталось ${n} генераций в этом месяце`,
  });
}

/** usage-num: «{used} из {limit}». */
export const usageNum = (used: number, limit: number): string => `${used} из ${limit}`;

/** usage-label: «генераций в {month}, тариф {plan}». */
export const usageLabel = (monthPrepositional: string, plan: string): string =>
  `генераций в ${monthPrepositional}, тариф ${plan}`;

/** usage-bar-aria: «Использовано {used} из {limit} генераций». */
export const usageBarAria = (used: number, limit: number): string =>
  `Использовано ${used} из ${limit} генераций`;

/** gen-rating-aria: «Оценка {n} из 5». */
export const ratingAria = (n: number): string => `Оценка ${n} из 5`;

/** severity-aria: «Серьёзность {n} из 5 — {word}». */
export const severityAria = (n: number, word: string): string =>
  `Серьёзность ${n} из 5 — ${word}`;

/** severity-1..5 — словесные метки. */
export const severityWords: Record<number, string> = {
  1: 'фоновая',
  2: 'лёгкая',
  3: 'заметная',
  4: 'серьёзная',
  5: 'критичная',
};

/** repeat-title: «{n}-й похожий отзыв за месяц». */
export const repeatTitle = (n: number): string => `${n}-й похожий отзыв за месяц`;

/** history-sub: «Все обработанные отзывы компании — {n} за последние 30 дней». */
export function historySub(n: number): string {
  const word = plural(n, { one: `${n} отзыв`, few: `${n} отзыва`, many: `${n} отзывов` });
  return `Все обработанные отзывы компании — ${word} за последние 30 дней`;
}

/** history-foot: «Показаны {shown} из {total}». */
export const historyFoot = (shown: number, total: number): string =>
  `Показаны ${shown} из ${total}`;

/** filter-severity-option: «{n} — {word}». */
export const filterSeverityOption = (n: number): string => `${n} — ${severityWords[n]}`;

/** limit-title: «Лимит генераций на {month} исчерпан» ({month} — винительный падеж). */
export const limitTitle = (monthAccusative: string): string =>
  `Лимит генераций на ${monthAccusative} исчерпан`;

/** limit-text. {date} — «1 июля». */
export const limitText = (limit: number, plan: string, date: string): string =>
  `Вы использовали все ${limit} генераций тарифа ${plan}. Счётчик обнулится ${date} — отзыв можно будет обработать тогда.`;

/** limit-cta-toast: «Записали — напишем на {email}, когда тарифы станут доступны». */
export const limitCtaToast = (email: string): string =>
  `Записали — напишем на ${email}, когда тарифы станут доступны`;

/** settings-plan-note. */
export const settingsPlanNote = (plan: string, date: string): string =>
  `Тариф ${plan}. Счётчик обнулится ${date}. Платные тарифы появятся позже — мы напишем вам на почту.`;

/** result-meta: «{source} · {date}». */
export const resultMeta = (source: string, date: string): string => `${source} · ${date}`;
