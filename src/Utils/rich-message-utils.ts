import { randomFillSync, randomUUID } from 'crypto'
import { proto } from '../../WAProto/index.js'
import { CodeHighlightType, RichSubMessageType } from '../Types/RichType'

const NOOP = new Set<string>()

export const JS_KEYWORDS = new Set([
	'import',
	'export',
	'from',
	'default',
	'as',
	'const',
	'let',
	'var',
	'function',
	'class',
	'extends',
	'new',
	'return',
	'if',
	'else',
	'for',
	'while',
	'do',
	'switch',
	'case',
	'break',
	'continue',
	'try',
	'catch',
	'finally',
	'throw',
	'async',
	'await',
	'yield',
	'typeof',
	'instanceof',
	'in',
	'of',
	'delete',
	'void',
	'true',
	'false',
	'null',
	'undefined',
	'NaN',
	'Infinity',
	'this',
	'super',
	'static',
	'get',
	'set',
	'debugger',
	'with'
])

export const PYTHON_KEYWORDS = new Set([
	'import',
	'from',
	'as',
	'def',
	'class',
	'return',
	'if',
	'elif',
	'else',
	'for',
	'while',
	'break',
	'continue',
	'try',
	'except',
	'finally',
	'raise',
	'with',
	'yield',
	'lambda',
	'pass',
	'del',
	'global',
	'nonlocal',
	'assert',
	'True',
	'False',
	'None',
	'and',
	'or',
	'not',
	'in',
	'is',
	'async',
	'await',
	'self',
	'print'
])

export const LANGUAGE_KEYWORDS: { [key: string]: Set<string> } = {
	javascript: JS_KEYWORDS,
	typescript: JS_KEYWORDS,
	js: JS_KEYWORDS,
	ts: JS_KEYWORDS,
	python: PYTHON_KEYWORDS,
	py: PYTHON_KEYWORDS
}

const LEXER_REGEX =
	/(\/\/.*|\/\*[\s\S]*?\*\/|#.*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[\s\S]*?`)|(\b[a-zA-Z_]\w*\b)(?=\s*\()|(\b[a-zA-Z_]\w*\b)|(\b\d+(?:\.\d+)?\b)|(\s+|[^\w\s]+)/g

export interface CodeBlockToken {
	highlightType: CodeHighlightType
	codeContent: string
}

export const tokenizeCode = (code: string, language = 'javascript'): CodeBlockToken[] => {
	const keywords = LANGUAGE_KEYWORDS[language] ?? NOOP
	const blocks: CodeBlockToken[] = []
	LEXER_REGEX.lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = LEXER_REGEX.exec(code)) !== null) {
		if (match[1]) {
			blocks.push({ highlightType: CodeHighlightType.COMMENT, codeContent: match[1] })
		} else if (match[2]) {
			blocks.push({ highlightType: CodeHighlightType.STRING, codeContent: match[2] })
		} else if (match[3]) {
			blocks.push({
				highlightType: keywords.has(match[3]) ? CodeHighlightType.KEYWORD : CodeHighlightType.METHOD,
				codeContent: match[3]
			})
		} else if (match[4]) {
			blocks.push({
				highlightType: keywords.has(match[4]) ? CodeHighlightType.KEYWORD : CodeHighlightType.DEFAULT,
				codeContent: match[4]
			})
		} else if (match[5]) {
			blocks.push({ highlightType: CodeHighlightType.NUMBER, codeContent: match[5] })
		} else {
			blocks.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: match[6]! })
		}
	}

	return blocks
}

/** Loose sub-message shape accepted by the rich composers (mirrors the fork's raw object model) */
export type RichSubMessage = {
	messageType: RichSubMessageType
	messageText?: string
	inlineEntities?: unknown[]
	codeMetadata?: { codeLanguage?: string; codeBlocks: CodeBlockToken[] }
	tableMetadata?: { title?: string; rows: { isHeading?: boolean; items?: string[] }[] }
	imageMetadata?: { imageUrl?: unknown; imageText?: string; alignment?: number; tapLinkUrl?: string }
	latexMetadata?: { text?: string; expressions: unknown[] }
	contentItemsMetadata?: { itemsMetadata?: unknown[]; contentType?: unknown }
}

const toProtoSubMessage = (submessage: RichSubMessage): proto.IAIRichResponseSubMessage =>
	submessage as unknown as proto.IAIRichResponseSubMessage

