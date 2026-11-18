/**
 * POST /api/submit
 *
 * Body:
 *  - productName: string
 *  - canvasImage: string (data URL of canvas PNG)
 *  - uploadedImages: { name, dataUrl }[] (each is a data URL)
 *  - customer: { name, email, phone, message }
 *
 * Behavior:
 *  1. Upload canvas image to Dropbox -> shareable link
 *  2. Upload each user-uploaded image to Dropbox -> shareable link
 *  3. Send admin email with all details + embedded images
 *  4. Return { success: true }
 */

import { NextResponse } from 'next/server'
import { uploadDataUrl, UploadedFile } from '@/lib/server/dropbox'
import { sendCustomizationEmail } from '@/lib/server/email'

export const runtime = 'nodejs'
export const maxDuration = 60 // Vercel function max

interface SubmitBody {
  productName: string
  canvasImage: string
  uploadedImages: { name: string; dataUrl: string }[]
  customer: { name: string; email: string; phone: string; message: string }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SubmitBody

    // Validate
    if (!body.productName || !body.canvasImage || !body.customer?.name || !body.customer?.email) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 },
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.customer.email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email' },
        { status: 400 },
      )
    }

    // 1. Upload canvas preview
    const designImage = await uploadDataUrl(body.canvasImage, 'design-preview')

    // 2. Upload user-uploaded images
    const uploaded: UploadedFile[] = []
    for (let i = 0; i < (body.uploadedImages || []).length; i++) {
      const img = body.uploadedImages[i]
      try {
        const up = await uploadDataUrl(img.dataUrl, img.name || `image-${i + 1}`)
        uploaded.push(up)
      } catch (err) {
        console.error(`Failed to upload image ${i}:`, err)
      }
    }

    // 3. Send admin email
    await sendCustomizationEmail({
      productName: body.productName,
      customer: body.customer,
      designImage: {
        name: designImage.name,
        shareUrl: designImage.shareUrl,
        size: designImage.size,
      },
      uploadedImages: uploaded.map((u) => ({
        name: u.name,
        shareUrl: u.shareUrl,
        size: u.size,
      })),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Submit error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
