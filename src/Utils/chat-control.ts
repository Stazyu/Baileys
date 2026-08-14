/** Standard disappearing-message durations in seconds */
export const DISAPPEARING_DURATIONS = {
	OFF: 0,
	HOURS_24: 86400,
	DAYS_7: 604800,
	DAYS_90: 7776000
} as const

export interface TypingOptions {
	/** How long to show the indicator before auto-pausing (ms) */
	duration?: number
	/** Auto-pause after duration (default: true) */
	autoPause?: boolean
}

export type PresenceSendFunction = (jid: string, presence: 'composing' | 'paused' | 'recording') => Promise<void>

/** Typing / recording presence indicator helper. */
export class TypingIndicator {
	private intervals = new Map<string, ReturnType<typeof setTimeout>>()
	private sendPresence: PresenceSendFunction

	constructor(sendPresence: PresenceSendFunction) {
		this.sendPresence = sendPresence
	}

	/** Show the "typing..." composing indicator */
	async startTyping(jid: string, options: TypingOptions = {}): Promise<void> {
		await this.stopTyping(jid)
		await this.sendPresence(jid, 'composing')

		if (options.autoPause !== false && options.duration) {
			const timeout = setTimeout(() => this.stopTyping(jid), options.duration)
			this.intervals.set(jid, timeout)
		}
	}

	/** Show the recording indicator (for voice notes) */
	async startRecording(jid: string, options: TypingOptions = {}): Promise<void> {
		await this.stopTyping(jid)
		await this.sendPresence(jid, 'recording')

		if (options.autoPause !== false && options.duration) {
			const timeout = setTimeout(() => this.stopTyping(jid), options.duration)
			this.intervals.set(jid, timeout)
		}
	}

	/** Stop typing/recording and send 'paused' */
	async stopTyping(jid: string): Promise<void> {
		const existing = this.intervals.get(jid)
		if (existing) {
			clearTimeout(existing)
			this.intervals.delete(jid)
		}
		try {
			await this.sendPresence(jid, 'paused')
		} catch {}
	}

	/** Stop all active indicators */
	async stopAll(): Promise<void> {
		for (const [jid] of this.intervals) {
			await this.stopTyping(jid)
		}
	}

	/**
	 * Show "typing..." for `duration` ms, run `callback`, then return its result.
	 */
	async simulateTyping<T>(jid: string, duration: number, callback: () => Promise<T>): Promise<T> {
		await this.startTyping(jid)
		await new Promise(r => setTimeout(r, duration))
		await this.stopTyping(jid)
		return callback()
	}
}

export interface PinnedMessage {
	messageId: string
	jid: string
	pinnedAt: Date
	pinnedBy?: string
	expiresAt?: Date
}

/** Client-side pinned-message tracker */
export class PinnedMessagesManager {
	private pinnedMessages = new Map<string, PinnedMessage[]>()

	pin(jid: string, messageId: string, pinnedBy?: string, expiresAt?: Date): PinnedMessage {
		const pinned: PinnedMessage = { messageId, jid, pinnedAt: new Date(), pinnedBy, expiresAt }
		const existing = this.pinnedMessages.get(jid) ?? []
		const filtered = existing.filter(p => p.messageId !== messageId)
		filtered.push(pinned)
		this.pinnedMessages.set(jid, filtered)
		return pinned
	}

	unpin(jid: string, messageId: string): boolean {
		const existing = this.pinnedMessages.get(jid)
		if (!existing) return false
		const filtered = existing.filter(p => p.messageId !== messageId)
		if (filtered.length === existing.length) return false
		this.pinnedMessages.set(jid, filtered)
		return true
	}

	getPinned(jid: string): PinnedMessage[] {
		return this.pinnedMessages.get(jid) ?? []
	}

	isPinned(jid: string, messageId: string): boolean {
		return (this.pinnedMessages.get(jid) ?? []).some(p => p.messageId === messageId)
	}

	clearPins(jid: string): void {
		this.pinnedMessages.delete(jid)
	}

	clearExpired(): number {
		let cleared = 0
		const now = Date.now()
		for (const [jid, pins] of this.pinnedMessages) {
			const valid = pins.filter(p => !p.expiresAt || p.expiresAt.getTime() > now)
			if (valid.length < pins.length) {
				cleared += pins.length - valid.length
				this.pinnedMessages.set(jid, valid)
			}
		}
		return cleared
	}
}

/** Create a TypingIndicator wired to your socket's sendPresenceUpdate */
export const createTypingIndicator = (sendPresence: PresenceSendFunction): TypingIndicator =>
	new TypingIndicator(sendPresence)

/** Create a PinnedMessagesManager */
export const createPinnedMessagesManager = (): PinnedMessagesManager => new PinnedMessagesManager()

export interface ReadReceiptConfig {
	/** Enable read receipts (blue ticks) */
	enabled: boolean
	/** Auto-read messages */
	autoRead?: boolean
	/** Delay before marking as read (ms) */
	readDelay?: number
	/** JIDs that should stay unread */
	excludeJids?: string[]
}

export type ReadReceiptSendFunction = (
	jid: string,
	participant: string | undefined,
	messageIds: string[]
) => Promise<void>

export interface ReadReceiptController {
	setConfig(newConfig: Partial<ReadReceiptConfig>): void
	getConfig(): ReadReceiptConfig
	enable(): void
	disable(): void
	isEnabled(): boolean
	markRead(jid: string, participant: string | undefined, messageIds: string[]): Promise<void>
	forceMarkRead(jid: string, participant: string | undefined, messageIds: string[]): Promise<void>
}

/** Creates a ReadReceiptController that wraps sock.readMessages and holds state/configuration. */
export const createReadReceiptController = (
	sendReadReceipt: ReadReceiptSendFunction,
	config: ReadReceiptConfig = { enabled: true }
): ReadReceiptController => {
	let currentConfig = { ...config }

	return {
		setConfig(newConfig) {
			currentConfig = { ...currentConfig, ...newConfig }
		},
		getConfig() {
			return { ...currentConfig }
		},
		enable() {
			currentConfig.enabled = true
		},
		disable() {
			currentConfig.enabled = false
		},
		isEnabled() {
			return currentConfig.enabled
		},
		async markRead(jid, participant, messageIds) {
			if (!currentConfig.enabled) return
			if (currentConfig.excludeJids?.includes(jid)) return

			if (currentConfig.readDelay) {
				await new Promise(r => setTimeout(r, currentConfig.readDelay))
			}

			await sendReadReceipt(jid, participant, messageIds)
		},
		async forceMarkRead(jid, participant, messageIds) {
			await sendReadReceipt(jid, participant, messageIds)
		}
	}
}
