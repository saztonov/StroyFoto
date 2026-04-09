export interface Project {
  id: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectInput {
  name: string
  description?: string | null
}
