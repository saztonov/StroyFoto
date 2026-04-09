export type PerformerKind = 'contractor' | 'own_forces'

export interface Performer {
  id: string
  name: string
  kind: PerformerKind
  is_active: boolean
  created_at: string
}