export const toUnified = (submessages: RichSubMessage[], uuid?: string) => ({
	response_id: uuid ?? randomUUID(),
	sections: submessages.map(submessage => {
		switch (submessage.messageType) {
			case RichSubMessageType.CODE: {
				const codeMetadata = submessage.codeMetadata
				return {
					view_model: {
						primitive: {
							language: codeMetadata?.codeLanguage,
							code_blocks: codeMetadata?.codeBlocks.map(block => ({
								content: block.codeContent,
								type: CodeHighlightType[block.highlightType] ?? 'DEFAULT'
							})),
							__typename: 'GenAICodeUXPrimitive'
						},
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
			}
			case RichSubMessageType.CONTENT_ITEMS:
			case RichSubMessageType.INLINE_IMAGE:
			case RichSubMessageType.LATEX:
				return {}
			case RichSubMessageType.TABLE: {
				const tableMetadata = submessage.tableMetadata
				return {
					view_model: {
						primitive: {
							title: tableMetadata?.title,
							rows: tableMetadata?.rows.map(row => ({
								is_header: row.isHeading,
								cells: row.items,
								markdown_cells: row.items?.map(item => ({ text: item }))
							})),
							__typename: 'GenATableUXPrimitive'
						},
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
			}
			case RichSubMessageType.TEXT:
				return {
					view_model: {
						primitive: {
							text: submessage.messageText,
							inline_entities: submessage.inlineEntities ?? [],
							__typename: 'GenAIMarkdownTextUXPrimitive'
						},
						__typename: 'GenAISingleLayoutViewModel'
					}
				}
			default:
				return submessage
		}
	})
})

export const botMetadataSignature = (): Uint8Array => {
	const signature = new Uint8Array(64)
	randomFillSync(signature)
	return signature
}

export const botMetadataCertificate = (length = 685): Uint8Array => {
	const certificate = new Uint8Array(length)
	certificate[0] = 48
	certificate[1] = 130
	randomFillSync(certificate.subarray(2))
	return certificate
}

export const wrapToBotForwardedMessage = (richResponseMessage: proto.IAIRichResponseMessage): proto.IMessage => ({
	messageContextInfo: {
		botMetadata: {
			verificationMetadata: {
				proofs: [
					{
						certificateChain: [botMetadataCertificate(), botMetadataCertificate(892)],
						version: 1,
						useCase: 1,
						signature: botMetadataSignature()
					}
				]
			}
		}
	},
	botForwardedMessage: {
		message: { richResponseMessage }
	}
})

export const prepareRichResponseMessage = (content: {
	disclaimerText?: string
	richResponse?: RichSubMessage[]
	headerText?: string
	contentText?: string
	code?: string
	language?: string
	items?: unknown[]
	inlineImage?: unknown
	inlineVideo?: string
	imageText?: string
	alignment?: number
	tapLinkUrl?: string
	latex?: unknown[]
	text?: string
	links?: unknown[]
	posts?: unknown[]
	products?: unknown[]
	suggested?: unknown[]
	table?: string[][]
	title?: string
	noHeading?: boolean
	footerText?: string
}): proto.IMessage => {
	const submessages: RichSubMessage[] = []

	if (Array.isArray(content.richResponse)) {
		submessages.push(...content.richResponse)
	} else {
		if (content.headerText) {
			submessages.push({ messageType: RichSubMessageType.TEXT, messageText: content.headerText })
		}
		if (content.contentText) {
			submessages.push({ messageType: RichSubMessageType.TEXT, messageText: content.contentText })
		}
		if (content.code) {
			const lang = content.language ?? 'javascript'
			submessages.push({
				messageType: RichSubMessageType.CODE,
				codeMetadata: { codeLanguage: lang, codeBlocks: tokenizeCode(content.code, lang) }
			})
		}
		if (content.items) {
			submessages.push({
				messageType: RichSubMessageType.CONTENT_ITEMS,
				contentItemsMetadata: {
					itemsMetadata: content.items,
					contentType: proto.AIRichResponseContentItemsMetadata.ContentType.CAROUSEL
				}
			})
		}
		if (content.inlineImage) {
			submessages.push({
				messageType: RichSubMessageType.INLINE_IMAGE,
				imageMetadata: {
					imageUrl: content.inlineImage,
					imageText: content.imageText,
					alignment: content.alignment,
					tapLinkUrl: content.tapLinkUrl
				}
			})
		}
		if (content.latex) {
			submessages.push({
				messageType: RichSubMessageType.LATEX,
				latexMetadata: { text: content.text, expressions: content.latex }
			})
		}
		if (content.table) {
			submessages.push({
				messageType: RichSubMessageType.TABLE,
				tableMetadata: {
					title: content.title,
					rows: content.table.map((rowItems, index) => ({
						isHeading: !content.noHeading && index === 0,
						items: rowItems
					}))
				}
			})
		}
		if (content.footerText) {
			submessages.push({ messageType: RichSubMessageType.TEXT, messageText: content.footerText })
		}
	}

	const uuid = randomUUID()
	const unified = toUnified(submessages, uuid)
	const richResponseMessage = proto.AIRichResponseMessage.create({
		submessages: submessages.map(toProtoSubMessage),
		messageType: proto.AIRichResponseMessageType.AI_RICH_RESPONSE_TYPE_STANDARD,
		unifiedResponse: { data: Buffer.from(JSON.stringify(unified)) },
		contextInfo: {
			isForwarded: true,
			forwardingScore: 1,
			forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
			forwardOrigin: 4
		}
	})

	const wrappedMsg = wrapToBotForwardedMessage(richResponseMessage)
	const botMetadata = wrappedMsg.messageContextInfo!.botMetadata!
	if (content.disclaimerText) {
		botMetadata.messageDisclaimerText = content.disclaimerText
	}
	botMetadata.botResponseId = uuid
	return wrappedMsg
}
