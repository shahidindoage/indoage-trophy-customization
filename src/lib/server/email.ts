/**
 * Email sending helper using Nodemailer + Gmail SMTP.
 *
 * Env vars:
 *  - GMAIL_USER        e.g. "you@gmail.com"
 *  - GMAIL_APP_PASSWORD  16-char App Password (NOT your Gmail password)
 *  - ADMIN_EMAIL       recipient for customization requests (defaults to GMAIL_USER)
 */

import nodemailer from 'nodemailer'

export interface CustomizationEmailData {
  productName: string
  customer: {
    name: string
    email: string
    phone: string
    message: string
  }
  designImage: UploadedFileMeta
  uploadedImages: UploadedFileMeta[]
}

export interface UploadedFileMeta {
  name: string
  shareUrl: string
  size: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function buildHtml(data: CustomizationEmailData): string {
  const submittedAt = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const uploadedRows =
    data.uploadedImages.length === 0
      ? '<p style="color:#64748b;font-size:13px;">No additional images uploaded.</p>'
      : data.uploadedImages
          .map(
            (img, i) => `
              <div style="margin-bottom:14px;">
                <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Image ${i + 1}: ${escapeHtml(img.name)} (${formatBytes(img.size)})</p>
                <img src="${img.shareUrl}" alt="${escapeHtml(img.name)}" style="max-width:300px;max-height:300px;border:1px solid #e2e8f0;border-radius:6px;display:block;" />
                <a href="${img.shareUrl}" style="font-size:12px;color:#2563eb;">Open full image</a>
              </div>
            `,
          )
          .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>New customization request</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">

          <!-- Header -->
          <tr>
            <td style="background:#e11d48;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">New Customization Request</h1>
              <p style="margin:6px 0 0;color:#fecdd3;font-size:13px;">Submitted on ${submittedAt} (IST)</p>
            </td>
          </tr>

          <!-- Product info -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Product</p>
              <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a;">${escapeHtml(data.productName)}</p>
            </td>
          </tr>

          <!-- Customer info -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0 0 12px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Customer Details</p>
              <table role="presentation" width="100%" style="font-size:14px;">
                <tr>
                  <td style="padding:4px 0;color:#64748b;width:100px;">Name</td>
                  <td style="padding:4px 0;color:#0f172a;font-weight:500;">${escapeHtml(data.customer.name)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#64748b;">Email</td>
                  <td style="padding:4px 0;"><a href="mailto:${escapeHtml(data.customer.email)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(data.customer.email)}</a></td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#64748b;">Phone</td>
                  <td style="padding:4px 0;color:#0f172a;">${escapeHtml(data.customer.phone || '—')}</td>
                </tr>
              </table>
              ${
                data.customer.message
                  ? `<p style="margin:14px 0 0;font-size:13px;color:#64748b;">Message:</p>
                     <p style="margin:4px 0 0;padding:10px 12px;background:#f1f5f9;border-radius:6px;font-size:14px;color:#0f172a;white-space:pre-wrap;">${escapeHtml(data.customer.message)}</p>`
                  : ''
              }
            </td>
          </tr>

          <!-- Design preview -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0 0 12px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Design Preview (Canvas)</p>
              <img src="${data.designImage.shareUrl}" alt="Design preview" style="max-width:100%;border:1px solid #e2e8f0;border-radius:6px;display:block;" />
              <a href="${data.designImage.shareUrl}" style="display:inline-block;margin-top:8px;font-size:12px;color:#2563eb;">Open full design</a>
            </td>
          </tr>

          <!-- Uploaded images -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0 0 12px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Uploaded Images (${data.uploadedImages.length})</p>
              ${uploadedRows}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#f8fafc;">
              <p style="margin:0;font-size:12px;color:#64748b;">This email was sent from your Shopify customization app.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendCustomizationEmail(data: CustomizationEmailData): Promise<void> {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  const adminEmail = process.env.ADMIN_EMAIL || user

  if (!user || !pass) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD not set')
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  const html = buildHtml(data)

  await transporter.sendMail({
    from: `"Customization App" <${user}>`,
    to: adminEmail,
    replyTo: data.customer.email,
    subject: `New customization request — ${data.productName} (${data.customer.name})`,
    html,
    // Also attach a plain text fallback
    text: `New customization request

Product: ${data.productName}
Customer: ${data.customer.name}
Email: ${data.customer.email}
Phone: ${data.customer.phone || '—'}
Message: ${data.customer.message || '—'}

Design preview: ${data.designImage.shareUrl}

Uploaded images:
${data.uploadedImages.map((img, i) => `${i + 1}. ${img.name} — ${img.shareUrl}`).join('\n')}
`,
  })
}
