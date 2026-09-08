import { Boom } from '@hapi/boom'
import type { MessageRelayOptions, WAMessage } from '../Types'
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

export interface ExtractEntityOptions {
	/** master switch; when false the text is returned untouched */
	extract?: boolean
	/** parse `[label](url)` into a GenAIInlineLinkItem */
	hyperlink?: boolean
	/** parse `[](url)` into a GenAISearchCitationItem */
	citation?: boolean
	/** parse `[expr|w|h|fontHeight|padding](<url>)` into a GenAILatexItem */
	latex?: boolean
}

type InlineEntityType = 'hyperlink' | 'citation' | 'latex'

export interface ExtractedInlineEntity {
	key: string
	metadata: Record<string, unknown>
}

export interface ExtractedEntity {
	type: InlineEntityType
	ie: {
		key: string
		text: string
		url: string
		is_trusted?: boolean
		reference_id?: number
		width?: string | null
		height?: string | null
		font_height?: string | null
		padding?: string | null
	}
}

/**
 * Rewrite WhatsApp-GenAI markdown placeholders (`[label](url)`, `[](url)`, `[tex](<url>)`) into
 * `{{KEY}}value{{/KEY}}` sentinel tags plus the parallel `inline_entities` list the client renders.
 * The sentinel tags stay in the text so the WhatsApp client can splice the rich item back in.
 */
export const extractIE = (
	text: string,
	{ extract = true, hyperlink = true, citation = true, latex = true }: ExtractEntityOptions = {}
): { text: string; ie: ExtractedEntity[]; inline_entities: ExtractedInlineEntity[] } => {
	if (!text || typeof text !== 'string' || !extract) {
		return { text: text ?? '', ie: [], inline_entities: [] }
	}

	const createIE = (type: InlineEntityType, entity: ExtractedEntity['ie']): ExtractedInlineEntity | null => {
		if (type === 'hyperlink') {
			return {
				key: entity.key,
				metadata: {
					display_name: entity.text,
					is_trusted: entity.is_trusted,
					url: entity.url,
					__typename: 'GenAIInlineLinkItem'
				}
			}
		}

		if (type === 'citation') {
			return {
				key: entity.key,
				metadata: {
					reference_id: entity.reference_id,
					reference_url: entity.url,
					reference_title: entity.url,
					reference_display_name: entity.url,
					sources: [],
					__typename: 'GenAISearchCitationItem'
				}
			}
		}

		if (type === 'latex') {
			return {
				key: entity.key,
				metadata: {
					latex_expression: entity.text,
					latex_image: {
						url: entity.url,
						width: Number(entity.width) || 100,
						height: Number(entity.height) || 100
					},
					font_height: Number(entity.font_height) || 83.333333333333,
					padding: Number(entity.padding) || 15,
					__typename: 'GenAILatexItem'
				}
			}
		}

		return null
	}

	const ie: ExtractedEntity[] = []
	const inline_entities: ExtractedInlineEntity[] = []
	let result = ''
	let last = 0
	let citationIndex = 1
	let hyperlinkIndex = 0
	let latexIndex = 0
	const stack: number[] = []

	for (let i = 0; i < text.length; i++) {
		if (text[i] === '[' && text[i - 1] !== '\\') {
			stack.push(i)
			continue
		}

		if (text[i] !== ']' || text[i - 1] === '\\') continue

		const open = text[i + 1]
		if (open !== '(' && open !== '<') {
			stack.pop()
			continue
		}

		const start = stack.pop()
		if (start == null) continue

		const close = open === '(' ? ')' : '>'
		const type = open === '(' ? 'link' : 'latex'
		let end = i + 2
		let depth = 1

		while (end < text.length && depth > 0) {
			if (text[end] === open && text[end - 1] !== '\\') depth++
			else if (text[end] === close && text[end - 1] !== '\\') depth--
			end++
		}

		if (depth > 0) continue

		const raw = text.slice(start + 1, i).trim()
		let url = text.slice(i + 2, end - 1).trim()

		let key: string
		let tag: string
		let data: ExtractedEntity

		if (type === 'latex') {
			if (!latex) continue
			const [txt = '', width = null, height = null, font_height = null, padding = null] = raw.split('|')
			key = `LATEX_${latexIndex++}`
			tag = `{{${key}}}${txt || 'image'}{{/${key}}}`
			data = { type: 'latex', ie: { key, text: txt, url, width, height, font_height, padding } }
		} else if (raw) {
			if (!hyperlink) continue
			const isTrusted = !url.startsWith('!')
			if (!isTrusted) url = url.slice(1)
			key = `HYPERLINK_${hyperlinkIndex++}`
			tag = `{{${key}}}${url}{{/${key}}}`
			data = { type: 'hyperlink', ie: { key, text: raw, url, is_trusted: isTrusted } }
		} else {
			if (!citation) continue
			key = `CITATION_${citationIndex - 1}`
			tag = `{{${key}}}${url}{{/${key}}}`
			data = { type: 'citation', ie: { reference_id: citationIndex++, key, text: '', url } }
		}

		result += text.slice(last, start) + tag
		last = end

		ie.push(data)
		const entity = createIE(data.type, data.ie)
		if (entity) inline_entities.push(entity)

		i = end - 1
	}

	result += text.slice(last)

	return { text: result, ie, inline_entities }
}

