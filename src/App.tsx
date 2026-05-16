import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronLeft,
  Columns2,
  Copy,
  Download,
  FolderOpen,
  Grid3X3,
  ImageOff,
  Info,
  LayoutGrid,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  RefreshCw,
  Rows2,
  Star,
  SquareSplitVertical,
  SquareStack,
  Tag,
  Tags,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addImageTag,
  deleteTag,
  exportImages,
  onGalleryChanged,
  readImageDataUrl,
  revealPath,
  removeImageTag,
  renameTag,
  scanGallery,
  startGalleryWatch,
  toggleFavorite,
} from './api'
import { ThumbnailImage } from './components/ThumbnailImage'
import type { GalleryPayload, ImageInfo, SessionInfo, TagInfo, ViewMode } from './types'
import './App.css'

const galleryZoomSizes = [92, 132, 180, 238]
const sessionZoomSizes = [180, 238, 300, 360]
const maxCompareImages = 4

type CompareLayout = 'grid' | 'horizontal' | 'vertical' | 'stack'

type StackImageBounds = {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

type StackImageBoundsState = {
  pairKey: string
  bounds: StackImageBounds
}

type StackPairPaths = {
  basePath: string | null
  overlayPath: string | null
}

type CompareState = {
  paths: string[]
  stackPair: StackPairPaths
  open: boolean
}

function emptyStackPairPaths(): StackPairPaths {
  return { basePath: null, overlayPath: null }
}

function reconcileStackPairPaths(
  paths: string[],
  current: StackPairPaths,
  preferredBasePath?: string,
  preferredOverlayPath?: string,
): StackPairPaths {
  const availablePaths = paths.slice(0, maxCompareImages)
  if (availablePaths.length < 2) {
    return emptyStackPairPaths()
  }

  const fallbackBasePath = availablePaths[0]
  if (!fallbackBasePath) {
    return emptyStackPairPaths()
  }

  const baseCandidate = preferredBasePath ?? current.basePath
  const basePath =
    baseCandidate && availablePaths.includes(baseCandidate) ? baseCandidate : fallbackBasePath
  const overlayCandidate = preferredOverlayPath ?? current.overlayPath
  const overlayPath =
    overlayCandidate &&
    overlayCandidate !== basePath &&
    availablePaths.includes(overlayCandidate)
      ? overlayCandidate
      : availablePaths.find((path) => path !== basePath) ?? null

  return { basePath, overlayPath }
}

function stackPairPathsEqual(first: StackPairPaths, second: StackPairPaths) {
  return first.basePath === second.basePath && first.overlayPath === second.overlayPath
}

function comparePathListsEqual(first: string[], second: string[]) {
  return first.length === second.length && first.every((path, index) => path === second[index])
}

function reconcileCompareState(
  current: CompareState,
  paths: string[],
  preferredBasePath?: string,
  preferredOverlayPath?: string,
): CompareState {
  const stackPair = reconcileStackPairPaths(
    paths,
    current.stackPair,
    preferredBasePath,
    preferredOverlayPath,
  )
  const open = paths.length > 0 ? current.open : false
  if (
    comparePathListsEqual(current.paths, paths) &&
    stackPairPathsEqual(current.stackPair, stackPair) &&
    current.open === open
  ) {
    return current
  }
  return { paths, stackPair, open }
}

function App() {
  const [gallery, setGallery] = useState<GalleryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<ViewMode>('timeline')
  const [zoomLevel, setZoomLevel] = useState(2)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null)
  const [previewImage, setPreviewImage] = useState<ImageInfo | null>(null)
  const [infoImage, setInfoImage] = useState<ImageInfo | null>(null)
  const [tagImage, setTagImage] = useState<ImageInfo | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [compareState, setCompareState] = useState<CompareState>({
    paths: [],
    stackPair: emptyStackPairPaths(),
    open: false,
  })
  const [compareLayout, setCompareLayout] = useState<CompareLayout>('horizontal')
  const [compareSlider, setCompareSlider] = useState(50)
  const [tagMutationCount, setTagMutationCount] = useState(0)
  const [toast, setToast] = useState('')
  const loadRequestId = useRef(0)
  const comparePaths = compareState.paths
  const stackPairPaths = compareState.stackPair
  const compareOpen = compareState.open

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => {
      setToast((current) => (current === message ? '' : current))
    }, 2600)
  }, [])

  const loadGallery = useCallback(async (options?: { quiet?: boolean }) => {
    const requestId = loadRequestId.current + 1
    loadRequestId.current = requestId
    const quiet = options?.quiet ?? false
    if (quiet) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')
    try {
      const payload = await scanGallery()
      if (requestId !== loadRequestId.current) {
        return
      }
      setGallery(payload)
      const validImagePaths = new Set(payload.images.map((image) => image.path))
      setCompareState((current) => {
        const nextPaths = current.paths
          .filter((path) => validImagePaths.has(path))
          .slice(0, maxCompareImages)
        return reconcileCompareState(current, nextPaths)
      })
    } catch (loadError) {
      if (requestId !== loadRequestId.current) {
        return
      }
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (requestId === loadRequestId.current) {
        if (quiet) {
          setRefreshing(false)
        }
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadGallery()
      }
    })

    return () => {
      cancelled = true
    }
  }, [loadGallery])

  useEffect(() => {
    let timer: number | undefined
    let unlisten: (() => void) | undefined

    void startGalleryWatch()
    void onGalleryChanged(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void startGalleryWatch().finally(() => {
          void loadGallery({ quiet: true })
        })
      }, 900)
    }).then((cleanup) => {
      unlisten = cleanup
    })

    return () => {
      window.clearTimeout(timer)
      unlisten?.()
    }
  }, [loadGallery])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!previewImage) {
        return
      }
      if (event.key === 'Escape') {
        setPreviewImage(null)
      }
      if (event.key === 'ArrowRight') {
        movePreview(1)
      }
      if (event.key === 'ArrowLeft') {
        movePreview(-1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const sessionsById = useMemo(() => {
    const map = new Map<string, SessionInfo>()
    for (const session of gallery?.sessions ?? []) {
      map.set(session.id, session)
    }
    return map
  }, [gallery])

  const selectedTag = useMemo(() => {
    if (selectedTagId === null) {
      return null
    }
    return gallery?.tags.find((tag) => tag.id === selectedTagId) ?? null
  }, [gallery, selectedTagId])

  const filteredImages = useMemo(() => {
    let images = gallery?.images ?? []

    if (view === 'favorites') {
      images = images.filter((image) => image.favorited)
    }
    if (view === 'missing') {
      images = images.filter((image) => image.missingSession)
    }
    if (selectedSessionId) {
      images = images.filter((image) => image.sessionId === selectedSessionId)
    }
    if (selectedTag) {
      images = images.filter((image) => image.tags.includes(selectedTag.name))
    }
    return images
  }, [gallery, selectedSessionId, selectedTag, view])

  const filteredSessions = useMemo(() => {
    return gallery?.sessions ?? []
  }, [gallery])

  const imagesBySessionId = useMemo(() => {
    return groupImagesBySession(gallery?.images ?? [])
  }, [gallery])
  const imagesByTagName = useMemo(() => groupImagesByTag(gallery?.images ?? []), [gallery])
  const timelineGroups = useMemo(() => groupImagesByDate(filteredImages), [filteredImages])
  const currentPreviewImage = useMemo(
    () =>
      previewImage
        ? (gallery?.images.find((image) => image.path === previewImage.path) ?? previewImage)
        : null,
    [gallery, previewImage],
  )
  const currentInfoImage = useMemo(
    () =>
      infoImage ? (gallery?.images.find((image) => image.path === infoImage.path) ?? infoImage) : null,
    [gallery, infoImage],
  )
  const currentTagImage = useMemo(
    () =>
      tagImage ? (gallery?.images.find((image) => image.path === tagImage.path) ?? tagImage) : null,
    [gallery, tagImage],
  )
  const compareImages = useMemo(() => {
    const imagesByPath = new Map((gallery?.images ?? []).map((image) => [image.path, image]))
    return comparePaths.flatMap((path) => {
      const image = imagesByPath.get(path)
      return image ? [image] : []
    })
  }, [comparePaths, gallery])
  const comparePathSet = useMemo(() => new Set(comparePaths), [comparePaths])
  const currentPreviewIndex = currentPreviewImage
    ? filteredImages.findIndex((image) => image.path === currentPreviewImage.path)
    : -1
  const visiblePreviewImage = currentPreviewIndex >= 0 ? currentPreviewImage : null
  const activeZoomSizes = selectedSessionId ? sessionZoomSizes : galleryZoomSizes
  const tileSize = activeZoomSizes[zoomLevel]
  const selectedSession = selectedSessionId ? sessionsById.get(selectedSessionId) : null
  const stats = useMemo(() => buildStats(gallery), [gallery])
  const imageActionsAvailable = !(view === 'tags' && !selectedTag)
  const tagOperationPending = tagMutationCount > 0

  function beginTagMutation() {
    setTagMutationCount((current) => current + 1)
    return () => setTagMutationCount((current) => Math.max(0, current - 1))
  }

  function movePreview(direction: number) {
    if (currentPreviewIndex < 0 || filteredImages.length === 0) {
      return
    }
    const nextIndex =
      (currentPreviewIndex + direction + filteredImages.length) % filteredImages.length
    setPreviewImage(filteredImages[nextIndex])
  }

  function setActiveView(nextView: ViewMode) {
    setView(nextView)
    setSelectedSessionId(null)
    setSelectedTagId(null)
    setPreviewImage(null)
    setSelectedPaths(new Set())
    setSelectMode(false)
  }

  function openTag(tagId: number) {
    setView('tags')
    setSelectedTagId(tagId)
    setSelectedSessionId(null)
    setPreviewImage(null)
    setSelectedPaths(new Set())
    setSelectMode(false)
  }

  async function handleFavorite(image: ImageInfo) {
    try {
      const favorited = await toggleFavorite(image.path, gallery?.codexRoot)
      setGallery((current) => {
        if (!current) {
          return current
        }
        const favoritePaths = new Set(current.favoritePaths)
        if (favorited) {
          favoritePaths.add(image.path)
        } else {
          favoritePaths.delete(image.path)
        }
        return {
          ...current,
          favoritePaths: Array.from(favoritePaths),
          images: current.images.map((item) =>
            item.path === image.path ? { ...item, favorited } : item,
          ),
        }
      })
      setPreviewImage((current) =>
        current?.path === image.path ? { ...current, favorited } : current,
      )
      setInfoImage((current) =>
        current?.path === image.path ? { ...current, favorited } : current,
      )
      if (!favorited && view === 'favorites') {
        setPreviewImage((current) => (current?.path === image.path ? null : current))
      }
    } catch (favoriteError) {
      showToast(`Could not update favorite: ${errorMessage(favoriteError)}`)
    }
  }

  function patchImageTags(path: string, tags: string[]) {
    setGallery((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        images: current.images.map((item) => (item.path === path ? { ...item, tags } : item)),
      }
    })
    setPreviewImage((current) => (current?.path === path ? { ...current, tags } : current))
    setInfoImage((current) => (current?.path === path ? { ...current, tags } : current))
    setTagImage((current) => (current?.path === path ? { ...current, tags } : current))
  }

  async function handleAddTag(image: ImageInfo, tagName: string) {
    const endTagMutation = beginTagMutation()
    try {
      const tags = await addImageTag(image.path, tagName, gallery?.codexRoot)
      patchImageTags(image.path, tags)
      await loadGallery({ quiet: true })
    } catch (tagError) {
      showToast(`Could not add tag: ${errorMessage(tagError)}`)
    } finally {
      endTagMutation()
    }
  }

  async function handleRemoveTag(image: ImageInfo, tagName: string) {
    const endTagMutation = beginTagMutation()
    try {
      const tags = await removeImageTag(image.path, tagName, gallery?.codexRoot)
      patchImageTags(image.path, tags)
      if (selectedTag?.name === tagName) {
        setPreviewImage((current) => (current?.path === image.path ? null : current))
      }
      await loadGallery({ quiet: true })
    } catch (tagError) {
      showToast(`Could not remove tag: ${errorMessage(tagError)}`)
    } finally {
      endTagMutation()
    }
  }

  async function handleRenameTag(tagId: number, name: string) {
    const endTagMutation = beginTagMutation()
    try {
      await renameTag(tagId, name)
      await loadGallery({ quiet: true })
      showToast('Tag renamed.')
    } catch (tagError) {
      showToast(`Could not rename tag: ${errorMessage(tagError)}`)
    } finally {
      endTagMutation()
    }
  }

  async function handleDeleteTag(tagId: number) {
    const endTagMutation = beginTagMutation()
    try {
      await deleteTag(tagId)
      if (selectedTagId === tagId) {
        setSelectedTagId(null)
        setPreviewImage(null)
      }
      await loadGallery({ quiet: true })
      showToast('Tag deleted.')
    } catch (tagError) {
      showToast(`Could not delete tag: ${errorMessage(tagError)}`)
    } finally {
      endTagMutation()
    }
  }

  function toggleSelected(path: string) {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function handleToggleCompare(image: ImageInfo) {
    if (comparePathSet.has(image.path)) {
      setCompareState((current) =>
        reconcileCompareState(
          current,
          current.paths.filter((path) => path !== image.path),
        ),
      )
      return
    }

    if (comparePaths.length >= maxCompareImages) {
      showToast(`Compare supports up to ${maxCompareImages} images.`)
      return
    }

    setCompareState((current) => {
      if (current.paths.includes(image.path) || current.paths.length >= maxCompareImages) {
        return current
      }
      return reconcileCompareState(current, [...current.paths, image.path])
    })
  }

  function removeComparePath(path: string) {
    setCompareState((current) =>
      reconcileCompareState(
        current,
        current.paths.filter((item) => item !== path),
      ),
    )
  }

  function clearCompareImages() {
    setCompareState({
      paths: [],
      stackPair: emptyStackPairPaths(),
      open: false,
    })
  }

  function handleSetStackBase(path: string) {
    setCompareState((current) =>
      reconcileCompareState(current, current.paths, path),
    )
    setCompareSlider(50)
  }

  function handleSwapStackPair(basePath: string, overlayPath: string) {
    setCompareState((current) =>
      reconcileCompareState(current, current.paths, overlayPath, basePath),
    )
  }

  async function handleExport(paths: string[]) {
    if (paths.length === 0) {
      return
    }
    try {
      const result = await exportImages({
        paths,
        targetDir: '',
        naming: 'original',
        codexRoot: gallery?.codexRoot,
      })
      if (result.exported.length === 0) {
        showToast('No images were exported.')
        return
      }
      const suffix = result.exported.length === paths.length ? '' : ` of ${paths.length}`
      showToast(
        `Exported ${result.exported.length}${suffix} image${
          result.exported.length === 1 ? '' : 's'
        } to Downloads`,
      )
      setSelectMode(false)
      setSelectedPaths(new Set())
    } catch (exportError) {
      showToast(`Could not export images: ${errorMessage(exportError)}`)
    }
  }

  async function handleReveal(path: string) {
    try {
      await revealPath(path, gallery?.codexRoot)
    } catch (revealError) {
      showToast(`Could not show file: ${errorMessage(revealError)}`)
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      showToast('Copied path.')
    } catch (copyError) {
      showToast(`Could not copy path: ${errorMessage(copyError)}`)
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLElement>) {
    if (!event.ctrlKey) {
      return
    }
    event.preventDefault()
    setZoomLevel((current) => {
      if (event.deltaY > 0) {
        return Math.max(0, current - 1)
      }
        return Math.min(activeZoomSizes.length - 1, current + 1)
      })
    }

  const selectedExportPaths = Array.from(selectedPaths)
  const canZoomOut = zoomLevel > 0
  const canZoomIn = zoomLevel < activeZoomSizes.length - 1

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Grid3X3 size={18} aria-hidden="true" />
          <div className="brand-copy">
            <strong>Codex Gallery</strong>
          </div>
        </div>

        <nav className="nav-list" aria-label="Gallery views">
          <NavButton
            active={view === 'timeline'}
            icon={<CalendarDays size={18} />}
            label="Timeline"
            count={stats.total}
            onClick={() => setActiveView('timeline')}
          />
          <NavButton
            active={view === 'sessions'}
            icon={<MessagesSquare size={18} />}
            label="Sessions"
            count={stats.sessions}
            onClick={() => setActiveView('sessions')}
          />
          <NavButton
            active={view === 'favorites'}
            icon={<Star size={18} />}
            label="Favorites"
            count={stats.favorites}
            onClick={() => setActiveView('favorites')}
          />
          <NavButton
            active={view === 'missing'}
            icon={<AlertCircle size={18} />}
            label="Missing"
            count={stats.missing}
            onClick={() => setActiveView('missing')}
          />
          <NavButton
            active={view === 'tags' && selectedTagId === null}
            icon={<Tags size={18} />}
            label="Tags"
            count={stats.tags}
            onClick={() => setActiveView('tags')}
          />
        </nav>

        <TagSidebar
          tags={gallery?.tags ?? []}
          activeTagId={selectedTagId}
          onOpenTag={openTag}
          onManageTags={() => setActiveView('tags')}
        />
      </aside>

      <main className="workspace" onWheel={handleWheel}>
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">{viewLabel(view, selectedSession, selectedTag)}</p>
            <h1>{selectedSession?.title ?? selectedTag?.name ?? pageTitle(view)}</h1>
          </div>

          <CompareTray
            images={compareImages}
            codexRoot={gallery?.codexRoot}
            onOpen={() =>
              setCompareState((current) =>
                current.paths.length > 0 ? { ...current, open: true } : current,
              )
            }
            onRemove={removeComparePath}
            onClear={clearCompareImages}
          />

          <div className="topbar-actions">
            {imageActionsAvailable ? (
              <>
                <button
                  type="button"
                  className="icon-only"
                  title="Smaller thumbnails"
                  aria-label="Smaller thumbnails"
                  disabled={!canZoomOut}
                  onClick={() => setZoomLevel((current) => Math.max(0, current - 1))}
                >
                  <ZoomOut size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-only"
                  title="Larger thumbnails"
                  aria-label="Larger thumbnails"
                  disabled={!canZoomIn}
                  onClick={() =>
                    setZoomLevel((current) => Math.min(activeZoomSizes.length - 1, current + 1))
                  }
                >
                  <ZoomIn size={17} aria-hidden="true" />
                </button>
                {!selectMode ? (
                  <button
                    type="button"
                    className="text-button"
                    title="Select images"
                    aria-label="Select images"
                    onClick={() => {
                      setSelectMode(true)
                      setSelectedPaths(new Set())
                    }}
                  >
                    <Check size={17} aria-hidden="true" />
                    Select
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="text-button"
                      title="Cancel selection"
                      onClick={() => {
                        setSelectMode(false)
                        setSelectedPaths(new Set())
                      }}
                    >
                      <X size={17} aria-hidden="true" />
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      title="Export selected images to Downloads"
                      disabled={selectedExportPaths.length === 0}
                      onClick={() => void handleExport(selectedExportPaths)}
                    >
                      <Download size={17} aria-hidden="true" />
                      Export {selectedExportPaths.length || ''}
                    </button>
                  </>
                )}
              </>
            ) : null}
            <button
              type="button"
              className={`icon-button ${refreshing ? 'refreshing' : ''}`}
              title="Rescan Codex images"
              disabled={refreshing}
              onClick={() => void loadGallery({ quiet: Boolean(gallery) })}
            >
              <RefreshCw size={18} aria-hidden="true" />
              <span>{refreshing ? 'Refreshing' : 'Rescan'}</span>
            </button>
          </div>
        </header>

        {gallery?.warnings.length ? (
          <div className="warning-strip">
            <AlertCircle size={17} aria-hidden="true" />
            <span>{gallery.warnings[0]}</span>
          </div>
        ) : null}

        <section className="content-panel">
          {loading ? <LoadingState /> : null}
          {!loading && error ? <ErrorState message={error} onRetry={() => void loadGallery()} /> : null}
          {!loading && !error ? (
            <GalleryContent
              gallery={gallery}
              codexRoot={gallery?.codexRoot}
              view={view}
              filteredImages={filteredImages}
              filteredSessions={filteredSessions}
              imagesBySessionId={imagesBySessionId}
              imagesByTagName={imagesByTagName}
              timelineGroups={timelineGroups}
              selectedSession={selectedSession}
              selectedSessionId={selectedSessionId}
              selectedTag={selectedTag}
              tileSize={tileSize}
              selectedPaths={selectedPaths}
              selectMode={selectMode}
              comparePaths={comparePathSet}
              onBackToSessions={() => setSelectedSessionId(null)}
              onBackToTags={() => setSelectedTagId(null)}
              onOpenSession={(sessionId) => {
                setView('sessions')
                setSelectedSessionId(sessionId)
                setSelectedTagId(null)
                setPreviewImage(null)
                setZoomLevel((current) => Math.max(current, 2))
              }}
              onOpenTag={openTag}
              onRenameTag={(tagId, name) => void handleRenameTag(tagId, name)}
              onDeleteTag={(tagId) => void handleDeleteTag(tagId)}
              tagOperationPending={tagOperationPending}
              onOpenPreview={setPreviewImage}
              onShowInfo={setInfoImage}
              onEditTags={(image) => {
                setTagImage(image)
                setInfoImage(null)
              }}
              onToggleFavorite={(image) => void handleFavorite(image)}
              onToggleCompare={handleToggleCompare}
              onToggleSelected={toggleSelected}
            />
          ) : null}
        </section>
      </main>

      {visiblePreviewImage ? (
        <PreviewModal
          image={visiblePreviewImage}
          codexRoot={gallery?.codexRoot}
          index={currentPreviewIndex}
          total={filteredImages.length}
          onClose={() => setPreviewImage(null)}
          onPrevious={() => movePreview(-1)}
          onNext={() => movePreview(1)}
          onFavorite={(image) => void handleFavorite(image)}
          onInfo={setInfoImage}
          onTags={(image) => {
            setTagImage(image)
            setInfoImage(null)
          }}
          onReveal={(path) => void handleReveal(path)}
          onExport={(path) => void handleExport([path])}
          onError={showToast}
        />
      ) : null}

      {currentInfoImage ? (
        <InfoDrawer
          image={currentInfoImage}
          codexRoot={gallery?.codexRoot}
          session={sessionsById.get(currentInfoImage.sessionId)}
          onClose={() => setInfoImage(null)}
          onCopy={(value) => void handleCopy(value)}
          onReveal={(path) => void handleReveal(path)}
          onAddTag={(image, tagName) => void handleAddTag(image, tagName)}
          onRemoveTag={(image, tagName) => void handleRemoveTag(image, tagName)}
          tagOperationPending={tagOperationPending}
          onError={showToast}
        />
      ) : null}

      {currentTagImage ? (
        <TagDrawer
          image={currentTagImage}
          codexRoot={gallery?.codexRoot}
          onClose={() => setTagImage(null)}
          onAddTag={(image, tagName) => void handleAddTag(image, tagName)}
          onRemoveTag={(image, tagName) => void handleRemoveTag(image, tagName)}
          tagOperationPending={tagOperationPending}
        />
      ) : null}

      {compareOpen && compareImages.length > 0 ? (
        <CompareModal
          images={compareImages}
          codexRoot={gallery?.codexRoot}
          layout={compareLayout}
          slider={compareSlider}
          stackBasePath={stackPairPaths.basePath}
          stackOverlayPath={stackPairPaths.overlayPath}
          onClose={() => setCompareState((current) => ({ ...current, open: false }))}
          onLayoutChange={setCompareLayout}
          onSliderChange={setCompareSlider}
          onSetStackBase={handleSetStackBase}
          onSwapStackPair={handleSwapStackPair}
          onRemove={removeComparePath}
          onClear={clearCompareImages}
          onFavorite={(image) => void handleFavorite(image)}
          onError={showToast}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

function GalleryContent(props: {
  gallery: GalleryPayload | null
  codexRoot?: string
  view: ViewMode
  filteredImages: ImageInfo[]
  filteredSessions: SessionInfo[]
  imagesBySessionId: Map<string, ImageInfo[]>
  imagesByTagName: Map<string, ImageInfo[]>
  timelineGroups: Array<{ label: string; images: ImageInfo[] }>
  selectedSession: SessionInfo | null | undefined
  selectedSessionId: string | null
  selectedTag: TagInfo | null
  tileSize: number
  selectedPaths: Set<string>
  selectMode: boolean
  comparePaths: Set<string>
  onBackToSessions: () => void
  onBackToTags: () => void
  onOpenSession: (sessionId: string) => void
  onOpenTag: (tagId: number) => void
  onRenameTag: (tagId: number, name: string) => void
  onDeleteTag: (tagId: number) => void
  tagOperationPending: boolean
  onOpenPreview: (image: ImageInfo) => void
  onShowInfo: (image: ImageInfo) => void
  onEditTags: (image: ImageInfo) => void
  onToggleFavorite: (image: ImageInfo) => void
  onToggleCompare: (image: ImageInfo) => void
  onToggleSelected: (path: string) => void
}) {
  const {
    gallery,
    codexRoot,
    view,
    filteredImages,
    filteredSessions,
    imagesBySessionId,
    imagesByTagName,
    timelineGroups,
    selectedSession,
    selectedSessionId,
    selectedTag,
    tileSize,
  } = props

  if (!gallery?.codexExists) {
    return (
      <EmptyState
        icon={<FolderOpen size={28} />}
        title="Codex data directory not found"
        message="Codex Gallery looks for generated images in ~/.codex. Open Codex and generate an image first."
      />
    )
  }

  if (!gallery.generatedImagesExists) {
    return (
      <EmptyState
        icon={<ImageOff size={28} />}
        title="No generated_images directory yet"
        message="Codex-generated images will appear here after Codex creates them."
      />
    )
  }

  if (gallery.images.length === 0) {
    return (
      <EmptyState
        icon={<ImageOff size={28} />}
        title="No Codex images yet"
        message="Generate images in Codex, then they will appear here automatically."
      />
    )
  }

  if (view === 'tags' && !selectedTag) {
    return (
      <TagManagementPage
        tags={gallery.tags}
        imagesByTagName={imagesByTagName}
        codexRoot={codexRoot}
        onOpenTag={props.onOpenTag}
        onRenameTag={props.onRenameTag}
        onDeleteTag={props.onDeleteTag}
        tagOperationPending={props.tagOperationPending}
      />
    )
  }

  if (view === 'sessions' && !selectedSessionId) {
    if (filteredSessions.length === 0) {
      return (
        <EmptyState
          icon={<MessagesSquare size={28} />}
          title="No image sessions yet"
          message="Sessions will appear here after Codex generates images."
        />
      )
    }

    return (
      <div className="session-list">
        {filteredSessions.map((session) => {
          const images = imagesBySessionId.get(session.id) ?? []
          return (
            <SessionRow
              key={session.id}
              session={session}
              images={images}
              codexRoot={codexRoot}
              onOpen={() => props.onOpenSession(session.id)}
            />
          )
        })}
      </div>
    )
  }

  if (selectedTag) {
    return (
      <div>
        <button type="button" className="back-button" onClick={props.onBackToTags}>
          <ChevronLeft size={17} aria-hidden="true" />
          All tags
        </button>
        <div className="session-detail">
          <p>{selectedTag.name}</p>
          <span>{filteredImages.length} images</span>
        </div>
        {filteredImages.length === 0 ? (
          <EmptyState
            icon={<ImageOff size={28} />}
            title="No images for this tag"
            message="This tag is not attached to any current Codex images."
          />
        ) : (
          <ImageGrid {...props} images={filteredImages} tileSize={tileSize} />
        )}
      </div>
    )
  }

  if (selectedSession) {
    return (
      <div>
        <button type="button" className="back-button" onClick={props.onBackToSessions}>
          <ChevronLeft size={17} aria-hidden="true" />
          All sessions
        </button>
        <div className="session-detail">
          <p>{selectedSession.cwd || selectedSession.id}</p>
          <span>{selectedSession.imageCount} images</span>
        </div>
        <ImageGrid {...props} images={filteredImages} tileSize={tileSize} />
      </div>
    )
  }

  if (filteredImages.length === 0) {
    return (
      <EmptyState
        icon={<ImageOff size={28} />}
        title="No images in this view"
        message="Try another section from the sidebar."
      />
    )
  }

  if (view === 'timeline') {
    return (
      <div className="timeline">
        {timelineGroups.map((group) => (
          <section className="timeline-group" key={group.label}>
            <h2>{group.label}</h2>
            <ImageGrid {...props} images={group.images} tileSize={tileSize} />
          </section>
        ))}
      </div>
    )
  }

  return <ImageGrid {...props} images={filteredImages} tileSize={tileSize} />
}

function TagSidebar(props: {
  tags: TagInfo[]
  activeTagId: number | null
  onOpenTag: (tagId: number) => void
  onManageTags: () => void
}) {
  return (
    <section className="sidebar-tags" aria-label="Tags">
      <div className="sidebar-section-header">
        <span>Tags</span>
        <button type="button" className="sidebar-icon-button" title="Manage tags" onClick={props.onManageTags}>
          <Pencil size={14} aria-hidden="true" />
        </button>
      </div>
      {props.tags.length === 0 ? (
        <p className="sidebar-empty">No tags yet</p>
      ) : (
        <div className="tag-nav-list">
          {props.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`tag-nav-button ${props.activeTagId === tag.id ? 'active' : ''}`}
              onClick={() => props.onOpenTag(tag.id)}
            >
              <Tag size={15} aria-hidden="true" />
              <span>{tag.name}</span>
              <em>{tag.imageCount}</em>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function TagManagementPage(props: {
  tags: TagInfo[]
  imagesByTagName: Map<string, ImageInfo[]>
  codexRoot?: string
  onOpenTag: (tagId: number) => void
  onRenameTag: (tagId: number, name: string) => void
  onDeleteTag: (tagId: number) => void
  tagOperationPending: boolean
}) {
  if (props.tags.length === 0) {
    return (
      <EmptyState
        icon={<Tags size={28} />}
        title="No tags yet"
        message="Add tags from an image tile or preview."
      />
    )
  }

  return (
    <div className="tag-page">
      <div className="tag-page-header">
        <h2>Tags</h2>
        <span>{props.tags.length} total</span>
      </div>
      <div className="tag-management-list">
        {props.tags.map((tag) => (
          <TagManagementRow
            key={tag.id}
            tag={tag}
            images={props.imagesByTagName.get(tag.name) ?? []}
            codexRoot={props.codexRoot}
            onOpen={() => props.onOpenTag(tag.id)}
            onRename={(name) => props.onRenameTag(tag.id, name)}
            onDelete={() => props.onDeleteTag(tag.id)}
            busy={props.tagOperationPending}
          />
        ))}
      </div>
    </div>
  )
}

function TagManagementRow(props: {
  tag: TagInfo
  images: ImageInfo[]
  codexRoot?: string
  busy: boolean
  onOpen: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.tag.name)
  const previewImages = props.images.slice(0, 5)
  const extraCount = Math.max(0, props.images.length - previewImages.length)

  function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = draft.trim()
    if (!nextName || nextName === props.tag.name) {
      setEditing(false)
      setDraft(props.tag.name)
      return
    }
    props.onRename(nextName)
    setEditing(false)
  }

  function confirmDelete() {
    const confirmed = window.confirm(`Delete tag "${props.tag.name}" from all images?`)
    if (confirmed) {
      props.onDelete()
    }
  }

  return (
    <div className="tag-row">
      <div className="tag-row-main">
        {editing ? (
          <form className="tag-edit-form" onSubmit={submitRename}>
            <input
              value={draft}
              maxLength={48}
              autoFocus
              disabled={props.busy}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className="icon-only"
              title="Save tag"
              aria-label="Save tag"
              disabled={props.busy}
            >
              <Check size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-only"
              title="Cancel edit"
              aria-label="Cancel edit"
              disabled={props.busy}
              onClick={() => {
                setEditing(false)
                setDraft(props.tag.name)
              }}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <button type="button" className="tag-title-button" onClick={props.onOpen}>
            <Tag size={17} aria-hidden="true" />
            <span>{props.tag.name}</span>
          </button>
        )}
        <span className="tag-row-count">{props.tag.imageCount} images</span>
      </div>

      <button type="button" className="tag-preview-strip" onClick={props.onOpen} aria-label={`Open ${props.tag.name}`}>
        {previewImages.map((image) => (
          <ThumbnailImage key={image.thumbnailKey} image={image} alt="" codexRoot={props.codexRoot} />
        ))}
        {extraCount > 0 ? <span>+{extraCount}</span> : null}
      </button>

      <div className="tag-row-actions">
        <button
          type="button"
          className="icon-only"
          title="Rename tag"
          aria-label="Rename tag"
          disabled={props.busy}
          onClick={() => {
            setDraft(props.tag.name)
            setEditing(true)
          }}
        >
          <Pencil size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-only danger"
          title="Delete tag"
          aria-label="Delete tag"
          disabled={props.busy}
          onClick={confirmDelete}
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function SessionRow(props: {
  session: SessionInfo
  images: ImageInfo[]
  codexRoot?: string
  onOpen: () => void
}) {
  const previewImages = props.images.slice(0, 5)
  const extraCount = Math.max(0, props.images.length - previewImages.length)

  return (
    <button type="button" className="session-row" onClick={props.onOpen}>
      <div className="session-copy">
        <h2>{props.session.title}</h2>
        <p>{props.session.cwd || props.session.id}</p>
      </div>
      <div className="session-preview-strip" aria-hidden="true">
        {previewImages.map((image) => (
          <ThumbnailImage key={image.thumbnailKey} image={image} alt="" codexRoot={props.codexRoot} />
        ))}
        {extraCount > 0 ? <span>+{extraCount}</span> : null}
      </div>
      <span className="session-count">{props.session.imageCount} images</span>
    </button>
  )
}

function ImageGrid(props: {
  images: ImageInfo[]
  tileSize: number
  codexRoot?: string
  selectedPaths: Set<string>
  selectMode: boolean
  comparePaths: Set<string>
  onOpenPreview: (image: ImageInfo) => void
  onShowInfo: (image: ImageInfo) => void
  onEditTags: (image: ImageInfo) => void
  onToggleFavorite: (image: ImageInfo) => void
  onToggleCompare: (image: ImageInfo) => void
  onToggleSelected: (path: string) => void
}) {
  return (
    <div
      className="image-grid"
      style={{ '--tile-size': `${props.tileSize}px` } as React.CSSProperties}
    >
      {props.images.map((image) => (
        <ImageTile key={image.path} image={image} {...props} />
      ))}
    </div>
  )
}

function ImageTile(props: {
  image: ImageInfo
  codexRoot?: string
  selectedPaths: Set<string>
  selectMode: boolean
  comparePaths: Set<string>
  onOpenPreview: (image: ImageInfo) => void
  onShowInfo: (image: ImageInfo) => void
  onEditTags: (image: ImageInfo) => void
  onToggleFavorite: (image: ImageInfo) => void
  onToggleCompare: (image: ImageInfo) => void
  onToggleSelected: (path: string) => void
}) {
  const { comparePaths, image, selectedPaths, selectMode } = props
  const selected = selectedPaths.has(image.path)
  const compared = comparePaths.has(image.path)

  return (
    <article
      className={`image-tile ${selected ? 'selected' : ''} ${compared ? 'compared' : ''} ${
        selectMode ? 'selecting' : ''
      }`}
    >
      <button
        type="button"
        className="thumbnail-button"
        onClick={() => {
          if (selectMode) {
            props.onToggleSelected(image.path)
          } else {
            props.onOpenPreview(image)
          }
        }}
      >
        <ThumbnailImage
          key={image.thumbnailKey}
          image={image}
          alt={image.filename}
          codexRoot={props.codexRoot}
        />
      </button>
      <div className="tile-actions">
        <button
          type="button"
          className={`round-action ${image.favorited ? 'favorited' : ''}`}
          onClick={() => props.onToggleFavorite(image)}
          title={image.favorited ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={image.favorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={16} fill={image.favorited ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className={`round-action ${compared ? 'compared' : ''}`}
          onClick={() => props.onToggleCompare(image)}
          title={compared ? 'Remove from compare' : 'Compare image'}
          aria-label={compared ? 'Remove from compare' : 'Compare image'}
        >
          <SquareSplitVertical size={16} />
        </button>
        <button
          type="button"
          className="round-action"
          onClick={() => props.onEditTags(image)}
          title="Edit tags"
          aria-label="Edit tags"
        >
          <Tag size={16} />
        </button>
        <button
          type="button"
          className="round-action"
          onClick={() => props.onShowInfo(image)}
          title="Show image info"
          aria-label="Show image info"
        >
          <Info size={16} />
        </button>
        <button
          type="button"
          className={`round-action check-action ${selected ? 'selected' : ''}`}
          onClick={() => props.onToggleSelected(image.path)}
          title={selected ? 'Unselect image' : 'Select image'}
          aria-label={selected ? 'Unselect image' : 'Select image'}
        >
          <Check size={16} />
        </button>
      </div>
    </article>
  )
}

function CompareTray(props: {
  images: ImageInfo[]
  codexRoot?: string
  onOpen: () => void
  onRemove: (path: string) => void
  onClear: () => void
}) {
  const [clearActionVisible, setClearActionVisible] = useState(false)
  const actionClusterRef = useRef<HTMLDivElement | null>(null)

  if (props.images.length === 0) {
    return null
  }

  function hideClearActionWhenUnfocused() {
    if (!actionClusterRef.current?.contains(document.activeElement)) {
      setClearActionVisible(false)
    }
  }

  return (
    <section className="compare-tray" aria-label="Compare images">
      <div className="compare-tray-thumbs">
        {props.images.map((image) => (
          <div className="compare-tray-thumb" key={image.path}>
            <button
              type="button"
              className="compare-thumb-button"
              title={image.filename}
              aria-label={`Open compare from ${image.filename}`}
              onClick={props.onOpen}
            >
              <ThumbnailImage image={image} alt="" codexRoot={props.codexRoot} eager />
            </button>
            <button
              type="button"
              className="compare-thumb-remove"
              title="Remove from compare"
              aria-label={`Remove ${image.filename} from compare`}
              onClick={() => props.onRemove(image.path)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div
        ref={actionClusterRef}
        className={`compare-action-cluster ${clearActionVisible ? 'expanded' : ''}`}
        onPointerEnter={() => setClearActionVisible(true)}
        onPointerLeave={hideClearActionWhenUnfocused}
        onFocus={() => setClearActionVisible(true)}
        onBlur={(event) => {
          const nextFocusedElement = event.relatedTarget instanceof Node ? event.relatedTarget : null
          if (!event.currentTarget.contains(nextFocusedElement)) {
            setClearActionVisible(false)
          }
        }}
      >
        <button
          type="button"
          className="compare-open-button"
          title="Open compare"
          aria-label={`Open compare with ${props.images.length} images`}
          onClick={props.onOpen}
        >
          <SquareSplitVertical size={16} aria-hidden="true" />
          <span>Compare</span>
        </button>
        <button
          type="button"
          className="compare-clear-button"
          title="Clear compare"
          aria-label="Clear all compare images"
          aria-hidden={!clearActionVisible}
          tabIndex={clearActionVisible ? 0 : -1}
          onClick={props.onClear}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

function CompareModal(props: {
  images: ImageInfo[]
  codexRoot?: string
  layout: CompareLayout
  slider: number
  stackBasePath: string | null
  stackOverlayPath: string | null
  onClose: () => void
  onLayoutChange: (layout: CompareLayout) => void
  onSliderChange: (value: number) => void
  onSetStackBase: (path: string) => void
  onSwapStackPair: (basePath: string, overlayPath: string) => void
  onRemove: (path: string) => void
  onClear: () => void
  onFavorite: (image: ImageInfo) => void
  onError: (message: string) => void
}) {
  const stackAvailable = props.images.length >= 2
  const gridAvailable = props.images.length >= 3
  const activeLayout =
    !stackAvailable
      ? 'horizontal'
      : props.layout === 'grid' && !gridAvailable
        ? 'horizontal'
        : props.layout
  const countStyle = { '--compare-count': props.images.length } as React.CSSProperties
  const onClose = props.onClose

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="compare-backdrop" role="dialog" aria-modal="true">
      <div className="compare-toolbar">
        <div className="compare-title">
          <p className="eyebrow">Compare</p>
          <h2>{props.images.length} images</h2>
        </div>
        {stackAvailable ? (
          <div className="compare-layout-controls" role="group" aria-label="Compare layout">
            <button
              type="button"
              className={`icon-only ${activeLayout === 'horizontal' ? 'active' : ''}`}
              title="Left right layout"
              aria-label="Left right layout"
              onClick={() => props.onLayoutChange('horizontal')}
            >
              <Columns2 size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`icon-only ${activeLayout === 'vertical' ? 'active' : ''}`}
              title="Top bottom layout"
              aria-label="Top bottom layout"
              onClick={() => props.onLayoutChange('vertical')}
            >
              <Rows2 size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`icon-only ${activeLayout === 'stack' ? 'active' : ''}`}
              title="Stack compare"
              aria-label="Stack compare"
              onClick={() => props.onLayoutChange('stack')}
            >
              <SquareStack size={18} aria-hidden="true" />
            </button>
            {gridAvailable ? (
              <button
                type="button"
                className={`icon-only ${activeLayout === 'grid' ? 'active' : ''}`}
                title="Grid layout"
                aria-label="Grid layout"
                onClick={() => props.onLayoutChange('grid')}
              >
                <LayoutGrid size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : (
          <div aria-hidden="true" />
        )}
        <div className="compare-actions">
          <button
            type="button"
            className="text-button"
            title="Clear compare"
            onClick={props.onClear}
          >
            <X size={17} aria-hidden="true" />
            Clear
          </button>
          <button
            type="button"
            className="icon-only"
            title="Close compare"
            aria-label="Close compare"
            onClick={props.onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {activeLayout === 'stack' ? (
        <StackCompareView
          images={props.images}
          codexRoot={props.codexRoot}
          slider={props.slider}
          stackBasePath={props.stackBasePath}
          stackOverlayPath={props.stackOverlayPath}
          onSliderChange={props.onSliderChange}
          onSetBase={props.onSetStackBase}
          onSwapPair={props.onSwapStackPair}
          onRemove={props.onRemove}
          onFavorite={props.onFavorite}
          onError={props.onError}
        />
      ) : (
        <div
          className={`compare-stage compare-stage-${activeLayout}`}
          data-count={props.images.length}
          style={countStyle}
        >
          {props.images.map((image) => (
            <CompareImagePanel
              key={image.path}
              image={image}
              codexRoot={props.codexRoot}
              onRemove={props.onRemove}
              onFavorite={props.onFavorite}
              onError={props.onError}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CompareImagePanel(props: {
  image: ImageInfo
  codexRoot?: string
  onRemove: (path: string) => void
  onFavorite: (image: ImageInfo) => void
  onError: (message: string) => void
}) {
  return (
    <figure className="compare-panel">
      <CompareOriginalImage
        image={props.image}
        codexRoot={props.codexRoot}
        onError={props.onError}
      />
      <figcaption className="compare-panel-bar">
        <span title={props.image.filename}>{props.image.filename}</span>
        <div>
          <button
            type="button"
            className={`icon-only ${props.image.favorited ? 'favorited' : ''}`}
            title={props.image.favorited ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={props.image.favorited ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => props.onFavorite(props.image)}
          >
            <Star
              size={17}
              fill={props.image.favorited ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="icon-only"
            title="Remove from compare"
            aria-label="Remove from compare"
            onClick={() => props.onRemove(props.image.path)}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </figcaption>
    </figure>
  )
}

function CompareOriginalImage(props: {
  image: ImageInfo
  codexRoot?: string
  className?: string
  onError: (message: string) => void
}) {
  const [loadedSrc, setLoadedSrc] = useState<{ path: string; src: string } | null>(null)
  const imagePath = props.image.path
  const onError = props.onError
  const src = loadedSrc?.path === imagePath ? loadedSrc.src : ''

  useEffect(() => {
    let cancelled = false
    void readImageDataUrl(imagePath, props.codexRoot)
      .then(async (dataUrl) => {
        await decodeImage(dataUrl)
        if (!cancelled && dataUrl) {
          setLoadedSrc({ path: imagePath, src: dataUrl })
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          onError(`Could not load compare image: ${errorMessage(loadError)}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [imagePath, onError, props.codexRoot])

  return (
    <div className={`compare-image-shell ${props.className ?? ''}`}>
      <ThumbnailImage
        key={props.image.thumbnailKey}
        image={props.image}
        alt={props.image.filename}
        className={`compare-image compare-fallback ${src ? 'hidden' : ''}`}
        codexRoot={props.codexRoot}
        eager
      />
      {src ? (
        <img className="compare-image compare-original" src={src} alt={props.image.filename} />
      ) : null}
    </div>
  )
}

function StackCompareView(props: {
  images: ImageInfo[]
  codexRoot?: string
  slider: number
  stackBasePath: string | null
  stackOverlayPath: string | null
  onSliderChange: (value: number) => void
  onSetBase: (path: string) => void
  onSwapPair: (basePath: string, overlayPath: string) => void
  onRemove: (path: string) => void
  onFavorite: (image: ImageInfo) => void
  onError: (message: string) => void
}) {
  const stackPair = stackPairImages(
    props.images,
    props.stackBasePath,
    props.stackOverlayPath,
  )
  const baseImage = stackPair?.baseImage
  const overlayImage = stackPair?.overlayImage
  const stackPairKey = baseImage && overlayImage ? `${baseImage.path}\n${overlayImage.path}` : ''
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [imageBoundsState, setImageBoundsState] = useState<StackImageBoundsState | null>(null)
  const imageBounds =
    imageBoundsState?.pairKey === stackPairKey ? imageBoundsState.bounds : null
  const splitStyle = stackSplitStyle(imageBounds, props.slider)

  useEffect(() => {
    if (!baseImage || !overlayImage) {
      return
    }

    const element = canvasRef.current
    if (!element) {
      return
    }

    let frame = 0
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          setImageBoundsState({
            pairKey: stackPairKey,
            bounds: stackComparisonBounds(rect, baseImage, overlayImage),
          })
        }
      })
    }

    scheduleMeasure()
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(element)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [baseImage, overlayImage, stackPairKey])

  function updateSlider(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!baseImage || !overlayImage) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const bounds = imageBounds ?? stackComparisonBounds(rect, baseImage, overlayImage)
    const next = ((event.clientX - rect.left - bounds.left) / bounds.width) * 100
    props.onSliderChange(Math.max(0, Math.min(100, Math.round(next))))
  }

  if (!baseImage || !overlayImage) {
    return null
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateSlider(event)
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      updateSlider(event)
    }
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="stack-compare-view">
      <div
        ref={canvasRef}
        className="stack-compare-canvas"
        style={splitStyle}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <CompareOriginalImage
          image={baseImage}
          codexRoot={props.codexRoot}
          className="stack-base-image"
          onError={props.onError}
        />
        <div className="stack-overlay-image" aria-hidden="true">
          <CompareOriginalImage
            image={overlayImage}
            codexRoot={props.codexRoot}
            onError={props.onError}
          />
        </div>
        <div className="compare-split-line" aria-hidden="true">
          <span />
        </div>
      </div>
      <div className="stack-reference-strip">
        {props.images.map((image) => {
          const role = stackLayerRole(image, baseImage, overlayImage)
          const active = role === 'base' || role === 'overlay'

          return (
            <div className={`stack-reference-card ${role}-layer`} key={image.path}>
              <div className="stack-reference-thumb">
                <ThumbnailImage image={image} alt="" codexRoot={props.codexRoot} eager />
                <em>{stackLayerLabel(role)}</em>
                <button
                  type="button"
                  className="stack-reference-layer-action"
                  title={active ? 'Swap base and overlay' : 'Set as base image'}
                  aria-label={
                    active ? 'Swap base and overlay' : `Set ${image.filename} as base image`
                  }
                  onClick={() => {
                    if (active) {
                      props.onSwapPair(baseImage.path, overlayImage.path)
                    } else {
                      props.onSetBase(image.path)
                    }
                  }}
                >
                  {active ? (
                    <ArrowLeftRight size={16} aria-hidden="true" />
                  ) : (
                    <ArrowUp size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              <span className="stack-reference-name" title={image.filename}>
                {image.filename}
              </span>
              <button
                type="button"
                className={`icon-only ${image.favorited ? 'favorited' : ''}`}
                title={image.favorited ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={image.favorited ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => props.onFavorite(image)}
              >
                <Star size={16} fill={image.favorited ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                className="icon-only"
                title="Remove from compare"
                aria-label="Remove from compare"
                onClick={() => props.onRemove(image.path)}
              >
                <X size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function stackComparisonBounds(
  rect: DOMRect,
  baseImage: ImageInfo,
  overlayImage: ImageInfo,
): StackImageBounds {
  const baseBounds = containedImageBounds(rect, baseImage)
  const overlayBounds = containedImageBounds(rect, overlayImage)
  const left = Math.min(
    Math.max(baseBounds.left, overlayBounds.left),
    Math.max(0, rect.width - 1),
  )
  const top = Math.min(
    Math.max(baseBounds.top, overlayBounds.top),
    Math.max(0, rect.height - 1),
  )
  const rightEdge = Math.max(
    left + 1,
    Math.min(rect.width - baseBounds.right, rect.width - overlayBounds.right, rect.width),
  )
  const bottomEdge = Math.max(
    top + 1,
    Math.min(rect.height - baseBounds.bottom, rect.height - overlayBounds.bottom, rect.height),
  )
  const width = Math.max(1, Math.min(rect.width - left, rightEdge - left))
  const height = Math.max(1, Math.min(rect.height - top, bottomEdge - top))

  return {
    left,
    top,
    width,
    height,
    right: Math.max(0, rect.width - left - width),
    bottom: Math.max(0, rect.height - top - height),
  }
}

function containedImageBounds(rect: DOMRect, image: ImageInfo): StackImageBounds {
  const fallbackAspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1
  const imageAspect =
    image.width && image.height && image.width > 0 && image.height > 0
      ? image.width / image.height
      : fallbackAspect
  const containerAspect = fallbackAspect

  let width = rect.width
  let height = rect.height
  let left = 0
  let top = 0

  if (imageAspect > containerAspect) {
    height = width / imageAspect
    top = (rect.height - height) / 2
  } else {
    width = height * imageAspect
    left = (rect.width - width) / 2
  }

  left = Math.max(0, left)
  top = Math.max(0, top)
  width = Math.max(1, Math.min(width, rect.width))
  height = Math.max(1, Math.min(height, rect.height))

  return {
    left,
    top,
    width,
    height,
    right: Math.max(0, rect.width - left - width),
    bottom: Math.max(0, rect.height - top - height),
  }
}

function stackSplitStyle(bounds: StackImageBounds | null, slider: number) {
  if (!bounds) {
    return {
      '--split-x': `${slider}%`,
      '--image-top': '0px',
      '--image-right-inset': '0px',
      '--image-bottom-inset': '0px',
    } as React.CSSProperties
  }

  const splitX = bounds.left + (bounds.width * slider) / 100
  return {
    '--split-x': `${splitX}px`,
    '--image-top': `${bounds.top}px`,
    '--image-right-inset': `${bounds.right}px`,
    '--image-bottom-inset': `${bounds.bottom}px`,
  } as React.CSSProperties
}

type StackLayerRole = 'base' | 'overlay' | 'candidate'

function stackPairImages(
  images: ImageInfo[],
  basePath: string | null,
  overlayPath: string | null,
): { baseImage: ImageInfo; overlayImage: ImageInfo } | null {
  const fallbackBaseImage = images[0]
  if (!fallbackBaseImage) {
    return null
  }

  const baseImage = images.find((image) => image.path === basePath) ?? fallbackBaseImage
  const overlayImage =
    images.find((image) => image.path === overlayPath && image.path !== baseImage.path) ??
    images.find((image) => image.path !== baseImage.path)
  if (!overlayImage) {
    return null
  }

  return { baseImage, overlayImage }
}

function stackLayerRole(
  image: ImageInfo,
  baseImage: ImageInfo,
  overlayImage: ImageInfo,
): StackLayerRole {
  if (image.path === baseImage.path) {
    return 'base'
  }
  if (image.path === overlayImage.path) {
    return 'overlay'
  }
  return 'candidate'
}

function stackLayerLabel(role: StackLayerRole) {
  if (role === 'base') {
    return 'Base'
  }
  if (role === 'overlay') {
    return 'Overlay'
  }
  return 'Candidate'
}

function PreviewModal(props: {
  image: ImageInfo
  codexRoot?: string
  index: number
  total: number
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  onFavorite: (image: ImageInfo) => void
  onInfo: (image: ImageInfo) => void
  onTags: (image: ImageInfo) => void
  onReveal: (path: string) => void
  onExport: (path: string) => void
  onError: (message: string) => void
}) {
  const [loadedSrc, setLoadedSrc] = useState<{ path: string; src: string } | null>(null)
  const imagePath = props.image.path
  const onError = props.onError
  const src = loadedSrc?.path === imagePath ? loadedSrc.src : ''

  useEffect(() => {
    let cancelled = false
    void readImageDataUrl(imagePath, props.codexRoot)
      .then(async (dataUrl) => {
        await decodeImage(dataUrl)
        if (!cancelled && dataUrl) {
          setLoadedSrc({ path: imagePath, src: dataUrl })
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          onError(`Could not load original image: ${errorMessage(loadError)}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [imagePath, onError, props.codexRoot])

  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true">
      <div className="preview-toolbar">
        <div>
          <strong>{props.image.filename}</strong>
          <span>
            {props.index + 1} of {props.total}
          </span>
        </div>
        <div className="preview-actions">
          <button
            type="button"
            className="text-button"
            title="Edit tags"
            aria-label="Edit tags"
            onClick={() => props.onTags(props.image)}
          >
            <Tag size={17} aria-hidden="true" />
            Tag
          </button>
          <button
            type="button"
            className="icon-only"
            title="Show image info"
            aria-label="Show image info"
            onClick={() => props.onInfo(props.image)}
          >
            <Info size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-only ${props.image.favorited ? 'favorited' : ''}`}
            title={props.image.favorited ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={props.image.favorited ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => props.onFavorite(props.image)}
          >
            <Star
              size={18}
              fill={props.image.favorited ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="icon-only"
            title="Show in Finder"
            aria-label="Show in Finder"
            onClick={() => props.onReveal(props.image.path)}
          >
            <FolderOpen size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-only"
            title="Export to Downloads"
            aria-label="Export to Downloads"
            onClick={() => props.onExport(props.image.path)}
          >
            <Download size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-only"
            title="Close preview"
            aria-label="Close preview"
            onClick={props.onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="preview-nav previous"
        title="Previous image"
        aria-label="Previous image"
        onClick={props.onPrevious}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
      <div className="preview-stage">
        <ThumbnailImage
          key={props.image.thumbnailKey}
          image={props.image}
          alt={props.image.filename}
          className={`preview-image preview-fallback ${src ? 'hidden' : ''}`}
          codexRoot={props.codexRoot}
          eager
        />
        {src ? (
          <img className="preview-image preview-original" src={src} alt={props.image.filename} />
        ) : null}
      </div>
      <button
        type="button"
        className="preview-nav next"
        title="Next image"
        aria-label="Next image"
        onClick={props.onNext}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
    </div>
  )
}

function InfoDrawer(props: {
  image: ImageInfo
  codexRoot?: string
  session?: SessionInfo
  onClose: () => void
  onCopy: (value: string) => void
  onReveal: (path: string) => void
  onAddTag: (image: ImageInfo, tagName: string) => void
  onRemoveTag: (image: ImageInfo, tagName: string) => void
  tagOperationPending: boolean
  onError: (message: string) => void
}) {
  const [loadedSrc, setLoadedSrc] = useState<{ path: string; src: string } | null>(null)
  const imagePath = props.image.path
  const onError = props.onError
  const src = loadedSrc?.path === imagePath ? loadedSrc.src : ''

  useEffect(() => {
    let cancelled = false
    void readImageDataUrl(imagePath, props.codexRoot)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) {
          setLoadedSrc({ path: imagePath, src: dataUrl })
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          onError(`Could not load image info preview: ${errorMessage(loadError)}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [imagePath, onError, props.codexRoot])

  const rows = [
    ['Filename', props.image.filename],
    ['Format', props.image.format],
    ['Dimensions', formatDimensions(props.image)],
    ['File size', formatBytes(props.image.fileSize)],
    ['Modified', formatDateTime(props.image.modifiedAtMs)],
    ['Session', props.session?.title || props.image.sessionTitle],
    ['Session id', props.image.sessionId],
    ['Project', props.session?.cwd || 'Unknown'],
    ['Path', props.image.path],
  ]

  return (
    <aside className="info-drawer" aria-label="Image metadata">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">Metadata</p>
          <h2>{props.image.filename}</h2>
        </div>
        <button
          type="button"
          className="icon-only"
          title="Close details"
          aria-label="Close details"
          onClick={props.onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {src ? (
        <img className="drawer-preview" src={src} alt="" />
      ) : (
        <ThumbnailImage
          key={props.image.thumbnailKey}
          image={props.image}
          alt=""
          className="drawer-preview"
          codexRoot={props.codexRoot}
          eager
        />
      )}
      <TagEditor
        image={props.image}
        onAddTag={props.onAddTag}
        onRemoveTag={props.onRemoveTag}
        busy={props.tagOperationPending}
      />
      <dl className="metadata-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="drawer-actions">
        <button
          type="button"
          className="text-button"
          title="Copy image path"
          onClick={() => props.onCopy(props.image.path)}
        >
          <Copy size={17} aria-hidden="true" />
          Copy path
        </button>
        <button
          type="button"
          className="text-button"
          title="Show image in Finder"
          onClick={() => props.onReveal(props.image.path)}
        >
          <FolderOpen size={17} aria-hidden="true" />
          Show file
        </button>
      </div>
    </aside>
  )
}

function TagDrawer(props: {
  image: ImageInfo
  codexRoot?: string
  onClose: () => void
  onAddTag: (image: ImageInfo, tagName: string) => void
  onRemoveTag: (image: ImageInfo, tagName: string) => void
  tagOperationPending: boolean
}) {
  return (
    <aside className="info-drawer tag-drawer" aria-label="Edit image tags">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">Tags</p>
          <h2>{props.image.filename}</h2>
        </div>
        <button
          type="button"
          className="icon-only"
          title="Close tags"
          aria-label="Close tags"
          onClick={props.onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ThumbnailImage
        key={props.image.thumbnailKey}
        image={props.image}
        alt=""
        className="drawer-preview"
        codexRoot={props.codexRoot}
        eager
      />
      <TagEditor
        image={props.image}
        onAddTag={props.onAddTag}
        onRemoveTag={props.onRemoveTag}
        busy={props.tagOperationPending}
        autoFocus
      />
    </aside>
  )
}

function TagEditor(props: {
  image: ImageInfo
  autoFocus?: boolean
  busy: boolean
  onAddTag: (image: ImageInfo, tagName: string) => void
  onRemoveTag: (image: ImageInfo, tagName: string) => void
}) {
  const [tagInput, setTagInput] = useState('')

  function submitTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (props.busy) {
      return
    }
    const tagName = tagInput.trim()
    if (!tagName) {
      return
    }
    props.onAddTag(props.image, tagName)
    setTagInput('')
  }

  return (
    <section className="drawer-tags" aria-label="Image tags">
      <div className="drawer-section-title">Tags</div>
      {props.image.tags.length === 0 ? (
        <p className="tag-empty">No tags</p>
      ) : (
        <div className="tag-chip-list">
          {props.image.tags.map((tag) => (
            <span className="tag-chip" key={tag}>
              {tag}
              <button
                type="button"
                title={`Remove ${tag}`}
                aria-label={`Remove ${tag}`}
                disabled={props.busy}
                onClick={() => props.onRemoveTag(props.image, tag)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form className="tag-add-form" onSubmit={submitTag}>
        <input
          value={tagInput}
          maxLength={48}
          placeholder="New tag"
          autoFocus={props.autoFocus}
          disabled={props.busy}
          onChange={(event) => setTagInput(event.target.value)}
        />
        <button type="submit" className="primary-button" title="Add tag" disabled={props.busy}>
          <Plus size={17} aria-hidden="true" />
          Add
        </button>
      </form>
    </section>
  )
}

function NavButton(props: {
  active: boolean
  icon: React.ReactNode
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`nav-button ${props.active ? 'active' : ''}`}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
      <em>{props.count}</em>
    </button>
  )
}

function LoadingState() {
  return (
    <div className="state-block">
      <Loader2 className="spin" size={30} aria-hidden="true" />
      <h2>Scanning Codex images</h2>
      <p>Reading local files and session titles.</p>
    </div>
  )
}

function ErrorState(props: { message: string; onRetry: () => void }) {
  return (
    <div className="state-block">
      <AlertCircle size={30} aria-hidden="true" />
      <h2>Could not scan gallery</h2>
      <p>{props.message}</p>
      <button type="button" className="primary-button" onClick={props.onRetry}>
        Retry
      </button>
    </div>
  )
}

function EmptyState(props: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="state-block">
      {props.icon}
      <h2>{props.title}</h2>
      <p>{props.message}</p>
    </div>
  )
}

function groupImagesByDate(images: ImageInfo[]) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const groups = new Map<string, ImageInfo[]>()
  for (const image of images) {
    const label = image.modifiedAtMs ? formatter.format(new Date(image.modifiedAtMs)) : 'Undated'
    const group = groups.get(label) ?? []
    group.push(image)
    groups.set(label, group)
  }
  return Array.from(groups, ([label, groupedImages]) => ({ label, images: groupedImages }))
}

function groupImagesBySession(images: ImageInfo[]) {
  const groups = new Map<string, ImageInfo[]>()
  for (const image of images) {
    const group = groups.get(image.sessionId) ?? []
    group.push(image)
    groups.set(image.sessionId, group)
  }
  return groups
}

function groupImagesByTag(images: ImageInfo[]) {
  const groups = new Map<string, ImageInfo[]>()
  for (const image of images) {
    for (const tag of image.tags) {
      const group = groups.get(tag) ?? []
      group.push(image)
      groups.set(tag, group)
    }
  }
  return groups
}

function buildStats(gallery: GalleryPayload | null) {
  const images = gallery?.images ?? []
  return {
    total: images.length,
    sessions: gallery?.sessions.length ?? 0,
    favorites: images.filter((image) => image.favorited).length,
    missing: images.filter((image) => image.missingSession).length,
    tags: gallery?.tags.length ?? 0,
  }
}

function pageTitle(view: ViewMode) {
  switch (view) {
    case 'sessions':
      return 'Sessions'
    case 'favorites':
      return 'Favorites'
    case 'missing':
      return 'Missing Sessions'
    case 'tags':
      return 'Tags'
    default:
      return 'Timeline'
  }
}

function viewLabel(view: ViewMode, session?: SessionInfo | null, tag?: TagInfo | null) {
  if (session) {
    return 'Session gallery'
  }
  if (tag) {
    return 'Tagged images'
  }
  if (view === 'timeline') {
    return 'All Codex images'
  }
  if (view === 'tags') {
    return 'Image tags'
  }
  return 'Codex Gallery'
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) {
    return 'Unknown'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDimensions(image: ImageInfo) {
  if (!image.width || !image.height) {
    return 'Unknown'
  }
  return `${image.width} x ${image.height}`
}

function formatDateTime(value: number | null) {
  if (!value) {
    return 'Unknown'
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

async function decodeImage(src: string) {
  if (!src) {
    return
  }
  const image = new Image()
  image.src = src
  if ('decode' in image) {
    await image.decode().catch(() => {})
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default App
