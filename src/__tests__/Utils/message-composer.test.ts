import { describe, it } from '@jest/globals';
import { proto } from '../../../WAProto/index.js'
import {
	extractIE,
	generateRichHtmlContent,
	generateRichMessageContent,
	normalizeRichHtmlArgs,
	sendRichHtml
} from '../../Utils/message-composer'
import { expect } from '@jest/globals';

const decodeUnified = (data: Uint8Array) => JSON.parse(Buffer.from(data).toString('utf-8'))

const unifiedOf = (message: proto.IMessage) =>
	decodeUnified(message.botForwardedMessage!.message!.richResponseMessage!.unifiedResponse!.data!)

describe('generateRichHtmlContent', () => {
	it('embeds the html in a GenAI html primitive and mirrors response_id into botMetadata', () => {
		const { message, messageId } = generateRichHtmlContent('<b>hi</b>', null, { id: 'dash' })

		const unified = unifiedOf(message)
		expect(unified.sections[0].view_model.primitive).toEqual({
			__typename: 'GenAIaeacdsnwHtmlPrimitive',
			payload: '<b>hi</b>',
			trusted_sources: []
		})
		expect(unified.response_id).toMatch(/^dash-\d+$/)
		expect(message.messageContextInfo!.botMetadata!.botResponseId).toBe(unified.response_id)
		expect(messageId).toBeTruthy()
	})

	it('falls back to source for trusted_sources and accepts an array', () => {
		expect(
			unifiedOf(generateRichHtmlContent('x', null, { source: 'svc' }).message).sections[0].view_model.primitive
				.trusted_sources
		).toEqual(['svc'])

		expect(
			unifiedOf(generateRichHtmlContent('x', null, { trustedSources: ['a', 'b'] }).message).sections[0].view_model
				.primitive.trusted_sources
		).toEqual(['a', 'b'])
	})

	it('orders header, title and footer as text submessages and keeps the quoted stanza', () => {
		const quoted = { key: { id: 'ABC', remoteJid: '123@s.whatsapp.net' }, message: { conversation: 'hi' } }
		const { message } = generateRichHtmlContent('<p></p>', quoted, {
			headerText: 'head',
			title: 'title',
			footer: 'foot'
		})

		const rich = message.botForwardedMessage!.message!.richResponseMessage!
		expect(rich.submessages?.map(s => s.messageText)).toEqual(['head', 'title', 'foot'])
		expect(rich.contextInfo?.stanzaId).toBe('ABC')
		expect(rich.contextInfo?.participant).toBe('123@s.whatsapp.net')
	})

	it('survives a protobuf encode round trip', () => {
		const { message } = generateRichHtmlContent('<i>x</i>', null, { title: 't' })
		const decoded = proto.Message.decode(proto.Message.encode(proto.Message.create(message)).finish())
		expect(decoded.messageContextInfo?.botMetadata?.botResponseId).toBeTruthy()
		expect(decoded.botForwardedMessage?.message?.richResponseMessage?.unifiedResponse?.data?.length).toBeGreaterThan(0)
	})
})

describe('normalizeRichHtmlArgs', () => {
	it('accepts a raw html string and merges extra options', () => {
		const { html, opts } = normalizeRichHtmlArgs('<b>x</b>', { title: 't' })
		expect(html).toBe('<b>x</b>')
		expect(opts.title).toBe('t')
	})

	it('prefers the object html and lets additionalOptions override', () => {
		const { html, opts } = normalizeRichHtmlArgs({ html: '<a></a>', title: 'a' }, { title: 'b' })
		expect(html).toBe('<a></a>')
		expect(opts.title).toBe('b')
	})

	it('rejects missing options with a 400 boom', () => {
		expect(() => normalizeRichHtmlArgs(undefined as unknown as string)).toThrow(/html content must be provided/)
	})
})