export const generateMarkdownContent = (
	text: string,
	quoted?: unknown,
	options: {
		botJid?: string
		mentions?: string[]
		extract?: boolean
		hyperlink?: boolean
		citation?: boolean
		latex?: boolean
	} = {}
): RichContentResult => {
	const { text: extractedText, inline_entities } = extractIE(text, options)

	const submessages = [{ messageType: RichSubMessageType.TEXT, messageText: text }]

	const primitive: Record<string, unknown> = {
		text: extractedText,
		__typename: 'GenAIMarkdownTextUXPrimitive'
	}
	if (inline_entities.length > 0) primitive.inline_entities = inline_entities

	const sections = [
		{
			view_model: {
				primitive,
				__typename: 'GenAISingleLayoutViewModel'
			}
		}
	]

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
	options: {
		botJid?: string
		mentions?: string[]
		useMarkdown?: boolean
		unifiedResponse?: { data: Uint8Array }
		extract?: boolean
		hyperlink?: boolean
		citation?: boolean
		latex?: boolean
	} = {}
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
					const { text, inline_entities } = extractIE(s.messageText ?? '', options)
					const primitive: Record<string, unknown> = { text, __typename: 'GenAIMarkdownTextUXPrimitive' }
					if (inline_entities.length > 0) primitive.inline_entities = inline_entities
					return {
						view_model: {
							primitive,
							__typename: 'GenAISingleLayoutViewModel'
						}
					}
				}
				if (s.messageType === RichSubMessageType.TABLE && s.tableMetadata) {
					const rows = s.tableMetadata.rows.map(r => {
						const cells = (r.items ?? []).map(String)
						const markdown_cells = cells.map(cell => {
							const { text, inline_entities } = extractIE(cell, options)
							return inline_entities.length > 0 ? { text, inline_entities } : { text }
						})
						return {
							is_header: !!r.isHeading,
							cells,
							...(markdown_cells.some(c => c.inline_entities) ? { markdown_cells } : {})
						}
					})
					return {
						view_model: {
							primitive: { rows, __typename: 'GenATableUXPrimitive' },
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

/** Accept either a raw HTML string or an options object, merging any extra options on top. */
export const normalizeRichHtmlArgs = (
	options: string | RichHtmlOptions,
	additionalOptions: RichHtmlOptions = {}
): { html: string; opts: RichHtmlOptions } => {
	if (typeof options === 'string') return { html: options, opts: { ...additionalOptions } }
	if (options && typeof options === 'object') {
		return { html: options.html ?? '', opts: { ...options, ...additionalOptions } }
	}
	throw new Boom('[sendRichHtml] options or html content must be provided', { statusCode: 400 })
}

export interface RichHtmlOptions {
	/** prefix for the generated botResponseId; a random UUID is used when omitted */
	id?: string
	/** rendered as a text sub-message above the HTML block */
	title?: string
	/** text sub-message rendered before the title */
	headerText?: string
	/** text sub-message rendered after the HTML block */
	footer?: string
	/** the HTML payload; only required when passing the options-object form to `sendRichHtml` */
	html?: string
	/** single trusted source identifier; superseded by `trustedSources` */
	source?: string
	/** sources the client is allowed to load resources from */
	trustedSources?: string | string[]
	/** GenAI primitive name; override only for client builds expecting another renderer */
	typename?: string
	botJid?: string
	mentions?: string[]
}

/**
 * Build a GenAI interactive-HTML payload: the raw HTML travels inside `unifiedResponse.data` under an
 * HTML primitive, which is what makes the WhatsApp client render it as a live web view rather than text.
 * `botResponseId` in `messageContextInfo` must match the payload's `response_id` or the client drops the render.
 */
export const generateRichHtmlContent = (
	html: string,
	quoted?: unknown,
	options: RichHtmlOptions = {}
): RichContentResult => {
	const { id, title, headerText, footer, source, trustedSources, typename } = options
	const responseId = id ? `${id}-${Date.now()}` : randomUUID()
	const trusted = trustedSources
		? Array.isArray(trustedSources)
			? trustedSources
			: [trustedSources]
		: source
			? [source]
			: []

	const submessages: unknown[] = []
	if (headerText) submessages.push(textSub(headerText))
	if (title) submessages.push(textSub(title))
	if (footer) submessages.push(textSub(footer))

	const unifiedResponse = {
		data: Buffer.from(
			JSON.stringify({
				response_id: responseId,
				sections: [
					{
						view_model: {
							primitive: {
								__typename: typename ?? 'GenAIaeacdsnwHtmlPrimitive',
								payload: html,
								trusted_sources: trusted
							},
							__typename: 'GenAISingleLayoutViewModel'
						}
					}
				]
			})
		)
	}

	const botMsg = buildBotForwardedMessage(
		submessages,
		buildRichContextInfo(quoted as never, options),
		unifiedResponse
	)

	const message: proto.IMessage = {
		messageContextInfo: {
			deviceListMetadata: {},
			deviceListMetadataVersion: 2,
			botMetadata: {
				messageDisclaimerText: '',
				botResponseId: responseId
			}
		},
		...botMsg
	}

	return { message, messageId: generateMessageID() }
}

/** Standalone variant of `sock.sendRichHtml` for callers holding a socket instance. */
export const sendRichHtml = async (
	socket: { relayMessage: (jid: string, message: proto.IMessage, options: MessageRelayOptions) => Promise<unknown> },
	jid: string,
	options: string | RichHtmlOptions,
	quoted?: WAMessage,
	relayOptions: MessageRelayOptions = {}
): Promise<RichContentResult> => {
	const { html, opts } = normalizeRichHtmlArgs(options, {})
	const { message, messageId } = generateRichHtmlContent(html, quoted, opts)
	await socket.relayMessage(jid, message, { messageId, ...relayOptions })
	return { message, messageId }
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
