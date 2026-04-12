export const appName = 'СтройФото'

export const nav = {
  reports: 'Отчёты',
  plans: 'Планы',
  settings: 'Настройки',
  admin: 'Администрирование',
  adminUsers: 'Пользователи',
  adminProjects: 'Проекты',
  adminWorkTypes: 'Виды работ',
  adminPerformers: 'Исполнители',
} as const

export const actions = {
  signIn: 'Войти',
  signUp: 'Зарегистрироваться',
  signOut: 'Выйти',
  create: 'Создать',
  newReport: 'Новый отчёт',
  menu: 'Меню',
  back: 'Назад',
  edit: 'Редактировать',
  delete: 'Удалить',
  save: 'Сохранить',
  cancel: 'Отмена',
} as const

export const auth = {
  loginTitle: 'Вход в СтройФото',
  registerTitle: 'Регистрация в СтройФото',
  emailLabel: 'Электронная почта',
  emailPlaceholder: 'you@example.com',
  passwordLabel: 'Пароль',
  passwordPlaceholder: 'Не менее 6 символов',
  noAccount: 'Нет аккаунта?',
  hasAccount: 'Уже есть аккаунт?',
  pendingTitle: 'Ожидает активации',
  pendingText:
    'Ваш аккаунт создан, но ещё не активирован администратором. Как только вам назначат проекты, вы сможете создавать отчёты.',
  pendingHint: 'Попробуйте обновить страницу позже или обратитесь к администратору.',
  registerSuccessTitle: 'Регистрация почти завершена',
  checkEmail:
    'Мы отправили письмо для подтверждения адреса. Перейдите по ссылке из письма, затем войдите в приложение.',
  goToLogin: 'Перейти ко входу',
  statusUpdated: 'Статус обновлён',
} as const

export const reportsList = {
  filterProject: 'Проект',
  filterProjectAll: 'Все проекты',
  filterDateRange: 'Период',
  filterWorkType: 'Поиск по виду работ',
  filterReset: 'Сбросить',
  remoteTag: 'С сервера',
  emptyLocal: 'Локальных отчётов пока нет',
  emptyFiltered: 'По выбранным фильтрам ничего не найдено',
  viewByDate: 'По датам',
  viewByPerformer: 'По исполнителям',
  performerUnknown: 'Исполнитель не указан',
} as const

export const reportDetails = {
  title: 'Отчёт',
  sectionMeta: 'Информация',
  sectionPhotos: 'Фотографии',
  sectionPlan: 'План и точка',
  project: 'Проект',
  workType: 'Вид работ',
  performer: 'Исполнитель',
  description: 'Описание',
  takenAt: 'Дата съёмки',
  createdAt: 'Создан',
  author: 'Автор',
  syncStatus: 'Статус синхронизации',
  noPhotos: 'Фотографий нет',
  noMark: 'План или точка не указаны',
  planOffline: 'План доступен офлайн',
  pageLabel: 'Страница',
  point: 'Точка',
  photoUnavailable: 'Фото недоступно',
  loading: 'Загрузка отчёта…',
  notFound: 'Отчёт не найден',
  offlineWarning:
    'Этот отчёт не сохранён на этом устройстве. Подключитесь к интернету, чтобы открыть его, или измените настройки локального хранения.',
  remoteOnlyInfo:
    'Этот отчёт открыт с сервера и не хранится на этом устройстве согласно вашим настройкам локального хранения.',
  performerContractor: 'Подрядчик',
  performerOwn: 'Собственные силы',
  deleteConfirmTitle: 'Удалить отчёт?',
  deleteConfirmContent: 'Отчёт и все связанные данные (фото, метка на плане) будут безвозвратно удалены.',
  deleteSuccess: 'Отчёт удалён',
  editSuccess: 'Отчёт обновлён',
  editTitle: 'Редактирование отчёта',
  cannotEditLocal: 'Редактирование доступно только для синхронизированных отчётов',
} as const

export const emptyStates = {
  soon: 'Раздел будет реализован на следующем шаге',
  noReports: 'Отчётов пока нет',
  noReportsHint: 'Создайте первый отчёт — это будет доступно на следующем шаге.',
  noPlans: 'Планы не загружены',
  noUsers: 'Пользователи появятся здесь',
  noProjects: 'Проекты появятся здесь',
  noWorkTypes: 'Виды работ появятся здесь',
  noPerformers: 'Исполнители появятся здесь',
} as const

export const settings = {
  title: 'Настройки',
  themeLabel: 'Оформление',
  themeLight: 'Светлая',
  themeDark: 'Тёмная',
  themeSystem: 'Как в системе',
  storageLabel: 'Локальное хранение истории',
  storageSoon: 'Появится вместе с офлайн-режимом.',
} as const

export const errors = {
  generic: 'Произошла ошибка. Попробуйте ещё раз.',
  invalidCredentials: 'Неверная электронная почта или пароль.',
  signUpFailed: 'Не удалось зарегистрироваться.',
  emailNotConfirmed: 'Электронная почта не подтверждена. Проверьте письмо от Supabase.',
  userExists: 'Пользователь с такой электронной почтой уже зарегистрирован.',
  weakPassword: 'Пароль слишком короткий. Минимум 6 символов.',
  network: 'Проблемы с сетью. Проверьте соединение и попробуйте ещё раз.',
  profileLoadFailed: 'Не удалось загрузить профиль.',
} as const