describe('extractIE', () => {
	it('rewrites markdown links into sentinel tags with trusted metadata', () => {
		const { text, inline_entities } = extractIE('see [Site](https://example.com) and [Bad](!https://x.tld)')
		expect(text).toBe(
			'see {{HYPERLINK_0}}https://example.com{{/HYPERLINK_0}} and {{HYPERLINK_1}}https://x.tld{{/HYPERLINK_1}}'
		)
		expect(inline_entities.map(e => e.metadata.is_trusted)).toEqual([true, false])
		expect(inline_entities[0]?.metadata.__typename).toBe('GenAIInlineLinkItem')
	})

	it('turns an empty label into a citation with an incrementing reference id', () => {
		const { text, inline_entities } = extractIE('fact [](https://src) more [](https://src2)')
		expect(text).toBe('fact {{CITATION_0}}https://src{{/CITATION_0}} more {{CITATION_1}}https://src2{{/CITATION_1}}')
		expect(inline_entities.map(e => e.metadata.reference_id)).toEqual([1, 2])
	})

	it('parses latex pipes and applies dimension defaults', () => {
		const { inline_entities } = extractIE('[x^2|120|40]<https://img>')
		expect(inline_entities[0]?.metadata).toEqual({
			latex_expression: 'x^2',
			latex_image: { url: 'https://img', width: 120, height: 40 },
			font_height: 83.333333333333,
			padding: 15,
			__typename: 'GenAILatexItem'
		})
	})

	it('leaves text untouched when extraction is disabled', () => {
		expect(extractIE('[a](b)', { extract: false })).toEqual({ text: '[a](b)', ie: [], inline_entities: [] })
	})
	it('honours per-entity switches', () => {
		expect(extractIE('[a](b)', { hyperlink: false }).inline_entities).toHaveLength(0)
		expect(extractIE('[](b)', { citation: false }).inline_entities).toHaveLength(0)
		expect(extractIE('[a]<b>', { latex: false }).inline_entities).toHaveLength(0)
	})

	it('ignores unbalanced brackets', () => {
		const { text, inline_entities } = extractIE('broken [a](b and [] unclosed')
		expect(inline_entities).toHaveLength(0)
		expect(text).toBe('broken [a](b and [] unclosed')
	})
})

describe('generateRichMessageContent markdown primitives', () => {
	const unified = (submessages: unknown[]) =>
		JSON.parse(
			Buffer.from(
				generateRichMessageContent(submessages, null, { useMarkdown: true }).message.botForwardedMessage!.message!
					.richResponseMessage!.unifiedResponse!.data!
			).toString('utf-8')
		)

	it('attaches inline entities to text sections', () => {
		const parsed = unified([{ messageType: 2, messageText: 'go [Docs](https://d.dev)' }])
		const [section] = parsed.sections
		expect(section.view_model.primitive.text).toBe('go {{HYPERLINK_0}}https://d.dev{{/HYPERLINK_0}}')
		expect(section.view_model.primitive.inline_entities[0].metadata.url).toBe('https://d.dev')
	})

	it('adds markdown_cells only for table rows carrying entities', () => {
		const parsed = unified([
			{
				messageType: 4,
				tableMetadata: {
					title: 'T',
					rows: [{ items: ['plain'], isHeading: true }, { items: ['[Link](https://l.dev)'] }]
				}
			}
		])

		const rows = parsed.sections[0].view_model.primitive.rows
		expect(rows[0].markdown_cells).toBeUndefined()
		expect(rows[0].cells).toEqual(['plain'])
		expect(rows[1].markdown_cells[0].text).toBe('{{HYPERLINK_0}}https://l.dev{{/HYPERLINK_0}}')
	})
})

describe('sendRichHtml (standalone)', () => {
	it('relays the generated payload with the composer messageId', async () => {
		const relayed: { jid: string; message: proto.IMessage; options: unknown }[] = []
		const socket = {
			relayMessage: async (jid: string, message: proto.IMessage, options: unknown) => {
				relayed.push({ jid, message, options })
			}
		}
		const result = await sendRichHtml(socket, '123@s.whatsapp.net', { html: '<b>x</b>', title: 'T' })
		const [call] = relayed
		expect(relayed).toHaveLength(1)
		expect(call?.jid).toBe('123@s.whatsapp.net')
		expect(call?.options).toEqual({ messageId: result.messageId })
		expect(call?.message).toEqual(result.message)
	})
})
