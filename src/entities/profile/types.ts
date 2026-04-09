export type Role = 'admin' | 'user'

export interface Profile {
  id: string
  full_name: string | null
  role: Role
  is_active: boolean
}

export interface AdminProfile extends Profile {
  email: string
  created_at: string
  updated_at: string
}
