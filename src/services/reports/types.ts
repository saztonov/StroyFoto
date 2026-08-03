import type { SyncStatus } from '@/lib/db'

/**
 * Подрядчик отчёта в том виде, в каком его отдаёт сервер: id вместе с именем.
 * Одним связанным объектом, а не двумя параллельными массивами (ids + names) —
 * так соответствие id → имя не может разъехаться. Имя приходит с сервера по той
 * же причине, что и имена справочников: клиент грузит исполнителей с
 * ?active=true, и архивный подрядчик отображался бы как «—».
 */
export interface ReportPerformer {
  id: string
  name: string
}

/**
 * Унифицированная карточка отчёта для списка/детальной страницы.
 * `remoteOnly = true` означает, что отчёт ещё не сохранён в IndexedDB на этом
 * устройстве как черновик — это либо свежая запись с сервера, либо кэш истории.
 */
export interface ReportCard {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  workAssignmentId: string | null
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  authorName: string | null
  createdAt: string
  updatedAt: string | null
  syncStatus: SyncStatus
  remoteOnly: boolean
  /**
   * Имена справочников, отданные сервером. Клиент грузит справочники с
   * ?active=true, поэтому резолв по ним теряет архивные позиции и показывает
   * «—». Эти поля — основной источник; локальный find() остаётся запасным для
   * несинхронизированных черновиков, которых сервер ещё не видел.
   */
  workTypeName?: string | null
  workAssignmentName?: string | null
  /**
   * Идентификаторы подрядчиков, основной первым. Есть и у локальных черновиков.
   * Отсутствует у записей, созданных до этого релиза — фолбэк `[performerId]`,
   * для него в `./performers` есть `reportPerformerIds()`.
   */
  performerIds?: string[]
  /**
   * Подрядчики с именами, отданные сервером. Как и `workTypeName` выше, это
   * основной источник имён; резолв через локальный справочник остаётся запасным
   * для черновиков, которых сервер ещё не видел.
   */
  performers?: ReportPerformer[]
  /**
   * Последняя ошибка синхронизации (только для локальных отчётов).
   * Пробрасывается в карточку из LocalReport.lastError, чтобы UI мог
   * показать причину failed-статуса без отдельного fetch'а.
   */
  lastError?: string | null
}

export interface RemoteReportRow {
  id: string
  project_id: string
  work_type_id: string
  performer_id: string
  work_assignment_id: string | null
  plan_id: string | null
  description: string | null
  taken_at: string | null
  author_id: string
  created_at: string
  updated_at: string | null
  work_type_name?: string | null
  work_assignment_name?: string | null
  /** Опционально: ответы серверов до этого релиза поля не содержат. */
  performers?: ReportPerformer[] | null
  /** OCC-версия набора точек фотографий; по ней reconcile понимает, что менять. */
  photo_marks_version?: string | null
  /** Заполняется только когда сервер вызван с include_photos=true. */
  report_photos?: RemoteReportPhoto[] | null
}

export interface RemoteReportPhoto {
  id: string
  object_key: string
  thumb_object_key: string
  width: number | null
  height: number | null
  taken_at: string | null
}

export interface RemoteReportMark {
  plan_id: string
  page: number
  x_norm: number
  y_norm: number
  /**
   * null — легаси-метка «одна общая на отчёт», uuid — точка конкретного фото.
   * Опционально: ответы серверов до релиза поля не содержат, и тогда весь
   * массив трактуется как легаси.
   */
  photo_id?: string | null
}

export interface RemoteReportRowWithNested extends RemoteReportRow {
  report_photos: RemoteReportPhoto[] | null
  report_plan_marks: RemoteReportMark[] | null
}

export interface RemoteReportFull {
  card: ReportCard
  photos: RemoteReportPhoto[]
  /** Легаси-метка отчёта — та самая «одна общая точка». */
  mark: RemoteReportMark | null
  /** Точки фотографий: по одной на 360-снимок. */
  photoMarks: RemoteReportMark[]
  authorName: string | null
}

export interface MergedReportsResult {
  cards: ReportCard[]
  hasMore: boolean
  nextCursor: string | null
  /**
   * Метаданные фото по reportId. Заполняется только когда вызов
   * `loadMergedReports` сделан с `includePhotos: true` (нужно для режима
   * фотоленты). Для локальных отчётов сюда не пишем — их фото нужно
   * читать из IDB store `photos` напрямую.
   */
  photosByReportId?: Map<string, RemoteReportPhoto[]>
}

export interface ReportUpdateInput {
  workTypeId: string
  performerId: string
  /** Полный набор подрядчиков; первый элемент обязан совпадать с performerId. */
  performerIds: string[]
  workAssignmentId: string | null
  description: string | null
  takenAt: string | null
  planId?: string | null // undefined = не менять, null = убрать
  expectedUpdatedAt?: string | null
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/** Таймаут для сетевых запросов при загрузке списка отчётов (мс). */
export const FETCH_TIMEOUT_MS = 5_000
export const PAGE_SIZE = 50
