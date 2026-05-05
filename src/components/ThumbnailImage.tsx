import { useEffect, useRef, useState } from 'react'
import { readThumbnailDataUrl } from '../api'
import type { ImageInfo } from '../types'

const transparentPixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

type ThumbnailState =
  | { key: string; status: 'idle' | 'loading' | 'error'; src: '' }
  | { key: string; status: 'loaded'; src: string }

export function ThumbnailImage(props: {
  image: ImageInfo
  alt: string
  className?: string
  eager?: boolean
  onError?: (message: string) => void
}) {
  const { alt, className, eager = false, image, onError } = props
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [shouldLoad, setShouldLoad] = useState(eager)
  const [thumbnail, setThumbnail] = useState<ThumbnailState>({
    key: image.thumbnailKey,
    status: 'idle',
    src: '',
  })

  useEffect(() => {
    if (shouldLoad) {
      return
    }

    const element = imageRef.current
    if (!element || !('IntersectionObserver' in window)) {
      setShouldLoad(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      { rootMargin: '360px' },
    )
    observer.observe(element)

    return () => observer.disconnect()
  }, [shouldLoad, image.path, image.thumbnailKey])

  useEffect(() => {
    if (!shouldLoad) {
      return
    }

    let cancelled = false
    const key = image.thumbnailKey

    void readThumbnailDataUrl(image.path)
      .then((src) => {
        if (!cancelled) {
          setThumbnail({ key, status: 'loaded', src })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setThumbnail({ key, status: 'error', src: '' })
          onError?.(`Could not load thumbnail: ${errorMessage(error)}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [shouldLoad, image.path, image.thumbnailKey, onError])

  const sameKey = thumbnail.key === image.thumbnailKey
  const loaded = sameKey && thumbnail.status === 'loaded'
  const status = loaded
    ? 'loaded'
    : shouldLoad && sameKey && thumbnail.status === 'error'
      ? 'error'
      : shouldLoad
        ? 'loading'
        : 'idle'

  return (
    <img
      ref={imageRef}
      className={className}
      src={loaded ? thumbnail.src : transparentPixel}
      alt={alt}
      data-thumbnail-status={status}
      loading={eager ? 'eager' : 'lazy'}
    />
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
