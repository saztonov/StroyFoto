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
} as const
