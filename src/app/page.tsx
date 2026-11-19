'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import * as fabric from 'fabric'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Type,
  Image as ImageIcon,
  Copy,
  Trash2,
  RotateCw,
  FlipHorizontal2,
  AlignCenterHorizontal,
  Loader2,
  Check,
  Pencil,
} from 'lucide-react'
import { toast } from 'sonner'

type ElementKind = 'text' | 'image'

type ElementObject = fabric.Object & {
  elementId?: string
  elementType?: ElementKind
  elementLabel?: string
}

interface ElementMeta {
  id: string
  type: ElementKind
  label: string
}

interface TextDraft {
  content: string
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  fill: string
}

const DEFAULT_TEXT_DRAFT: TextDraft = {
  content: 'Your text',
  fontFamily: 'Inter, sans-serif',
  fontSize: 28,
  bold: false,
  italic: false,
  underline: false,
  fill: '#1f2937',
}

const FONT_FAMILIES = [
  { label: 'Inter (default)', value: 'Inter, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
]

const TEXT_COLORS = [
  '#1f2937',
  '#64748b',
  '#e11d48',
  '#ea580c',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#ffffff',
]

let elementCounter = 0

function newId(kind: ElementKind): string {
  elementCounter += 1
  return `${kind}-${Date.now()}-${elementCounter}`
}

function truncate(s: string, max = 24): string {
  const clean = (s || '').replace(/\s+/g, ' ').trim() || 'Untitled text'
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

const PRINTING_MATERIAL = 'Free UV Printing (Coloured)'

function CustomizeApp() {
  const searchParams = useSearchParams()
  const productName = searchParams.get('pname') || 'Custom Product'

  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isApproved, setIsApproved] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [canvasPreview, setCanvasPreview] = useState<string>('')
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  })
  const [selectedObject, setSelectedObject] = useState<fabric.Object | null>(null)
  const [uploadedImages, setUploadedImages] = useState<
    { name: string; dataUrl: string }[]
  >([])

  // Elements added to the canvas (for the right-side list)
  const [elements, setElements] = useState<ElementMeta[]>([])
  const [activeElementId, setActiveElementId] = useState<string | null>(null)

  // Live canvas dimensions — drives the rulers
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [quantity, setQuantity] = useState(1)

  const xTicks: number[] = []
  for (let x = 0; x <= canvasSize.width; x += 50) xTicks.push(x)
  const yTicks: number[] = []
  for (let y = 0; y <= canvasSize.height; y += 50) yTicks.push(y)

  // Text options popup
  const [isTextModalOpen, setIsTextModalOpen] = useState(false)
  const [textDraft, setTextDraft] = useState<TextDraft>(DEFAULT_TEXT_DRAFT)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)

  // Init Fabric canvas + responsive resize
  useEffect(() => {
    if (!canvasElRef.current || !canvasContainerRef.current) return

    const container = canvasContainerRef.current
    const size = () => ({
      width: Math.max(container.clientWidth, 1),
      height: Math.max(container.clientHeight, 1),
    })

    const initial = size()

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: initial.width,
      height: initial.height,
      backgroundColor: 'transparent',
      preserveObjectStacking: true,
    })
    fabricRef.current = canvas

    // Fabric injects its own wrapper div — make it fill the container
    const wrapperEl = canvas.wrapperEl
    if (wrapperEl) {
      wrapperEl.style.position = 'absolute'
      wrapperEl.style.inset = '0'
    }

    canvas.renderAll()

    // Track selection
    const onSelection = (e: fabric.TEvent) => {
      const selected = (e as fabric.TEvent & { selected?: fabric.Object[] }).selected
      const obj = selected?.[0] as ElementObject | undefined
      setSelectedObject(obj || null)
      setActiveElementId(obj?.elementId || null)
    }
    const onCleared = () => {
      setSelectedObject(null)
      setActiveElementId(null)
    }
    canvas.on('selection:created', onSelection as never)
    canvas.on('selection:updated', onSelection as never)
    canvas.on('selection:cleared', onCleared)

    // Keep element list in sync when objects are removed by any means
    const onRemoved = (e: { target?: ElementObject }) => {
      const id = e.target?.elementId
      if (!id) return
      setElements((prev) => prev.filter((el) => el.id !== id))
      setActiveElementId((cur) => (cur === id ? null : cur))
    }
    canvas.on('object:removed', onRemoved)

    // Double-click a text object -> open the edit popup
    const onDblClick = (e: { target?: fabric.Object }) => {
      const target = e.target as ElementObject | undefined
      if (target && target instanceof fabric.IText) {
        const t = target as ElementObject & fabric.IText
        if (!t.elementId) return
        setEditingTextId(t.elementId)
        setTextDraft({
          content: t.text || '',
          fontFamily: t.fontFamily || DEFAULT_TEXT_DRAFT.fontFamily,
          fontSize: Math.round((t.fontSize || DEFAULT_TEXT_DRAFT.fontSize) as number),
          bold: t.fontWeight === 'bold',
          italic: t.fontStyle === 'italic',
          underline: Boolean(t.underline),
          fill: typeof t.fill === 'string' ? t.fill : DEFAULT_TEXT_DRAFT.fill,
        })
        setIsTextModalOpen(true)
      }
    }
    canvas.on('mouse:dblclick', onDblClick as never)

    // Keep the canvas element exactly in sync with its container box.
    // No early-return: the canvas can start at a stale size (measured before
    // flex layout settles), so we always re-assert the real dimensions.
    const syncSize = () => {
      const canvas = fabricRef.current
      if (!canvas) return
      const { width, height } = size()
      canvas.setDimensions({ width, height })
      setCanvasSize({ width, height })
      canvas.calcOffset()
      canvas.renderAll()
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(syncSize)
    })
    observer.observe(container)
    window.addEventListener('resize', syncSize)
    requestAnimationFrame(syncSize)
    // Flex/iframe layout can settle after the first paint — re-assert size.
    const t1 = window.setTimeout(syncSize, 100)
    const t2 = window.setTimeout(syncSize, 400)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      observer.disconnect()
      window.removeEventListener('resize', syncSize)
      canvas.off('selection:created', onSelection)
      canvas.off('selection:updated', onSelection)
      canvas.off('selection:cleared', onCleared)
      canvas.off('object:removed', onRemoved)
      canvas.off('mouse:dblclick', onDblClick)
      canvas.dispose()
      fabricRef.current = null
    }
  }, [])

  // === Iframe auto-resize: send our content height to the parent window ===
  // This lets the Shopify page resize the iframe so there's only ONE scrollbar
  // (the outer Shopify page), not two.
  useEffect(() => {
    if (typeof window === 'undefined') return

    let lastSentHeight = 0
    let isMeasuring = false

    const sendHeight = () => {
      if (isMeasuring) return // prevent re-entrant calls
      isMeasuring = true

      // Temporarily reset the body height so we measure the *natural* content
      // height, not whatever the parent just told the iframe to be.
      const prevBodyHeight = document.body.style.height
      const prevHtmlHeight = document.documentElement.style.height
      document.body.style.height = 'auto'
      document.documentElement.style.height = 'auto'

      const h = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
      )

      // Restore
      document.body.style.height = prevBodyHeight
      document.documentElement.style.height = prevHtmlHeight

      isMeasuring = false

      // Only post if height actually changed by more than 2px (avoids
      // sub-pixel measurement noise creating an infinite loop).
      if (Math.abs(h - lastSentHeight) < 2) return
      lastSentHeight = h

      // Only post if there's a parent (i.e., we're embedded in an iframe)
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'customize-resize', height: h }, '*')
      }
    }

    // Send initial height after a tick (let layout settle)
    const t1 = window.setTimeout(sendHeight, 200)
    const t2 = window.setTimeout(sendHeight, 800)

    // ResizeObserver — re-measure when the DOM changes size
    // Use a debounce so we don't fire on every animation frame.
    let roTimer: number | undefined
    const ro = new ResizeObserver(() => {
      window.clearTimeout(roTimer)
      roTimer = window.setTimeout(sendHeight, 150)
    })
    ro.observe(document.body)

    // Re-measure on window resize (mobile address bar show/hide, orientation)
    let winTimer: number | undefined
    const onWinResize = () => {
      window.clearTimeout(winTimer)
      winTimer = window.setTimeout(sendHeight, 200)
    }
    window.addEventListener('resize', onWinResize)

    // Listen for parent asking us to re-measure
    const onMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'customize-measure') {
        // Reset lastSentHeight so we always send after an explicit request
        lastSentHeight = 0
        sendHeight()
      }
    }
    window.addEventListener('message', onMessage)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(roTimer)
      window.clearTimeout(winTimer)
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
      window.removeEventListener('message', onMessage)
    }
  }, [])

  // === Canvas Actions ===

  const resetCanvas = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.getObjects().forEach((obj) => canvas.remove(obj))
    canvas.discardActiveObject()
    canvas.renderAll()
    setSelectedObject(null)
    setActiveElementId(null)
    setElements([])
    setUploadedImages([])
  }

  const openTextModalForNew = () => {
    setTextDraft(DEFAULT_TEXT_DRAFT)
    setEditingTextId(null)
    setIsTextModalOpen(true)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const findObjectById = (id: string): ElementObject | null => {
    const canvas = fabricRef.current
    if (!canvas) return null
    const found = canvas
      .getObjects()
      .find((o) => (o as ElementObject).elementId === id)
    return (found as ElementObject) || null
  }

  const openTextModalForEdit = (id: string) => {
    const obj = findObjectById(id)
    if (!obj || !(obj instanceof fabric.IText)) return
    const itext = obj as fabric.IText
    setTextDraft({
      content: itext.text || '',
      fontFamily: itext.fontFamily || DEFAULT_TEXT_DRAFT.fontFamily,
      fontSize: Math.round((itext.fontSize || DEFAULT_TEXT_DRAFT.fontSize) as number),
      bold: itext.fontWeight === 'bold',
      italic: itext.fontStyle === 'italic',
      underline: Boolean(itext.underline),
      fill: typeof itext.fill === 'string' ? itext.fill : DEFAULT_TEXT_DRAFT.fill,
    })
    setEditingTextId(id)
    setIsTextModalOpen(true)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const applyTextDraft = () => {
    const canvas = fabricRef.current
    if (!canvas) return

    const content = textDraft.content || 'Your text'

    if (editingTextId) {
      const obj = findObjectById(editingTextId)
      if (obj && obj instanceof fabric.IText) {
        obj.set({
          text: content,
          fontFamily: textDraft.fontFamily,
          fontSize: textDraft.fontSize,
          fontWeight: textDraft.bold ? 'bold' : 'normal',
          fontStyle: textDraft.italic ? 'italic' : 'normal',
          underline: textDraft.underline,
          fill: textDraft.fill,
        })
        obj.set('dirty', true)
        canvas.renderAll()
        setElements((prev) =>
          prev.map((el) =>
            el.id === editingTextId ? { ...el, label: truncate(content) } : el,
          ),
        )
        setSelectedObject(obj)
        canvas.setActiveObject(obj)
        toast.success('Text updated')
      }
    } else {
      const id = newId('text')
      const text = new fabric.IText(content, {
        left: canvas.getWidth() / 2,
        top: canvas.getHeight() / 2,
        fontFamily: textDraft.fontFamily,
        fontSize: textDraft.fontSize,
        fontWeight: textDraft.bold ? 'bold' : 'normal',
        fontStyle: textDraft.italic ? 'italic' : 'normal',
        underline: textDraft.underline,
        fill: textDraft.fill,
        originX: 'center',
        originY: 'center',
      }) as ElementObject

      text.elementId = id
      text.elementType = 'text'
      text.elementLabel = truncate(content)

      canvas.add(text)
      canvas.setActiveObject(text)
      canvas.renderAll()
      setSelectedObject(text)
      setActiveElementId(id)
      setElements((prev) => [...prev, { id, type: 'text', label: truncate(content) }])
      toast.success('Text added')
    }

    setIsTextModalOpen(false)
    setEditingTextId(null)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB')
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (ev) => resolve(ev.target?.result as string)
      reader.onerror = () => reject(new Error('Could not read file'))
      reader.readAsDataURL(file)
    }).catch(() => '')

    if (!dataUrl) {
      toast.error('Could not read that file')
      return
    }

    const canvas = fabricRef.current
    if (!canvas) return

    const maxDim = 200
    const probe = await new Promise<HTMLImageElement>((resolve, reject) => {
      const imgEl = new Image()
      imgEl.onload = () => resolve(imgEl)
      imgEl.onerror = () => reject(new Error('invalid image'))
      imgEl.src = dataUrl
    }).catch(() => null)

    if (!probe) {
      toast.error('Could not load that image')
      return
    }

    const scale =
      probe.width > maxDim || probe.height > maxDim
        ? maxDim / Math.max(probe.width, probe.height)
        : 1

    try {
      const img = await fabric.FabricImage.fromURL(dataUrl)
      const id = newId('image')
      img.set({
        left: canvas.getWidth() / 2,
        top: canvas.getHeight() / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
      })

      const tagged = img as unknown as ElementObject
      tagged.elementId = id
      tagged.elementType = 'image'
      tagged.elementLabel = file.name

      canvas.add(tagged)
      canvas.setActiveObject(tagged)
      canvas.renderAll()
      setSelectedObject(tagged)
      setActiveElementId(id)
      setUploadedImages((prev) => [...prev, { name: file.name, dataUrl }])
      setElements((prev) => [
        ...prev,
        { id, type: 'image', label: truncate(file.name) },
      ])
      toast.success('Image added')
    } catch {
      toast.error('Could not add that image')
    } finally {
      e.target.value = ''
    }
  }

  const deleteSelected = () => {
    if (!fabricRef.current || !selectedObject) return
    fabricRef.current.remove(selectedObject)
    fabricRef.current.discardActiveObject()
    fabricRef.current.renderAll()
    setSelectedObject(null)
    setActiveElementId(null)
    setElements((prev) =>
      prev.filter((el) => el.id !== (selectedObject as ElementObject).elementId),
    )
    toast.success('Deleted')
  }

  const deleteElement = (id: string) => {
    const canvas = fabricRef.current
    if (!canvas) return
    const obj = findObjectById(id)
    if (!obj) return
    canvas.remove(obj)
    canvas.discardActiveObject()
    canvas.renderAll()
    setElements((prev) => prev.filter((el) => el.id !== id))
    setActiveElementId((cur) => (cur === id ? null : cur))
    if (selectedObject === obj) setSelectedObject(null)
    toast.success('Deleted')
  }

  const selectElement = (id: string) => {
    const canvas = fabricRef.current
    const obj = findObjectById(id)
    if (!canvas || !obj) return
    canvas.setActiveObject(obj)
    canvas.renderAll()
    setSelectedObject(obj)
    setActiveElementId(id)
  }

  const duplicateSelected = () => {
    if (!fabricRef.current || !selectedObject) return
    selectedObject.clone().then((cloned: fabric.Object) => {
      cloned.set({ left: (selectedObject.left || 0) + 20, top: (selectedObject.top || 0) + 20 })
      const id = newId((selectedObject as ElementObject).elementType || 'text')
      const tagged = cloned as ElementObject
      tagged.elementId = id
      tagged.elementType = (selectedObject as ElementObject).elementType || 'text'
      tagged.elementLabel = (selectedObject as ElementObject).elementLabel

      fabricRef.current!.add(tagged)
      fabricRef.current!.setActiveObject(tagged)
      fabricRef.current!.renderAll()
      setSelectedObject(tagged)
      setActiveElementId(id)
      setElements((prev) => [
        ...prev,
        {
          id,
          type: tagged.elementType!,
          label: tagged.elementLabel || 'Copy',
        },
      ])
      toast.success('Duplicated')
    })
  }

  const rotateSelected = () => {
    if (!fabricRef.current || !selectedObject) return
    selectedObject.rotate(((selectedObject.angle || 0) + 15) % 360)
    fabricRef.current.renderAll()
  }

  const flipSelected = () => {
    if (!fabricRef.current || !selectedObject) return
    selectedObject.set('flipX', !selectedObject.flipX)
    fabricRef.current.renderAll()
  }

  const centerSelected = () => {
    if (!fabricRef.current || !selectedObject) return
    const canvas = fabricRef.current
    selectedObject.set({
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      originX: 'center',
      originY: 'center',
    })
    selectedObject.setCoords()
    canvas.renderAll()
  }

  // === Save & Continue ===

  const exportDesign = () => {
    const canvas = fabricRef.current
    if (!canvas) return

    // The printable area is now a CSS div (not a Fabric object), so there's
    // nothing on the canvas to hide/restore — just clear the active selection
    // (so the selection handles don't appear in the exported PNG), export,
    // then restore the selection.
    const previousActive = canvas.getActiveObject()
    canvas.discardActiveObject()
    canvas.renderAll()

    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 })

    if (previousActive) canvas.setActiveObject(previousActive)
    canvas.renderAll()

    setCanvasPreview(dataUrl)
    setPreviewSize({ width: canvas.getWidth(), height: canvas.getHeight() })
  }

  const handleSaveAndContinue = async () => {
    if (!fabricRef.current) return
    if (!isApproved) {
      toast.error('Please review and approve the design first')
      return
    }
    exportDesign()
    setIsModalOpen(true)
    // Scroll to top so the absolute-positioned modal is visible
    // (modal uses position: absolute; top: 16px relative to body)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // === Submit form ===

  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })

  const handleSubmit = async () => {
    if (!form.name || !form.email) {
      toast.error('Name and email are required')
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email)) {
      toast.error('Please enter a valid email')
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          canvasImage: canvasPreview,
          uploadedImages,
          customer: form,
        }),
      })
      if (!res.ok) throw new Error('Submit failed')
      const data = await res.json()
      if (data.success) {
        setIsSubmitted(true)
        toast.success('Customization submitted!')
      } else {
        throw new Error(data.error || 'Submit failed')
      }
    } catch (err) {
      toast.error('Failed to submit. Please try again.')
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  // === Render ===

  // Trophy Mart design tokens (kept inline so this page is self-contained)
  const TM_NAVY = '#1B2A4A'
  const TM_NAVY_INK = '#0F1A30'
  const TM_RED = '#C8102E'
  const TM_RED_DARK = '#A50E26'
  const TM_GOLD = '#C9A227'
  const TM_IVORY = '#F7F4EC'
  const TM_CREAM = '#FAF7EF'
  const TM_BORDER = '#E2E2E2'
  const TM_BODY = '#5A5F6B'
  const FONT_SERIF = 'var(--font-cormorant), Georgia, serif'
  const FONT_SANS = 'var(--font-manrope), Inter, sans-serif'

  const eyebrowClass =
    'text-[11px] font-medium uppercase tracking-[0.18em]'

  return (
    <div
      className="flex flex-col"
      style={{
        background: '#FFFFFF',
        fontFamily: FONT_SANS,
        color: TM_NAVY_INK,
      }}
    >
      {/* Top bar */}
      <header
        className="border-b"
        style={{
          background: '#FFFFFF',
          borderColor: TM_BORDER,
        }}
      >
        {/* Breadcrumb strip */}
        <div
          className="border-t"
          style={{ borderColor: TM_BORDER, background: TM_IVORY }}
        >
          <div className="mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8 py-2">
            <div
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]"
              style={{ color: TM_BODY }}
            >
              <span>Home</span>
              <span style={{ color: TM_GOLD }}>/</span>
              <span>Trophies</span>
              <span style={{ color: TM_GOLD }}>/</span>
              <span
                className="truncate max-w-[40vw]"
                style={{ color: TM_NAVY, fontWeight: 600 }}
              >
                {productName}
              </span>
              <span style={{ color: TM_GOLD }}>/</span>
              <span style={{ color: TM_RED, fontWeight: 600 }}>Customize</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <main className="mx-auto w-full max-w-[1300px] flex-1 flex flex-col gap-8 p-4 sm:p-6 lg:p-8 pb-8">
        {/* Top row: canvas + right panel, side-by-side on desktop */}
        <div className="flex flex-col lg:flex-row gap-8">
        {/* Canvas area */}
        <section className="flex-1 flex flex-col min-h-0">
          {/* Eyebrow + product title (serif) */}
          <div className="mb-5">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-10 h-px"
                style={{ background: TM_GOLD }}
                aria-hidden
              />
              <span
                className={eyebrowClass}
                style={{ color: TM_RED }}
              >
                Trophy Mart Exclusive
              </span>
            </div>
            <h1
              className="mt-2 text-3xl sm:text-4xl leading-tight"
              style={{
                fontFamily: FONT_SERIF,
                color: TM_NAVY,
                fontWeight: 500,
              }}
            >
              {productName}
            </h1>
          </div>

          <div className="flex-1 min-h-0 flex items-stretch gap-2">
            {/* Vertical ruler (desktop only) */}
            <div className="hidden md:block w-7 shrink-0 select-none">
              <div className="h-6" />
              <div className="relative" style={{ height: canvasSize.height }}>
                {yTicks.map((y) => (
                  <div key={y} className="absolute right-0 w-2 border-t" style={{ top: y, borderColor: '#CBD5E1' }} />
                ))}
                {yTicks.map((y) => (
                  <span
                    key={`yl-${y}`}
                    className="absolute right-2 -translate-y-1/2 text-[9px] leading-none"
                    style={{ top: y, color: '#9AA0A6', fontFamily: FONT_SANS }}
                  >
                    {y}
                  </span>
                ))}
              </div>
            </div>

            {/* Canvas container */}
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Horizontal ruler (desktop only) */}
              <div
                className="hidden md:block relative h-5 mb-1 select-none border-b"
                style={{ width: canvasSize.width, borderColor: TM_BORDER }}
              >
                {xTicks.map((x) => (
                  <div key={x} className="absolute top-2 h-3 border-l" style={{ left: x, borderColor: '#CBD5E1' }} />
                ))}
                {xTicks.map((x) => (
                  <span
                    key={`xl-${x}`}
                    className="absolute top-0 text-[9px] leading-none"
                    style={{ left: x + 2, color: '#9AA0A6', fontFamily: FONT_SANS }}
                  >
                    {x}
                  </span>
                ))}
              </div>

              {/* Fabric canvas wrapper */}
              <div
                ref={canvasContainerRef}
                className="relative flex-1 min-h-[280px] sm:min-h-[440px] border overflow-hidden"
                style={{
                  borderColor: TM_BORDER,
                  backgroundColor: '#F4F4F4',
                  backgroundImage:
                    'linear-gradient(45deg, #ECECEC 25%, transparent 25%), linear-gradient(-45deg, #ECECEC 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ECECEC 75%), linear-gradient(-45deg, transparent 75%, #ECECEC 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                }}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-[15%] w-[70%] border-x bg-white md:left-[32%] md:w-[36%]"
                  style={{ borderColor: TM_BORDER }}
                />
                <canvas ref={canvasElRef} className="block" />
              </div>

              {/* Canvas toolbar */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openTextModalForNew}
                  className="inline-flex items-center gap-1.5 px-4 py-2 border-[1.5px] text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-slate-50"
                  style={{
                    borderColor: TM_NAVY,
                    color: TM_NAVY,
                    fontFamily: FONT_SANS,
                    borderRadius: '2px',
                  }}
                >
                  <Type className="h-4 w-4" /> Add Text
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 border-[1.5px] text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-slate-50"
                  style={{
                    borderColor: TM_NAVY,
                    color: TM_NAVY,
                    fontFamily: FONT_SANS,
                    borderRadius: '2px',
                  }}
                >
                  <ImageIcon className="h-4 w-4" /> Add Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="w-px h-6 mx-1 hidden sm:block" style={{ background: TM_BORDER }} />
                <button
                  type="button"
                  onClick={duplicateSelected}
                  disabled={!selectedObject}
                  title="Duplicate"
                  className="inline-flex items-center justify-center h-9 w-9 border border-transparent disabled:opacity-40 hover:bg-slate-100"
                  style={{ color: TM_NAVY, borderRadius: '2px' }}
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={rotateSelected}
                  disabled={!selectedObject}
                  title="Rotate 15°"
                  className="inline-flex items-center justify-center h-9 w-9 border border-transparent disabled:opacity-40 hover:bg-slate-100"
                  style={{ color: TM_NAVY, borderRadius: '2px' }}
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={flipSelected}
                  disabled={!selectedObject}
                  title="Flip horizontal"
                  className="inline-flex items-center justify-center h-9 w-9 border border-transparent disabled:opacity-40 hover:bg-slate-100"
                  style={{ color: TM_NAVY, borderRadius: '2px' }}
                >
                  <FlipHorizontal2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={centerSelected}
                  disabled={!selectedObject}
                  title="Center"
                  className="inline-flex items-center justify-center h-9 w-9 border border-transparent disabled:opacity-40 hover:bg-slate-100"
                  style={{ color: TM_NAVY, borderRadius: '2px' }}
                >
                  <AlignCenterHorizontal className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={!selectedObject}
                  title="Delete"
                  className="inline-flex items-center justify-center h-9 w-9 border border-transparent disabled:opacity-40 hover:bg-red-50"
                  style={{ color: TM_RED, borderRadius: '2px' }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <p
                className="mt-3 italic text-[12px]"
                style={{ color: TM_BODY, fontFamily: FONT_SANS }}
              >
                Note: The display is an approximate preview.
              </p>
            </div>
          </div>

          {/* Approval + Save bar moved out of <section> below, so it can be reordered on mobile */}

        </section>

        {/* Right panel (desktop) */}
        <aside
          className="w-full lg:w-80 border p-6 flex flex-col gap-5"
          style={{
            borderColor: TM_BORDER,
            background: '#FFFFFF',
          }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="inline-block w-6 h-px"
                style={{ background: TM_GOLD }}
                aria-hidden
              />
              <span className={eyebrowClass} style={{ color: TM_GOLD }}>
                Product
              </span>
            </div>
            <p
              className="text-base leading-snug"
              style={{
                fontFamily: FONT_SERIF,
                color: TM_NAVY,
                fontWeight: 500,
              }}
            >
              {productName}
            </p>
          </div>

          <div className="h-px" style={{ background: TM_BORDER }} />

          <div>
            <label
              htmlFor="material"
              className={eyebrowClass}
              style={{ color: TM_BODY }}
            >
              Select Printing Material
            </label>
            <div
              className="mt-2 px-3 py-2.5 border text-[13px]"
              style={{
                borderColor: TM_BORDER,
                background: TM_CREAM,
                color: TM_NAVY_INK,
                fontFamily: FONT_SANS,
              }}
            >
              {PRINTING_MATERIAL}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="qty"
                className={eyebrowClass}
                style={{ color: TM_BODY }}
              >
                Quantity
              </label>
              <input
                id="qty"
                type="number"
                value={quantity}
                min={1}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                className="mt-2 w-full px-3 py-2 border text-[14px] focus:outline-none"
                style={{
                  borderColor: TM_BORDER,
                  background: '#FFFFFF',
                  color: TM_NAVY,
                  fontFamily: FONT_SANS,
                }}
              />
            </div>
            <div>
              <label
                htmlFor="ptype"
                className={eyebrowClass}
                style={{ color: TM_BODY }}
              >
                Personalization
              </label>
              <div
                className="mt-2 px-3 py-2 border text-[12px]"
                style={{
                  borderColor: TM_BORDER,
                  background: TM_CREAM,
                  color: TM_NAVY_INK,
                  fontFamily: FONT_SANS,
                }}
              >
                All items same
              </div>
            </div>
          </div>
          <p className="text-[11px] -mt-1" style={{ color: TM_BODY, fontFamily: FONT_SANS }}>
            All items will be personalized with the same design.
          </p>

          <div className="h-px" style={{ background: TM_BORDER }} />

          <div>
            <label className={eyebrowClass} style={{ color: TM_BODY }}>
              Add elements
            </label>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                type="button"
                onClick={openTextModalForNew}
                className="h-16 flex flex-col items-center justify-center gap-1.5 border-[1.5px] transition-colors hover:bg-slate-50"
                style={{
                  borderColor: TM_NAVY,
                  color: TM_NAVY,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
              >
                <Type className="h-5 w-5" />
                <span className="text-[11px] uppercase tracking-[0.1em]">Text</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-16 flex flex-col items-center justify-center gap-1.5 border-[1.5px] transition-colors hover:bg-slate-50"
                style={{
                  borderColor: TM_NAVY,
                  color: TM_NAVY,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
              >
                <ImageIcon className="h-5 w-5" />
                <span className="text-[11px] uppercase tracking-[0.1em]">Image</span>
              </button>
            </div>
          </div>

          <div className="h-px" style={{ background: TM_BORDER }} />

          <div>
            <div className="flex items-center justify-between">
              <label className={eyebrowClass} style={{ color: TM_BODY }}>
                Added elements ({elements.length})
              </label>
              {elements.length > 0 && (
                <span className="text-[10px]" style={{ color: TM_BODY }}>
                  click to select
                </span>
              )}
            </div>

            {elements.length === 0 ? (
              <p className="text-[12px] mt-2 italic" style={{ color: TM_BODY, fontFamily: FONT_SANS }}>
                No elements yet. Add text or an image to get started.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {elements.map((el) => (
                  <li
                    key={el.id}
                    className="flex items-center gap-2 border px-2.5 py-2 transition-colors"
                    style={{
                      borderColor: activeElementId === el.id ? TM_RED : TM_BORDER,
                      background: activeElementId === el.id ? '#FBE9EC' : '#FFFFFF',
                      borderRadius: '2px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => selectElement(el.id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      title={el.label}
                    >
                      <span className="shrink-0" style={{ color: TM_BODY }}>
                        {el.type === 'text' ? (
                          <Type className="h-3.5 w-3.5" />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="text-[12px] truncate" style={{ color: TM_NAVY_INK, fontFamily: FONT_SANS }}>
                        {el.label}
                      </span>
                    </button>

                    {el.type === 'text' && (
                      <button
                        type="button"
                        onClick={() => openTextModalForEdit(el.id)}
                        title="Edit text"
                        className="shrink-0 p-1 hover:bg-slate-100"
                        style={{ color: TM_BODY }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteElement(el.id)}
                      title="Remove"
                      className="shrink-0 p-1 hover:bg-red-50"
                      style={{ color: TM_BODY }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-[11px] mt-auto pt-2" style={{ color: TM_BODY, fontFamily: FONT_SANS }}>
            Tip: double-click text on the canvas to edit it. Drag, resize, and rotate elements directly.
          </div>
        </aside>
        </div>{/* end top row */}

        {/* Approval + Save bar — full width, below both columns on desktop, at bottom on mobile */}
        <div
          className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border"
          style={{
            borderColor: TM_BORDER,
            background: '#FFFFFF',
          }}
        >
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="approve"
              checked={isApproved}
              onCheckedChange={(v) => setIsApproved(v === true)}
              className="rounded-none border-[1.5px]"
              style={{ borderColor: TM_NAVY }}
            />
            <label
              htmlFor="approve"
              className="text-[13px] cursor-pointer"
              style={{ color: TM_NAVY_INK, fontFamily: FONT_SANS }}
            >
              I have reviewed the design and approve it.
            </label>
          </div>
          <button
            type="button"
            onClick={handleSaveAndContinue}
            disabled={!isApproved}
            className="px-6 py-3 text-white text-[12px] font-semibold uppercase tracking-[0.15em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-full sm:w-auto"
            style={{
              background: isApproved ? TM_RED : '#9CA3AF',
              fontFamily: FONT_SANS,
              borderRadius: '2px',
            }}
          >
            Save and continue
          </button>
        </div>
      </main>

      {/* Summary Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent
          className="!max-w-5xl w-[95vw]"
          style={{
            borderRadius: '4px',
            fontFamily: FONT_SANS,
          }}
        >
          {!isSubmitted ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="inline-block w-8 h-px"
                    style={{ background: TM_GOLD }}
                    aria-hidden
                  />
                  <span className={eyebrowClass} style={{ color: TM_RED }}>
                    Trophy Mart Exclusive
                  </span>
                </div>
                <DialogTitle
                  className="text-2xl sm:text-3xl"
                  style={{
                    fontFamily: FONT_SERIF,
                    color: TM_NAVY,
                    fontWeight: 500,
                  }}
                >
                  Confirm your customization
                </DialogTitle>
                <DialogDescription
                  className="mt-2 text-[13px]"
                  style={{ color: TM_BODY, fontFamily: FONT_SANS }}
                >
                  Review your design and fill in your details. The admin will be
                  notified by email.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-6 py-4 md:grid-cols-2">
                {/* Left — order details + design preview */}
                <div className="space-y-5">
                  <div>
                    <label className={eyebrowClass} style={{ color: TM_BODY }}>
                      Product
                    </label>
                    <p
                      className="text-base mt-1.5"
                      style={{ fontFamily: FONT_SERIF, color: TM_NAVY, fontWeight: 500 }}
                    >
                      {productName}
                    </p>
                  </div>

                  <div>
                    <label className={eyebrowClass} style={{ color: TM_BODY }}>
                      Printing material
                    </label>
                    <p className="text-[13px] mt-1.5" style={{ color: TM_NAVY_INK }}>
                      {PRINTING_MATERIAL}
                    </p>
                  </div>

                  <div>
                    <label className={eyebrowClass} style={{ color: TM_BODY }}>
                      Quantity
                    </label>
                    <p className="text-[13px] mt-1.5" style={{ color: TM_NAVY_INK }}>
                      {quantity}
                    </p>
                  </div>

                  <div>
                    <label className={eyebrowClass} style={{ color: TM_BODY }}>
                      Design preview
                    </label>
                    <div
                      className="mt-2 border bg-white overflow-hidden"
                      style={{ borderColor: TM_BORDER, borderRadius: '2px' }}
                    >
                      <img
                        src={canvasPreview}
                        alt="Design preview"
                        className="block w-full h-auto"
                      />
                    </div>
                  </div>
                </div>

                {/* Right — customer details */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="c-name"
                        className={eyebrowClass}
                        style={{ color: TM_BODY }}
                      >
                        Name <span style={{ color: TM_RED }}>*</span>
                      </label>
                      <input
                        id="c-name"
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        placeholder="Your full name"
                        className="mt-2 w-full px-3 py-2 border text-[14px] focus:outline-none focus:border-[#1B2A4A]"
                        style={{
                          borderColor: TM_BORDER,
                          color: TM_NAVY_INK,
                          fontFamily: FONT_SANS,
                          borderRadius: '2px',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="c-email"
                        className={eyebrowClass}
                        style={{ color: TM_BODY }}
                      >
                        Email <span style={{ color: TM_RED }}>*</span>
                      </label>
                      <input
                        id="c-email"
                        type="email"
                        value={form.email}
                        onChange={(e) =>
                          setForm({ ...form, email: e.target.value })
                        }
                        placeholder="you@example.com"
                        className="mt-2 w-full px-3 py-2 border text-[14px] focus:outline-none focus:border-[#1B2A4A]"
                        style={{
                          borderColor: TM_BORDER,
                          color: TM_NAVY_INK,
                          fontFamily: FONT_SANS,
                          borderRadius: '2px',
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="c-phone"
                      className={eyebrowClass}
                      style={{ color: TM_BODY }}
                    >
                      Phone
                    </label>
                    <input
                      id="c-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) =>
                        setForm({ ...form, phone: e.target.value })
                      }
                      placeholder="+91 98765 43210"
                      className="mt-2 w-full px-3 py-2 border text-[14px] focus:outline-none focus:border-[#1B2A4A]"
                      style={{
                        borderColor: TM_BORDER,
                        color: TM_NAVY_INK,
                        fontFamily: FONT_SANS,
                        borderRadius: '2px',
                      }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="c-msg"
                      className={eyebrowClass}
                      style={{ color: TM_BODY }}
                    >
                      Message
                    </label>
                    <textarea
                      id="c-msg"
                      value={form.message}
                      onChange={(e) =>
                        setForm({ ...form, message: e.target.value })
                      }
                      placeholder="Any additional notes for the admin..."
                      rows={3}
                      className="mt-2 w-full px-3 py-2 border text-[14px] focus:outline-none focus:border-[#1B2A4A] resize-none"
                      style={{
                        borderColor: TM_BORDER,
                        color: TM_NAVY_INK,
                        fontFamily: FONT_SANS,
                        borderRadius: '2px',
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t" style={{ borderColor: TM_BORDER }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-5 py-2.5 border-[1.5px] text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:bg-slate-50 disabled:opacity-40"
                  style={{
                    borderColor: TM_NAVY,
                    color: TM_NAVY,
                    fontFamily: FONT_SANS,
                    borderRadius: '2px',
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="px-6 py-2.5 text-white text-[12px] font-semibold uppercase tracking-[0.12em] inline-flex items-center disabled:opacity-50"
                  style={{
                    background: TM_RED,
                    fontFamily: FONT_SANS,
                    borderRadius: '2px',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit'
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="py-12 text-center">
              <div
                className="mx-auto w-14 h-14 flex items-center justify-center mb-4"
                style={{ background: TM_CREAM, borderRadius: '50%' }}
              >
                <Check className="h-7 w-7" style={{ color: TM_RED }} />
              </div>
              <DialogTitle
                className="text-2xl"
                style={{ fontFamily: FONT_SERIF, color: TM_NAVY, fontWeight: 500 }}
              >
                Customization submitted!
              </DialogTitle>
              <DialogDescription
                className="mt-2 text-[13px]"
                style={{ color: TM_BODY, fontFamily: FONT_SANS }}
              >
                Thank you, {form.name}. Our team has received your design and
                will contact you at <strong style={{ color: TM_NAVY }}>{form.email}</strong> shortly.
              </DialogDescription>
              <button
                type="button"
                className="mt-6 px-6 py-2.5 border-[1.5px] text-[12px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  borderColor: TM_NAVY,
                  color: TM_NAVY,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
                onClick={() => {
                  setIsModalOpen(false)
                  setIsSubmitted(false)
                  setForm({ name: '', email: '', phone: '', message: '' })
                  setIsApproved(false)
                  setUploadedImages([])
                  setElements([])
                  setActiveElementId(null)
                  resetCanvas()
                }}
              >
                Close
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Text options popup */}
      <Dialog
        open={isTextModalOpen}
        onOpenChange={(open) => {
          setIsTextModalOpen(open)
          if (!open) setEditingTextId(null)
        }}
      >
        <DialogContent
          className="max-w-md"
          style={{ borderRadius: '4px', fontFamily: FONT_SANS }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-block w-8 h-px"
                style={{ background: TM_GOLD }}
                aria-hidden
              />
              <span className={eyebrowClass} style={{ color: TM_RED }}>
                {editingTextId ? 'Edit element' : 'New element'}
              </span>
            </div>
            <DialogTitle
              className="text-2xl"
              style={{ fontFamily: FONT_SERIF, color: TM_NAVY, fontWeight: 500 }}
            >
              {editingTextId ? 'Edit text' : 'Add text'}
            </DialogTitle>
            <DialogDescription
              className="mt-1 text-[13px]"
              style={{ color: TM_BODY, fontFamily: FONT_SANS }}
            >
              Choose a font, size, style and color, then confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div>
              <label
                htmlFor="t-content"
                className={eyebrowClass}
                style={{ color: TM_BODY }}
              >
                Text content
              </label>
              <textarea
                id="t-content"
                value={textDraft.content}
                onChange={(e) =>
                  setTextDraft({ ...textDraft, content: e.target.value })
                }
                placeholder="Enter your text"
                rows={2}
                className="mt-2 w-full px-3 py-2 border text-[14px] focus:outline-none focus:border-[#1B2A4A] resize-none"
                style={{
                  borderColor: TM_BORDER,
                  color: TM_NAVY_INK,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="t-font"
                className={eyebrowClass}
                style={{ color: TM_BODY }}
              >
                Font family
              </label>
              <select
                id="t-font"
                value={textDraft.fontFamily}
                onChange={(e) =>
                  setTextDraft({ ...textDraft, fontFamily: e.target.value })
                }
                className="mt-2 h-9 w-full border px-3 py-1 text-[13px] focus:outline-none focus:border-[#1B2A4A]"
                style={{
                  borderColor: TM_BORDER,
                  background: '#FFFFFF',
                  color: TM_NAVY_INK,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="t-size"
                  className={eyebrowClass}
                  style={{ color: TM_BODY }}
                >
                  Font size ({textDraft.fontSize}px)
                </label>
                <input
                  id="t-size"
                  type="range"
                  min={10}
                  max={96}
                  step={1}
                  value={textDraft.fontSize}
                  onChange={(e) =>
                    setTextDraft({ ...textDraft, fontSize: Number(e.target.value) })
                  }
                  className="mt-3 w-full"
                  style={{ accentColor: TM_RED }}
                />
              </div>
              <div>
                <label className={eyebrowClass} style={{ color: TM_BODY }}>
                  Style
                </label>
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setTextDraft({ ...textDraft, bold: !textDraft.bold })}
                    className="h-9 w-9 border text-sm font-bold transition-colors"
                    style={{
                      borderColor: textDraft.bold ? TM_RED : TM_BORDER,
                      background: textDraft.bold ? '#FBE9EC' : '#FFFFFF',
                      color: textDraft.bold ? TM_RED : TM_NAVY_INK,
                      borderRadius: '2px',
                      fontFamily: FONT_SANS,
                    }}
                    title="Bold"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextDraft({ ...textDraft, italic: !textDraft.italic })}
                    className="h-9 w-9 border text-sm italic transition-colors"
                    style={{
                      borderColor: textDraft.italic ? TM_RED : TM_BORDER,
                      background: textDraft.italic ? '#FBE9EC' : '#FFFFFF',
                      color: textDraft.italic ? TM_RED : TM_NAVY_INK,
                      borderRadius: '2px',
                      fontFamily: FONT_SERIF,
                    }}
                    title="Italic"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setTextDraft({ ...textDraft, underline: !textDraft.underline })
                    }
                    className="h-9 w-9 border text-sm underline transition-colors"
                    style={{
                      borderColor: textDraft.underline ? TM_RED : TM_BORDER,
                      background: textDraft.underline ? '#FBE9EC' : '#FFFFFF',
                      color: textDraft.underline ? TM_RED : TM_NAVY_INK,
                      borderRadius: '2px',
                      fontFamily: FONT_SANS,
                    }}
                    title="Underline"
                  >
                    U
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className={eyebrowClass} style={{ color: TM_BODY }}>
                Color
              </label>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTextDraft({ ...textDraft, fill: c })}
                    className="h-7 w-7 border-2 transition-colors"
                    style={{
                      backgroundColor: c,
                      borderColor:
                        textDraft.fill.toLowerCase() === c.toLowerCase()
                          ? TM_RED
                          : TM_BORDER,
                      borderRadius: '50%',
                    }}
                    title={c}
                  />
                ))}
                <label
                  className="h-7 w-7 border-2 border-dashed cursor-pointer overflow-hidden"
                  style={{ borderColor: TM_BORDER, borderRadius: '50%' }}
                  title="Custom color"
                >
                  <input
                    type="color"
                    value={textDraft.fill}
                    onChange={(e) => setTextDraft({ ...textDraft, fill: e.target.value })}
                    className="h-full w-full cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            <div
              className="border p-3"
              style={{
                borderColor: TM_BORDER,
                background: TM_CREAM,
                borderRadius: '2px',
              }}
            >
              <p
                className="text-[10px] uppercase tracking-[0.15em] mb-1"
                style={{ color: TM_BODY, fontFamily: FONT_SANS }}
              >
                Preview
              </p>
              <p
                className="break-words"
                style={{
                  fontFamily: textDraft.fontFamily,
                  fontSize: `${Math.min(textDraft.fontSize, 32)}px`,
                  fontWeight: textDraft.bold ? 'bold' : 'normal',
                  fontStyle: textDraft.italic ? 'italic' : 'normal',
                  textDecoration: textDraft.underline ? 'underline' : 'none',
                  color: textDraft.fill,
                }}
              >
                {textDraft.content || 'Your text'}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsTextModalOpen(false)
                  setEditingTextId(null)
                }}
                className="px-5 py-2.5 border-[1.5px] text-[12px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  borderColor: TM_NAVY,
                  color: TM_NAVY,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyTextDraft}
                className="px-6 py-2.5 text-white text-[12px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  background: TM_RED,
                  fontFamily: FONT_SANS,
                  borderRadius: '2px',
                }}
              >
                {editingTextId ? 'Update' : 'Add text'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <CustomizeApp />
    </Suspense>
  )
}
