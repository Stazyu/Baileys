import { randomUUID } from 'crypto'
import { proto } from '../../WAProto/index.js'
import { CodeHighlightType, RichSubMessageType } from '../Types/RichType'
import { generateMessageID } from './generics'
import {
	type CodeBlockToken,
	JS_KEYWORDS,
	LANGUAGE_KEYWORDS,
	PYTHON_KEYWORDS,
	tokenizeCode
} from './rich-message-utils'

export { JS_KEYWORDS, PYTHON_KEYWORDS, LANGUAGE_KEYWORDS, tokenizeCode, CodeHighlightType, RichSubMessageType }
export type { CodeBlockToken }

export interface LatexExpression {
	latexExpression: string
	url?: string
	width?: number
	height?: number
	fontHeight?: number
	imageTopPadding?: number
	imageLeadingPadding?: number
	imageBottomPadding?: number
	imageTrailingPadding?: number
}

export interface RichContextInfo {
	stanzaId?: string
	participant?: string
	quotedMessage?: proto.IMessage
}

export const buildRichContextInfo = (
	quoted?: {
		key?: { id?: string; participant?: string; remoteJid?: string }
		message?: proto.IMessage
		sender?: string
	} | null,
	options: { botJid?: string; mentions?: string[] } = {}
): proto.IContextInfo => {
	const ctxInfo: proto.IContextInfo = {
		forwardingScore: 1,
		isForwarded: true,
		forwardedAiBotMessageInfo: { botJid: options.botJid ?? '867051314767696@bot' },
		forwardOrigin: 4,
		...(options.mentions ? { mentionedJid: options.mentions } : {})
	}

	if (quoted?.key) {
		ctxInfo.stanzaId = quoted.key.id
		ctxInfo.participant = quoted.key.participant ?? quoted.sender ?? quoted.key.remoteJid
		ctxInfo.quotedMessage = quoted.message
	}

	return ctxInfo
}

export const buildBotForwardedMessage = (
	submessages: unknown[],
	contextInfo?: proto.IContextInfo,
	unifiedResponse?: { data: Uint8Array }
): proto.IMessage => {
	const richResponse: proto.IAIRichResponseMessage = {
		messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
		submessages: submessages as proto.IAIRichResponseSubMessage[],
		contextInfo
	}

	if (unifiedResponse) {
		richResponse.unifiedResponse = unifiedResponse
	}

	return {
		botForwardedMessage: {
			message: {
				richResponseMessage: richResponse
			}
		}
	}
}

export interface RichContentResult {
	message: proto.IMessage
	messageId: string
}

const textSub = (messageText: string) => ({ messageType: RichSubMessageType.TEXT, messageText })

export const generateTableContent = (
	title: string,
	headers: string[],
	rows: string[][],
	quoted?: unknown,
	options: { headerText?: string; footer?: string } = {}
): RichContentResult => {
	const tableRows = [{ items: headers, isHeading: true }, ...rows.map(row => ({ items: row.map(String) }))]

	const submessages: unknown[] = []
	if (options.headerText) submessages.push(textSub(options.headerText))
	submessages.push({ messageType: RichSubMessageType.TABLE, tableMetadata: { title, rows: tableRows } })
	if (options.footer) submessages.push(textSub(options.footer))

	return {
		message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted as never)),
		messageId: generateMessageID()
	}
}

export const generateListContent = (
	title: string,
	items: string[] | string[][],
	quoted?: unknown,
	options: { headerText?: string; footer?: string } = {}
): RichContentResult => {
	const tableRows = items.map(item => ({
		items: Array.isArray(item) ? item.map(String) : [String(item)]
	}))

	const submessages: unknown[] = []
	if (options.headerText) submessages.push(textSub(options.headerText))
	submessages.push({ messageType: RichSubMessageType.TABLE, tableMetadata: { title, rows: tableRows } })
	if (options.footer) submessages.push(textSub(options.footer))

	return {
		message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted as never)),
		messageId: generateMessageID()
	}
}

export const generateCodeBlockContent = (
	code: string,
	quoted?: unknown,
	options: { title?: string; footer?: string; language?: string } = {}
): RichContentResult => {
	const { title, footer, language = 'javascript' } = options
	const submessages: unknown[] = []

	if (title) submessages.push(textSub(title))
	submessages.push({
		messageType: RichSubMessageType.CODE,
		codeMetadata: { codeLanguage: language, codeBlocks: tokenizeCode(code, language) }
	})
	if (footer) submessages.push(textSub(footer))

	return {
		message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted as never)),
		messageId: generateMessageID()
	}
}

