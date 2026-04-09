export type Role = 'admin' | 'user'

export interface Profile {
  id: string
  full_name: string | null
  role: Role
  is_active: boolean
}
