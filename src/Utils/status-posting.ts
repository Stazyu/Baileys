import { randomBytes } from 'crypto'
import type { AnyMessageContent, MessageRelayOptions, WAMessage } from '../Types'

export type StatusType = 'text' | 'image' | 'video' | 'audio'

export interface TextStatusOptions {
	text: string
	backgroundColor?: string
	font?: number
	textColor?: string
	mentions?: string[]
}

export interface MediaStatusOptions {
	caption?: string
	viewOnce?: boolean
	gifPlayback?: boolean
	ptt?: boolean
	waveform?: Uint8Array
}

/** Pre-defined background colors for text status */
export const STATUS_BACKGROUNDS = {
	solid: {
		green: '#25D366',
		blue: '#34B7F1',
		purple: '#8B5CF6',
		red: '#EF4444',
		orange: '#F97316',
		yellow: '#EAB308',
		pink: '#EC4899',
		teal: '#14B8A6',
		gray: '#6B7280',
		black: '#000000',
		white: '#FFFFFF'
	},
	gradient: {
		sunset: ['#F97316', '#EF4444'],
		ocean: ['#3B82F6', '#06B6D4'],
		forest: ['#22C55E', '#10B981'],
		purple: ['#8B5CF6', '#EC4899'],
		midnight: ['#1E3A8A', '#4C1D95'],
		aurora: ['#06B6D4', '#8B5CF6', '#EC4899']
	}
} as const

/** Font types for text status (0-9) */
export const STATUS_FONTS = {
	SANS_SERIF: 0,
	SERIF: 1,
	NORICAN: 2,
	BRYNDAN: 3,
	BEBASNEUE: 4,
	OSWALD: 5,
	DAMION: 6,
	DANCING: 7,
	COMFORTAA: 8,
	EXOTWO: 9
} as const

/** Generate a typical WhatsApp status message ID starting with 3EB0 */
export const generateStatusMessageId = (): string => `3EB0${randomBytes(16).toString('hex').toUpperCase()}`

/** Text status content carries background/font metadata used by `sendMessage` status handling */
export type TextStatusContent = AnyMessageContent & {
	backgroundColor?: string
	font?: number
}

/** Audio status content carries an optional waveform used by the encoder */
export type AudioStatusContent = AnyMessageContent & {
	waveform?: Uint8Array
}

/** Create text status content */
export const createTextStatus = (options: TextStatusOptions): TextStatusContent =>
	({
		text: options.text,
		backgroundColor: options.backgroundColor ?? STATUS_BACKGROUNDS.solid.green,
		font: options.font ?? STATUS_FONTS.SANS_SERIF,
		contextInfo: {
			mentionedJid: options.mentions ?? [],
			isForwarded: false
		}
	}) as TextStatusContent

/** Create image status content */
export const createImageStatus = (media: Buffer | string, options?: MediaStatusOptions): AnyMessageContent => ({
	image: typeof media === 'string' ? { url: media } : media,
	caption: options?.caption ?? '',
	viewOnce: options?.viewOnce
})

/** Create video status content */
export const createVideoStatus = (media: Buffer | string, options?: MediaStatusOptions): AnyMessageContent => ({
	video: typeof media === 'string' ? { url: media } : media,
	caption: options?.caption ?? '',
	gifPlayback: options?.gifPlayback ?? false,
	viewOnce: options?.viewOnce
})

/** Create audio/PTT status content */
export const createAudioStatus = (media: Buffer | string, options?: MediaStatusOptions): AudioStatusContent =>
	({
		audio: typeof media === 'string' ? { url: media } : media,
		ptt: options?.ptt ?? true,
		mimetype: 'audio/ogg; codecs=opus',
		waveform: options?.waveform
	}) as AudioStatusContent

/** Status target JID */
export const STATUS_BROADCAST_JID = 'status@broadcast'

/** Helper to return the broadcast JID */
export const getStatusJid = (): string => STATUS_BROADCAST_JID

/** Minimal sendMessage shape needed to post a status */
export type StatusSendFunction = (
	jid: string,
	content: AnyMessageContent,
	options?: MessageRelayOptions & { statusJidList?: string[] }
) => Promise<WAMessage | undefined>

/** High-level builder to create and send status messages */
export const StatusHelper = {
	text: (text: string, backgroundColor?: string, font?: number): AnyMessageContent =>
		createTextStatus({ text, backgroundColor, font }),
	image: (buffer: Buffer, caption?: string): AnyMessageContent => createImageStatus(buffer, { caption }),
	imageUrl: (url: string, caption?: string): AnyMessageContent => createImageStatus(url, { caption }),
	video: (buffer: Buffer, caption?: string): AnyMessageContent => createVideoStatus(buffer, { caption }),
	videoUrl: (url: string, caption?: string): AnyMessageContent => createVideoStatus(url, { caption }),
	gif: (buffer: Buffer, caption?: string): AnyMessageContent =>
		createVideoStatus(buffer, { caption, gifPlayback: true }),
	voiceNote: (buffer: Buffer): AnyMessageContent => createAudioStatus(buffer),

	/**
	 * Send a status to all contacts or a specific JID list.
	 * @param sendMessage - Wired to `(jid, content, opts) => sock.sendMessage(jid, content, opts)`
	 * @param content - Status message content
	 * @param jidList - JIDs that should see this status (empty = all contacts)
	 */
	send: async (
		sendMessage: StatusSendFunction,
		content: AnyMessageContent,
		jidList: string[] = []
	): Promise<WAMessage | undefined> => {
		const individuals = jidList.filter(jid => jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')))

		return await sendMessage(STATUS_BROADCAST_JID, content, {
			statusJidList: individuals.length > 0 ? individuals : undefined,
			messageId: generateStatusMessageId()
		})
	}
}
