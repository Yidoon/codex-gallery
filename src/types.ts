export type ViewMode = 'timeline' | 'sessions' | 'favorites' | 'missing' | 'tags'

export interface SessionInfo {
  id: string
  title: string
  firstUserMessage: string
  cwd: string
  rolloutPath: string
  createdAtMs: number | null
  updatedAtMs: number | null
  archived: boolean
  missing: boolean
  imageCount: number
}

export interface ImageInfo {
  id: string
  path: string
  filename: string
  extension: string
  sessionId: string
  sessionTitle: string
  fileSize: number
  modifiedAtMs: number | null
  width: number | null
  height: number | null
  format: string
  favorited: boolean
  missingSession: boolean
  tags: string[]
  thumbnailKey: string
}

export interface TagInfo {
  id: number
  name: string
  imageCount: number
  createdAtMs: number
  updatedAtMs: number
}

export interface GalleryPayload {
  codexRoot: string
  imagesRoot: string
  codexExists: boolean
  generatedImagesExists: boolean
  stateDbExists: boolean
  images: ImageInfo[]
  sessions: SessionInfo[]
  tags: TagInfo[]
  favoritePaths: string[]
  warnings: string[]
}

export interface ExportRequest {
  paths: string[]
  targetDir: string
  naming: string
  customPrefix?: string
  codexRoot?: string
}

export interface ExportResult {
  exported: string[]
}
