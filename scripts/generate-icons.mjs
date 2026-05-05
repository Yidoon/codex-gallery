import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDir = join(root, 'src-tauri', 'icons')

const sizes = [
  ['icon.png', 512],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['32x32.png', 32],
]

await mkdir(outputDir, { recursive: true })

for (const [filename, size] of sizes) {
  await writeFile(join(outputDir, filename), makeIcon(size))
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const scale = size / 512
  const corner = 108 * scale
  const padding = 52 * scale
  const gap = 24 * scale
  const frame = 24 * scale
  const radius = 38 * scale
  const cell = (size - padding * 2 - gap) / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const inside = roundedRect(x, y, 0, 0, size, size, corner)
      if (!inside) {
        continue
      }

      const mix = (x + y) / (size * 2)
      const base = lerpColor([18, 113, 101], [35, 151, 138], mix)
      pixels[offset] = base[0]
      pixels[offset + 1] = base[1]
      pixels[offset + 2] = base[2]
      pixels[offset + 3] = 255
    }
  }

  const frames = [
    [padding, padding, cell, cell],
    [padding + cell + gap, padding, cell, cell],
    [padding, padding + cell + gap, cell, cell],
    [padding + cell + gap, padding + cell + gap, cell, cell],
  ]

  for (const [x, y, width, height] of frames) {
    paintFrame(pixels, size, x, y, width, height, radius, frame)
  }

  return encodePng(size, size, pixels)
}

function paintFrame(pixels, size, x, y, width, height, radius, frame) {
  const minX = Math.max(0, Math.floor(x))
  const minY = Math.max(0, Math.floor(y))
  const maxX = Math.min(size, Math.ceil(x + width))
  const maxY = Math.min(size, Math.ceil(y + height))

  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      const outer = roundedRect(px, py, x, y, width, height, radius)
      const inner = roundedRect(
        px,
        py,
        x + frame,
        y + frame,
        width - frame * 2,
        height - frame * 2,
        Math.max(0, radius - frame),
      )

      if (!outer || inner) {
        continue
      }

      const offset = (py * size + px) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = 236
    }
  }
}

function roundedRect(px, py, x, y, width, height, radius) {
  const right = x + width
  const bottom = y + height
  if (px < x || px >= right || py < y || py >= bottom) {
    return false
  }

  const nearestX = clamp(px, x + radius, right - radius)
  const nearestY = clamp(py, y + radius, bottom - radius)
  const dx = px - nearestX
  const dy = py - nearestY
  return dx * dx + dy * dy <= radius * radius
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr(width, height)),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function ihdr(width, height) {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8
  data[9] = 6
  data[10] = 0
  data[11] = 0
  data[12] = 0
  return data
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