export const generateLatexContent = (
	quoted?: unknown,
	options: { text?: string; expressions: LatexExpression[]; headerText?: string; footer?: string } = {
		expressions: []
	}
): RichContentResult => {
	const submessages: unknown[] = []

	if (options.headerText) submessages.push(textSub(options.headerText))

	const latexExpressions = options.expressions.map(expr => {
		const entry: Record<string, unknown> = {
			latexExpression: expr.latexExpression,
			url: expr.url,
			width: expr.width,
			height: expr.height
		}
		if (expr.fontHeight !== undefined) entry.fontHeight = expr.fontHeight
		if (expr.imageTopPadding !== undefined) entry.imageTopPadding = expr.imageTopPadding
		if (expr.imageLeadingPadding !== undefined) entry.imageLeadingPadding = expr.imageLeadingPadding
		if (expr.imageBottomPadding !== undefined) entry.imageBottomPadding = expr.imageBottomPadding
		if (expr.imageTrailingPadding !== undefined) entry.imageTrailingPadding = expr.imageTrailingPadding
		return entry
	})

	submessages.push({
		messageType: RichSubMessageType.LATEX,
		latexMetadata: { text: options.text ?? '', expressions: latexExpressions }
	})
	if (options.footer) submessages.push(textSub(options.footer))

	return {
		message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted as never)),
		messageId: generateMessageID()
	}
}

export type UploadFn = (buffer: Buffer, type: string) => Promise<{ url?: string; directPath?: string }>
export type RenderLatexFn = (latexExpr: string) => Promise<{ buffer: Buffer; width: number; height: number }>

export const generateLatexImageContent = async (
	quoted: unknown,
	options: { text?: string; expressions: LatexExpression[]; headerText?: string; footer?: string },
	uploadFn: UploadFn,
	renderLatexToPng: RenderLatexFn
): Promise<RichContentResult> => {
	const submessages: unknown[] = []

	if (options.headerText) submessages.push(textSub(options.headerText))

	const latexExpressions = await Promise.all(
		options.expressions.map(async expr => {
			const { buffer, width, height } = await renderLatexToPng(expr.latexExpression)
			const uploadResult = await uploadFn(buffer, 'image')
			const imageUrl = uploadResult.url ?? uploadResult.directPath
			return { latexExpression: expr.latexExpression, url: imageUrl, width, height }
		})
	)

	submessages.push({
		messageType: RichSubMessageType.LATEX,
		latexMetadata: { text: options.text ?? '', expressions: latexExpressions }
	})
	if (options.footer) submessages.push(textSub(options.footer))

	return {
		message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted as never)),
		messageId: generateMessageID()
	}
}

export const generateLatexInlineImageContent = async (
	quoted: unknown,
	options: { text?: string; expressions: LatexExpression[]; headerText?: string; footer?: string },
	uploadFn: UploadFn,
	renderLatexToPng: RenderLatexFn
): Promise<RichContentResult> => {
	const submessages: unknown[] = []

	if (options.headerText) submessages.push(textSub(options.headerText))
	if (options.text) submessages.push(textSub(options.text))

	for (const expr of options.expressions) {
		const { buffer, width, height } = await renderLatexToPng(expr.latexExpression)
		const uploadResult = await uploadFn(buffer, 'image')
		const imageUrl = uploadResult.url ?? uploadResult.directPath
		submessages.push({
			messageType: RichSubMessageType.INLINE_IMAGE,
			imageMetadata: {
				imageUrl: {
					imagePreviewUrl: imageUrl,
					imageHighResUrl: imageUrl
				},
				imageText: expr.latexExpression,
				alignment: 2
			}
		})
	}

	if (options.footer) submessages.push(textSub(options.footer))

	return {
		message: buildBotForwardedMessage(submessages, buildRichContextInfo(quoted as never)),
		messageId: generateMessageID()
	}
}

