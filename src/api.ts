import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ExportRequest, ExportResult, GalleryPayload } from './types'

export const desktopAvailable = isTauri()

const browserPayload: GalleryPayload = {
  codexRoot: '~/.codex',
  imagesRoot: '~/.codex/generated_images',
  codexExists: false,
  generatedImagesExists: false,
  stateDbExists: false,
  images: [],
  sessions: [],
  tags: [],
  favoritePaths: [],
  warnings: ['Desktop backend is not connected. Run the app with Tauri to scan local Codex images.'],
}

export async function scanGallery(codexRoot?: string): Promise<GalleryPayload> {
  if (!desktopAvailable) {
    return browserPayload
  }

  return invoke<GalleryPayload>('scan_gallery', { codexRoot: codexRoot || null })
}

export async function toggleFavorite(path: string, codexRoot?: string): Promise<boolean> {
  if (!desktopAvailable) {
    return false
  }

  return invoke<boolean>('toggle_favorite', { path, codexRoot: codexRoot || null })
}

export async function addImageTag(
  path: string,
  tagName: string,
  codexRoot?: string,
): Promise<string[]> {
  if (!desktopAvailable) {
    return []
  }

  return invoke<string[]>('add_image_tag', { path, tagName, codexRoot: codexRoot || null })
}

export async function removeImageTag(
  path: string,
  tagName: string,
  codexRoot?: string,
): Promise<string[]> {
  if (!desktopAvailable) {
    return []
  }

  return invoke<string[]>('remove_image_tag', { path, tagName, codexRoot: codexRoot || null })
}

export async function renameTag(tagId: number, name: string): Promise<void> {
  if (!desktopAvailable) {
    return
  }

  await invoke('rename_tag', { tagId, name })
}

export async function deleteTag(tagId: number): Promise<void> {
  if (!desktopAvailable) {
    return
  }

  await invoke('delete_tag', { tagId })
}

export async function startGalleryWatch(codexRoot?: string): Promise<void> {
  if (!desktopAvailable) {
    return
  }

  await invoke('start_gallery_watch', { codexRoot: codexRoot || null })
}

export async function exportImages(request: ExportRequest): Promise<ExportResult> {
  if (!desktopAvailable) {
    return { exported: [] }
  }

  return invoke<ExportResult>('export_images', { request })
}

export async function readImageDataUrl(path: string, codexRoot?: string): Promise<string> {
  if (!desktopAvailable) {
    return ''
  }

  return invoke<string>('read_image_data_url', { path, codexRoot: codexRoot || null })
}

export async function readThumbnailDataUrl(path: string, codexRoot?: string): Promise<string> {
  if (!desktopAvailable) {
    return ''
  }

  return invoke<string>('read_thumbnail_data_url', { path, codexRoot: codexRoot || null })
}

export async function revealPath(path: string, codexRoot?: string): Promise<void> {
  if (!desktopAvailable) {
    return
  }

  await invoke('reveal_path', { path, codexRoot: codexRoot || null })
}

export async function onGalleryChanged(callback: () => void): Promise<() => void> {
  if (!desktopAvailable) {
    return () => {}
  }

  return listen('gallery-changed', callback)
}