export const generateMarkdownContent = (
	text: string,
	quoted?: unknown,
	options: { botJid?: string; mentions?: string[] } = {}
): RichContentResult => {
	const submessages = [{ messageType: RichSubMessageType.TEXT, messageText: text }]

	const sections = submessages
		.map(sm => {
			if (sm.messageType === RichSubMessageType.TEXT) {
				return {
					view_model: {
						primitive: { text: sm.messageText, __typename: 'GenAIMarkdownTextUXPrimitive' },
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
			}
			return null
		})
		.filter(Boolean)

	const unifiedResponse = {
		data: Buffer.from(JSON.stringify({ response_id: randomUUID(), sections }))
	}

	const ctxInfo = buildRichContextInfo(quoted as never, options)
	return {
		message: buildBotForwardedMessage(submessages, ctxInfo, unifiedResponse),
		messageId: generateMessageID()
	}
}

export const captureUnifiedResponse = (msg: proto.IMessage) => {
	const botFwd = msg?.botForwardedMessage?.message
	if (!botFwd) return null
	const rich = botFwd.richResponseMessage
	if (!rich?.unifiedResponse?.data) return null
	return {
		unifiedResponse: { data: rich.unifiedResponse.data },
		submessages: (rich.submessages ?? []) as unknown[],
		contextInfo: rich.contextInfo ?? {}
	}
}

export const generateUnifiedResponseContent = (
	quoted: unknown,
	captured: { submessages: unknown[]; unifiedResponse: { data: Uint8Array } }
): RichContentResult => ({
	message: buildBotForwardedMessage(
		captured.submessages,
		buildRichContextInfo(quoted as never),
		captured.unifiedResponse
	),
	messageId: generateMessageID()
})

export const generateRichMessageContent = (
	submessages: unknown[],
	quoted?: unknown,
	options: { botJid?: string; mentions?: string[]; useMarkdown?: boolean; unifiedResponse?: { data: Uint8Array } } = {}
): RichContentResult => {
	const ctxInfo = buildRichContextInfo(quoted as never, options)

	let unifiedResponse = options.unifiedResponse
	if (options.useMarkdown && !unifiedResponse) {
		const sections = submessages
			.map((sm: unknown) => {
				const s = sm as {
					messageType: RichSubMessageType
					messageText?: string
					tableMetadata?: { rows: { isHeading?: boolean; items?: string[] }[] }
					codeMetadata?: { codeLanguage?: string; codeBlocks: CodeBlockToken[] }
					imageMetadata?: { imageUrl?: { imageHighResUrl?: string; imagePreviewUrl?: string } }
				}
				if (s.messageType === RichSubMessageType.TEXT) {
					return {
						view_model: {
							primitive: { text: s.messageText, __typename: 'GenAIMarkdownTextUXPrimitive' },
							__typename: 'GenAISingleLayoutViewModel'
						}
					}
				}
				if (s.messageType === RichSubMessageType.TABLE && s.tableMetadata) {
					return {
						view_model: {
							primitive: {
								rows: s.tableMetadata.rows.map(r => ({ is_header: !!r.isHeading, cells: r.items })),
								__typename: 'GenATableUXPrimitive'
							},
							__typename: 'GenAISingleLayoutViewModel'
						}
					}
				}
				if (s.messageType === RichSubMessageType.CODE && s.codeMetadata) {
					return {
						view_model: {
							primitive: {
								language: s.codeMetadata.codeLanguage ?? 'javascript',
								code_blocks: s.codeMetadata.codeBlocks.map(cb => ({ content: cb.codeContent, type: 'DEFAULT' })),
								__typename: 'GenAICodeUXPrimitive'
							},
							__typename: 'GenAISingleLayoutViewModel'
						}
					}
				}
				if (s.messageType === RichSubMessageType.INLINE_IMAGE && s.imageMetadata) {
					return {
						view_model: {
							primitive: {
								media: {
									url: s.imageMetadata.imageUrl?.imageHighResUrl ?? s.imageMetadata.imageUrl?.imagePreviewUrl,
									mime_type: 'image/png'
								},
								imagine_type: 'IMAGE',
								status: { status: 'READY' },
								__typename: 'GenAIImaginePrimitive'
							},
							__typename: 'GenAISingleLayoutViewModel'
						}
					}
				}
				return null
			})
			.filter(Boolean)

		if (sections.length > 0) {
			unifiedResponse = { data: Buffer.from(JSON.stringify({ response_id: randomUUID(), sections })) }
		}
	}

	return {
		message: buildBotForwardedMessage(submessages, ctxInfo, unifiedResponse),
		messageId: generateMessageID()
	}
}

/** Render LaTeX to a PNG using the codecogs online API */
export const renderLatexToPng = async (
	latexExpr: string
): Promise<{ buffer: Buffer; width: number; height: number }> => {
	const encoded = encodeURIComponent(latexExpr)
	const url = `https://latex.codecogs.com/png.image?%5Cdpi%7B1200%7D%5Cbg%7Bwhite%7D${encoded}`
	const res = await fetch(url)
	if (!res.ok) throw new Error(`[renderLatexToPng] HTTP ${res.status}`)
	const buffer = Buffer.from(await res.arrayBuffer())
	return { buffer, width: 1200, height: 600 }
}
